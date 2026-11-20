import { env } from "cloudflare:workers";
import {
  aiBaseUrl,
  createGatewayFetch,
  gatewayRefusal,
  refusalFromError,
  sendEmail,
} from "@every-app/sdk/server";
import { and, asc, eq, inArray, lte, lt } from "drizzle-orm";
import { db } from "@/db";
import { executions, executionSteps, workflows } from "@/db/schema";
import {
  compare,
  currentSlot,
  ExpressionError,
  portsOf,
  resolveDeep,
  resolveText,
  topologicalOrder,
  type Graph,
  type Item,
  type Pair,
  type Step,
} from "@/shared/graph";
import { chunk } from "./workflows";
import { credentialForRun } from "./credentials";
import {
  deleteRowsForRun,
  findRows,
  insertRowForRun,
  rowAsItem,
  tableForRun,
  updateRowsForRun,
  valuesByName,
} from "./tables";

/** The model AI prompt steps use, through the install's OpenRouter key on the Gateway. */
export const AI_PROVIDER = "openrouter";
export const AI_MODEL = "openai/gpt-4o-mini";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type Workflow = typeof workflows.$inferSelect;
type Outputs = Record<string, Item[]>;
type Starter = { id: string; email: string } | null;

class StepFailure extends Error {}
class Pause {
  constructor(
    readonly kind: "wait" | "approval",
    readonly resumeAt: number | null,
  ) {}
}

/** Starts a run of the workflow's saved version and carries it as far as it goes. */
export async function startRun(
  wf: Workflow,
  triggerKind: string,
  input: Item[],
  startedBy: Starter,
  options: { id?: string; graph?: Graph; version?: number; retryOf?: string; reuse?: (typeof executionSteps.$inferSelect)[] } = {},
) {
  const id = options.id ?? crypto.randomUUID();
  const now = Date.now();
  const graph = options.graph ?? (JSON.parse(wf.graph) as Graph);
  await db.insert(executions).values({
    id,
    orgId: wf.orgId,
    workflowId: wf.id,
    version: options.version ?? wf.version,
    triggerKind,
    startedById: startedBy?.id ?? null,
    startedByEmail: startedBy?.email ?? null,
    status: "running",
    input: JSON.stringify(input),
    graph: JSON.stringify(graph),
    retryOf: options.retryOf ?? null,
    startedAt: now,
  });
  if (options.reuse?.length)
    await db.batch(
      options.reuse.map((s) =>
        db.insert(executionSteps).values({ ...s, id: crypto.randomUUID(), executionId: id, reused: true }),
      ) as [never, ...never[]],
    );
  const result = await advance(id);
  return { id, ...result };
}

/** Runs every step not yet done, in order, until the run ends or pauses. */
export async function advance(executionId: string): Promise<{ status: string; lastOutput: Item[] | null }> {
  const [run] = await db.select().from(executions).where(eq(executions.id, executionId));
  if (!run || run.status !== "running") return { status: run?.status ?? "missing", lastOutput: null };
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, run.workflowId));
  if (!wf) return finish(run.id, run.workflowId, "failed", "The workflow was deleted.");
  const graph = JSON.parse(run.graph) as Graph;
  const order = topologicalOrder(graph) ?? [];
  const byId = new Map(graph.steps.map((s) => [s.id, s]));
  const byName = new Map(graph.steps.map((s) => [s.name, s]));
  const records = await db
    .select()
    .from(executionSteps)
    .where(eq(executionSteps.executionId, run.id))
    .orderBy(asc(executionSteps.position));
  const done = new Map(records.map((r) => [r.stepId, r]));
  const outputs = new Map<string, Outputs>();
  let position = records.length;
  let lastOutput: Item[] | null = null;

  for (const stepId of order) {
    const step = byId.get(stepId)!;
    let input: Item[];
    if (step.type === "trigger") input = JSON.parse(run.input) as Item[];
    else {
      input = [];
      let fed = false;
      for (const c of graph.connections) {
        if (c.to !== stepId) continue;
        const items = outputs.get(c.from)?.[c.port];
        if (items) {
          fed = true;
          input.push(...items);
        }
      }
      if (!fed || input.length === 0) continue;
    }
    const prior = done.get(stepId);
    if (prior?.status === "succeeded") {
      const out = JSON.parse(prior.output ?? "{}") as Outputs;
      outputs.set(stepId, out);
      lastOutput = Object.values(out).flat();
      continue;
    }
    if (prior?.status === "waiting") return { status: "waiting", lastOutput: null };

    const [current] = await db.select({ status: executions.status }).from(executions).where(eq(executions.id, run.id));
    if (current?.status !== "running") return { status: current?.status ?? "missing", lastOutput: null };

    const started = Date.now();
    const scope = {
      node: (name: string, index: number) => {
        const s = byName.get(name);
        const out = s ? outputs.get(s.id) : undefined;
        if (!out) return undefined;
        const items = Object.values(out).flat();
        return items[index] ?? items[0];
      },
    };
    const recordId = crypto.randomUUID();
    try {
      const out = await runStep(step, input, scope, wf);
      outputs.set(stepId, out);
      lastOutput = Object.values(out).flat();
      await db.insert(executionSteps).values({
        id: recordId,
        executionId: run.id,
        position: position++,
        stepId,
        stepName: step.name,
        stepType: step.type,
        status: "succeeded",
        input: JSON.stringify(step.type === "trigger" ? [] : input),
        output: JSON.stringify(out),
        startedAt: started,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      if (error instanceof Pause) {
        await db.batch([
          db.insert(executionSteps).values({
            id: recordId,
            executionId: run.id,
            position: position++,
            stepId,
            stepName: step.name,
            stepType: step.type,
            status: "waiting",
            input: JSON.stringify(input),
            startedAt: started,
          }),
          db
            .update(executions)
            .set({ status: "waiting", resumeAt: error.resumeAt })
            .where(and(eq(executions.id, run.id), eq(executions.status, "running"))),
          db.update(workflows).set({ lastRunStatus: "waiting" }).where(eq(workflows.id, run.workflowId)),
        ]);
        return { status: "waiting", lastOutput: null };
      }
      const message = messageOf(error);
      await db.insert(executionSteps).values({
        id: recordId,
        executionId: run.id,
        position: position++,
        stepId,
        stepName: step.name,
        stepType: step.type,
        status: "failed",
        input: JSON.stringify(input),
        error: message,
        startedAt: started,
        durationMs: Date.now() - started,
      });
      return finish(run.id, run.workflowId, "failed", `${step.name}: ${message}`);
    }
  }
  const result = await finish(run.id, run.workflowId, "succeeded", null);
  return { ...result, lastOutput };
}

async function finish(id: string, workflowId: string, status: string, error: string | null) {
  const [row] = await db
    .update(executions)
    .set({ status, error, finishedAt: Date.now(), resumeAt: null })
    .where(and(eq(executions.id, id), eq(executions.status, "running")))
    .returning({ status: executions.status });
  if (row) await db.update(workflows).set({ lastRunStatus: status }).where(eq(workflows.id, workflowId));
  return { status: row?.status ?? "cancelled", lastOutput: null };
}

function messageOf(error: unknown): string {
  if (error instanceof StepFailure || error instanceof ExpressionError) return error.message;
  if (error instanceof Error && error.name === "TimeoutError") return "The request timed out.";
  if (error instanceof Error) return error.message;
  return "The step failed.";
}

type NodeLookup = { node: (name: string, index: number) => Item | undefined };

async function runStep(step: Step, input: Item[], lookup: NodeLookup, wf: Workflow): Promise<Outputs> {
  const ports = portsOf(step.type);
  if (step.type === "trigger") return { main: input };
  if (step.disabled) return { [ports[0]!]: input };
  if (step.type === "wait") {
    const amount = Number(step.config.amount ?? 0);
    const unit = { seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000 }[String(step.config.unit)] ?? 60000;
    if (!(amount > 0)) return { main: input };
    throw new Pause("wait", Date.now() + amount * unit);
  }
  if (step.type === "approval") throw new Pause("approval", null);

  const out: Outputs = Object.fromEntries(ports.map((p) => [p, []]));
  for (let index = 0; index < input.length; index++) {
    const json = input[index]!;
    const scope = { json, node: (name: string) => lookup.node(name, index) };
    try {
      const result = await runItem(step, json, scope, wf);
      out[result.port]!.push(...result.items);
    } catch (error) {
      if (step.onError !== "continue") throw error;
      out[ports[0]!]!.push({ ...json, error: messageOf(error) });
    }
  }
  return out;
}

type Scope = { json: Item; node: (name: string) => Item | undefined };

async function runItem(step: Step, json: Item, scope: Scope, wf: Workflow): Promise<{ port: string; items: Item[] }> {
  const c = step.config;
  const text = (value: unknown) => (typeof value === "string" ? resolveText(value, scope) : value);
  const str = (value: unknown) => {
    const v = text(value);
    return v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  };
  switch (step.type) {
    case "condition": {
      const passed = compare(text(c.left), String(c.operator), text(c.right));
      return { port: passed ? "true" : "false", items: [json] };
    }
    case "set": {
      const item: Item = { ...json };
      for (const op of (c.operations as { op: string; field: string; value?: string; to?: string }[]) ?? []) {
        if (!op.field) continue;
        if (op.op === "set") item[op.field] = text(op.value ?? "");
        else if (op.op === "rename") {
          const to = op.to || op.value;
          if (to && op.field in item) {
            item[to] = item[op.field];
            delete item[op.field];
          }
        } else if (op.op === "remove") delete item[op.field];
      }
      return { port: "main", items: [item] };
    }
    case "http":
      return { port: "main", items: await httpRequest(c, str, scope, wf) };
    case "email": {
      const to = str(c.to);
      if (!to) throw new StepFailure("The step needs a recipient.");
      try {
        const sent = await sendEmail({
          env,
          for: { background: true, organizationId: wf.orgId },
          message: { to, subject: str(c.subject) || "(no subject)", text: str(c.body) },
        });
        return { port: "main", items: [{ to, status: sent.status, messageId: sent.messageId }] };
      } catch (error) {
        const refusal = refusalFromError(error);
        if (refusal?.code === "integration_not_configured")
          throw new StepFailure("Email isn't set up on this Gateway, so the message wasn't sent.");
        if (refusal) throw new StepFailure(`The Gateway refused to send: ${refusal.code}.`);
        throw error;
      }
    }
    case "ai":
      return { port: "main", items: [await aiPrompt(c, str, wf)] };
    case "table":
      return { port: "main", items: await tableStep(c, scope, wf) };
    default:
      return { port: "main", items: [json] };
  }
}

async function httpRequest(c: Record<string, unknown>, str: (v: unknown) => string, scope: Scope, wf: Workflow) {
  const method = String(c.method ?? "GET").toUpperCase();
  if (c.credentialId && !/^https?:\/\/[^/{]+(\/|\?|$)/.test(String(c.url ?? "").trim()))
    throw new StepFailure("With a credential, the URL's host can't come from an expression.");
  let url: URL;
  try {
    url = new URL(str(c.url));
  } catch {
    throw new StepFailure("The URL isn't valid.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new StepFailure("Only http and https URLs work.");
  for (const q of (c.query as Pair[]) ?? []) if (q.name) url.searchParams.append(q.name, str(q.value));
  const headers = new Headers();
  for (const h of (c.headers as Pair[]) ?? []) if (h.name) headers.set(h.name, str(h.value));
  if (c.credentialId) {
    const cred = await credentialForRun(wf.orgId, wf.ownerId, String(c.credentialId));
    if (!cred) throw new StepFailure("The step's credential was deleted or doesn't belong to this workflow's owner.");
    const s = cred.secret;
    if (s.kind === "header") headers.set(s.headerName, s.headerValue);
    else if (s.kind === "bearer") headers.set("authorization", `Bearer ${s.token}`);
    else headers.set("authorization", `Basic ${btoa(`${s.username}:${s.password}`)}`);
  }
  let body: string | undefined;
  const raw = typeof c.body === "string" ? c.body.trim() : "";
  if (raw && method !== "GET" && method !== "HEAD") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new StepFailure("The body isn't valid JSON.");
    }
    body = JSON.stringify(resolveDeep(parsed, scope));
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  const seconds = Math.min(Math.max(Number(c.timeoutSeconds) || 30, 1), 120);
  const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(seconds * 1000) });
  const textBody = await response.text();
  if (!response.ok) throw new StepFailure(`The request failed with status ${response.status}.`);
  let parsed: unknown = textBody;
  try {
    parsed = textBody ? JSON.parse(textBody) : {};
  } catch {
    /* plain text */
  }
  if (Array.isArray(parsed)) return parsed.map((v) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Item) : { value: v }));
  if (parsed && typeof parsed === "object") return [parsed as Item];
  return [{ status: response.status, body: parsed }];
}

async function aiPrompt(c: Record<string, unknown>, str: (v: unknown) => string, wf: Workflow): Promise<Item> {
  const prompt = str(c.prompt);
  if (!prompt) throw new StepFailure("The step needs a prompt.");
  let schema: unknown = null;
  if (typeof c.schema === "string" && c.schema.trim()) {
    try {
      schema = JSON.parse(c.schema);
    } catch {
      throw new StepFailure("The output schema isn't valid JSON.");
    }
  }
  const gatewayFetch = createGatewayFetch({ env, for: { background: true, organizationId: wf.orgId } });
  let response: Response;
  try {
    response = await gatewayFetch(`${aiBaseUrl(AI_PROVIDER)}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: "user", content: prompt }],
        ...(schema
          ? { response_format: { type: "json_schema", json_schema: { name: "output", strict: true, schema } } }
          : {}),
      }),
    });
  } catch (error) {
    const refusal = refusalFromError(error);
    if (refusal?.code.endsWith("not_configured")) throw new StepFailure("AI isn't set up on this Gateway.");
    throw error;
  }
  const refusal = await gatewayRefusal(response);
  if (refusal) {
    if (refusal.code.endsWith("not_configured")) throw new StepFailure("AI isn't set up on this Gateway.");
    throw new StepFailure(`The Gateway refused the AI call: ${refusal.code}.`);
  }
  if (!response.ok) throw new StepFailure(`The model answered with status ${response.status}.`);
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!schema) return { text: content };
  try {
    const value = JSON.parse(content) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Item) : { value };
  } catch {
    throw new StepFailure("The model's answer didn't match the output schema.");
  }
}

async function tableStep(c: Record<string, unknown>, scope: Scope, wf: Workflow): Promise<Item[]> {
  const found = await tableForRun(wf.orgId, wf.ownerId, String(c.tableId ?? ""));
  if (!found) throw new StepFailure("The step's table was deleted or isn't shared with this workflow's owner.");
  const { columns, table } = found;
  const pairs = ((c.values as { column: string; value: string }[]) ?? [])
    .filter((p) => p.column)
    .map((p) => ({ column: p.column, value: typeof p.value === "string" ? resolveText(p.value, scope) : p.value }));
  const filter = c.filterColumn
    ? { column: String(c.filterColumn), value: typeof c.filterValue === "string" ? resolveText(c.filterValue, scope) : c.filterValue }
    : null;
  try {
    switch (c.operation) {
      case "insert": {
        const row = await insertRowForRun(table.id, valuesByName(columns, pairs));
        return [rowAsItem(columns, row)];
      }
      case "update": {
        const rows = await updateRowsForRun(await findRows(table.id, columns, filter), valuesByName(columns, pairs));
        return rows.map((r) => rowAsItem(columns, r));
      }
      case "find":
        return (await findRows(table.id, columns, filter)).map((r) => rowAsItem(columns, r));
      case "delete": {
        const rows = await findRows(table.id, columns, filter);
        await deleteRowsForRun(rows);
        return [{ deleted: rows.length }];
      }
      default:
        throw new StepFailure("Choose what the step does with the table.");
    }
  } catch (error) {
    if (error instanceof Error && !(error instanceof StepFailure)) throw new StepFailure(error.message);
    throw error;
  }
}

// ---- Resuming, cancelling, retrying ----

/** Ends a pause: a Wait that is due, or an Approval decided. */
export async function resume(executionId: string, decision?: "approved" | "rejected", decidedBy?: string) {
  const [step] = await db
    .select()
    .from(executionSteps)
    .where(and(eq(executionSteps.executionId, executionId), eq(executionSteps.status, "waiting")));
  if (!step) return null;
  if (decision ? step.stepType !== "approval" : step.stepType !== "wait") return null;
  const [claimed] = await db
    .update(executions)
    .set({ status: "running", resumeAt: null })
    .where(and(eq(executions.id, executionId), eq(executions.status, "waiting")))
    .returning({ id: executions.id, workflowId: executions.workflowId });
  if (!claimed) return null;
  const input = JSON.parse(step.input) as Item[];
  const output = decision
    ? { approved: [], rejected: [], [decision]: input.map((i) => ({ ...i, decision, decidedBy })) }
    : { main: input };
  await db
    .update(executionSteps)
    .set({ status: "succeeded", output: JSON.stringify(output), durationMs: Date.now() - step.startedAt })
    .where(eq(executionSteps.id, step.id));
  await db.update(workflows).set({ lastRunStatus: "running" }).where(eq(workflows.id, claimed.workflowId));
  return advance(executionId);
}

export async function cancel(executionId: string) {
  const [row] = await db
    .update(executions)
    .set({ status: "cancelled", finishedAt: Date.now(), resumeAt: null })
    .where(and(eq(executions.id, executionId), inArray(executions.status, ["running", "waiting"])))
    .returning({ workflowId: executions.workflowId });
  if (!row) return false;
  await db.batch([
    db
      .update(executionSteps)
      .set({ status: "cancelled" })
      .where(and(eq(executionSteps.executionId, executionId), eq(executionSteps.status, "waiting"))),
    db.update(workflows).set({ lastRunStatus: "cancelled" }).where(eq(workflows.id, row.workflowId)),
  ]);
  return true;
}

// ---- The minute cron ----

export async function tick(now = new Date()) {
  await fireSchedules(now);
  const due = await db
    .select({ id: executions.id })
    .from(executions)
    .where(and(eq(executions.status, "waiting"), lte(executions.resumeAt, now.getTime())))
    .limit(50);
  for (const run of due) await resume(run.id);
  await purgeOldRuns(now);
}

async function fireSchedules(now: Date) {
  const active = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.active, true), eq(workflows.triggerKind, "schedule")));
  for (const wf of active) {
    const graph = JSON.parse(wf.graph) as Graph;
    const schedule = (graph.steps.find((s) => s.type === "trigger")?.config as { schedule?: never })?.schedule;
    if (!schedule) continue;
    const slot = currentSlot(schedule, now);
    if (wf.lastSlot !== null && slot <= wf.lastSlot) continue;
    // Claim the slot so it fires once even if two ticks overlap.
    const [claimed] = await db
      .update(workflows)
      .set({ lastSlot: slot })
      .where(and(eq(workflows.id, wf.id), eq(workflows.active, true), wf.lastSlot === null ? undefined : lt(workflows.lastSlot, slot)))
      .returning({ id: workflows.id });
    if (!claimed) continue;
    await startRun(wf, "schedule", [{ firedAt: new Date(slot * 60000).toISOString() }], null);
  }
}

async function purgeOldRuns(now: Date) {
  const old = await db
    .select({ id: executions.id })
    .from(executions)
    .where(lt(executions.startedAt, now.getTime() - RETENTION_MS))
    .limit(500);
  for (const ids of chunk(old.map((r) => r.id), 90))
    await db.batch([
      db.delete(executionSteps).where(inArray(executionSteps.executionId, ids)),
      db.delete(executions).where(inArray(executions.id, ids)),
    ]);
}
