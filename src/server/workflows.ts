import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { dataTables, executions, executionSteps, users, workflowVersions, workflows } from "@/db/schema";
import {
  diffGraphs,
  slotOnActivation,
  triggerKind,
  triggerOf,
  validateGraph,
  type Graph,
  type Json,
  type TriggerConfig,
} from "@/shared/graph";
import { manages, NotFound, Refused, visibleTo, type Actor } from "./access";
import { credentialNamesOf } from "./credentials";

const stepSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(120),
  type: z.enum(["trigger", "http", "condition", "set", "wait", "approval", "email", "ai", "table"]),
  disabled: z.boolean().optional(),
  onError: z.enum(["stop", "continue"]).optional(),
  config: z.record(z.string(), z.unknown()),
});
export const graphSchema = z.object({
  steps: z.array(stepSchema).max(100),
  connections: z.array(z.object({ from: z.string(), port: z.string(), to: z.string() })).max(400),
});

const name = z.string().trim().min(1, "Name is required").max(120);
export const createWorkflowInput = z.object({ name });
export const idInput = z.object({ id: z.string() });
export const renameWorkflowInput = z.object({ id: z.string(), name });
export const saveWorkflowInput = z.object({ id: z.string(), graph: graphSchema });
export const shareWorkflowInput = z.object({ id: z.string(), shared: z.boolean() });
export const transferWorkflowInput = z.object({ id: z.string(), ownerId: z.string() });
export const activateInput = z.object({ id: z.string(), active: z.boolean() });
export const versionInput = z.object({ id: z.string(), version: z.number().int() });

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function starterGraph(): Graph {
  return {
    steps: [{ id: crypto.randomUUID(), name: "Start", type: "trigger", config: { kind: "manual" } }],
    connections: [],
  };
}

export async function listWorkflows(actor: Actor) {
  return db
    .select({
      id: workflows.id,
      name: workflows.name,
      triggerKind: workflows.triggerKind,
      active: workflows.active,
      shared: workflows.shared,
      lastRunStatus: workflows.lastRunStatus,
      ownerId: workflows.ownerId,
      ownerEmail: users.email,
      updatedAt: workflows.updatedAt,
    })
    .from(workflows)
    .leftJoin(users, eq(users.id, workflows.ownerId))
    .where(visibleTo(actor, workflows))
    .orderBy(desc(workflows.updatedAt));
}

export async function visibleWorkflow(actor: Actor, id: string) {
  const [row] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, id), visibleTo(actor, workflows)));
  if (!row) throw new NotFound("That workflow");
  return row;
}

export async function getWorkflow(actor: Actor, id: string) {
  const wf = await visibleWorkflow(actor, id);
  const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, wf.ownerId));
  const credentialNames = await credentialNamesOf(wf.orgId, wf.ownerId);
  const tables = await db
    .select({ id: dataTables.id, name: dataTables.name })
    .from(dataTables)
    .where(and(eq(dataTables.orgId, wf.orgId), or(eq(dataTables.ownerId, wf.ownerId), eq(dataTables.shared, true))));
  const [latest] = await db
    .select({ id: executions.id, status: executions.status, startedAt: executions.startedAt })
    .from(executions)
    .where(eq(executions.workflowId, id))
    .orderBy(desc(executions.startedAt))
    .limit(1);
  const stepData: Record<string, { input: Json; output: Json; error: string | null; status: string }> = {};
  if (latest) {
    const steps = await db.select().from(executionSteps).where(eq(executionSteps.executionId, latest.id));
    for (const s of steps)
      stepData[s.stepId] = {
        input: JSON.parse(s.input),
        output: s.output ? JSON.parse(s.output) : null,
        error: s.error,
        status: s.status,
      };
  }
  return {
    workflow: {
      id: wf.id,
      name: wf.name,
      active: wf.active,
      shared: wf.shared,
      version: wf.version,
      ownerId: wf.ownerId,
      ownerEmail: owner?.email ?? null,
      webhookToken: wf.webhookToken,
      canManage: manages(actor, wf),
      isOwner: wf.ownerId === actor.id,
    },
    graph: JSON.parse(wf.graph) as Graph,
    credentials: credentialNames,
    tables,
    latestRun: latest ?? null,
    stepData,
  };
}

export async function createWorkflow(actor: Actor, input: { name: string; graph?: Graph }) {
  const id = crypto.randomUUID();
  const graph = input.graph ?? starterGraph();
  const now = Date.now();
  await db.batch([
    db.insert(workflows).values({
      id,
      orgId: actor.orgId,
      ownerId: actor.id,
      name: input.name,
      graph: JSON.stringify(graph),
      triggerKind: triggerKind(graph),
      version: 1,
      webhookToken: newToken(),
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(workflowVersions).values({
      id: crypto.randomUUID(),
      workflowId: id,
      version: 1,
      authorId: actor.id,
      authorEmail: actor.email,
      graph: JSON.stringify(graph),
      createdAt: now,
    }),
  ]);
  return { id };
}

/** Saves a new version of the graph. */
export async function saveWorkflow(actor: Actor, input: { id: string; graph: Graph }, restoredFrom?: number) {
  const wf = await visibleWorkflow(actor, input.id);
  const problems = validateGraph(input.graph);
  if (problems.length) throw new Refused(problems.join(" "));
  if (wf.ownerId !== actor.id) guardOwnerCredentials(JSON.parse(wf.graph) as Graph, input.graph);
  const kind = triggerKind(input.graph);
  const next = wf.version + 1;
  const now = Date.now();
  const stillActive = wf.active && kind !== "manual";
  const [, updated] = await db.batch([
    db.insert(workflowVersions).values({
      id: crypto.randomUUID(),
      workflowId: wf.id,
      version: next,
      authorId: actor.id,
      authorEmail: actor.email,
      graph: JSON.stringify(input.graph),
      restoredFrom: restoredFrom ?? null,
      createdAt: now,
    }),
    db
      .update(workflows)
      .set({ graph: JSON.stringify(input.graph), triggerKind: kind, version: next, updatedAt: now, active: stillActive })
      .where(and(eq(workflows.id, wf.id), eq(workflows.version, wf.version)))
      .returning({ id: workflows.id }),
  ]);
  if (!updated.length) {
    await db.delete(workflowVersions).where(and(eq(workflowVersions.workflowId, wf.id), eq(workflowVersions.version, next)));
    throw new Refused("Someone saved this workflow a moment ago. Reload to see their changes.");
  }
  return { version: next };
}

/**
 * A step that uses the owner's credential sends it wherever its URL points,
 * so only the owner adds or changes such a step.
 */
function guardOwnerCredentials(before: Graph, after: Graph) {
  const old = new Map(before.steps.map((s) => [s.id, s]));
  for (const step of after.steps) {
    if (step.type !== "http" || !step.config.credentialId) continue;
    const prev = old.get(step.id);
    if (!prev || JSON.stringify(prev.config) !== JSON.stringify(step.config))
      throw new Refused(`Only the workflow's owner can change "${step.name}", since it uses their credential.`);
  }
}

export async function renameWorkflow(actor: Actor, input: { id: string; name: string }) {
  await visibleWorkflow(actor, input.id);
  await db.update(workflows).set({ name: input.name, updatedAt: Date.now() }).where(eq(workflows.id, input.id));
}

export async function duplicateWorkflow(actor: Actor, id: string) {
  const wf = await visibleWorkflow(actor, id);
  return createWorkflow(actor, { name: `${wf.name} (copy)`, graph: JSON.parse(wf.graph) as Graph });
}

export async function deleteWorkflow(actor: Actor, id: string) {
  const wf = await visibleWorkflow(actor, id);
  if (!manages(actor, wf)) throw new Refused("Only the owner or an admin can delete this workflow.");
  const runIds = (await db.select({ id: executions.id }).from(executions).where(eq(executions.workflowId, id))).map((r) => r.id);
  await db.batch([
    ...chunk(runIds, 90).map((ids) => db.delete(executionSteps).where(inArray(executionSteps.executionId, ids))),
    db.delete(executions).where(eq(executions.workflowId, id)),
    db.delete(workflowVersions).where(eq(workflowVersions.workflowId, id)),
    db.delete(workflows).where(eq(workflows.id, id)),
  ] as unknown as [never, ...never[]]);
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function shareWorkflow(actor: Actor, input: { id: string; shared: boolean }) {
  const wf = await visibleWorkflow(actor, input.id);
  if (!manages(actor, wf)) throw new Refused("Only the owner or an admin can change sharing.");
  await db.update(workflows).set({ shared: input.shared }).where(eq(workflows.id, wf.id));
}

export async function transferWorkflow(actor: Actor, input: { id: string; ownerId: string }) {
  const wf = await visibleWorkflow(actor, input.id);
  if (!manages(actor, wf)) throw new Refused("Only the owner or an admin can transfer this workflow.");
  const [target] = await db.select().from(users).where(and(eq(users.id, input.ownerId), eq(users.orgId, actor.orgId)));
  if (!target) throw new NotFound("That member");
  await db.update(workflows).set({ ownerId: target.id }).where(eq(workflows.id, wf.id));
}

export async function setActive(actor: Actor, input: { id: string; active: boolean }) {
  const wf = await visibleWorkflow(actor, input.id);
  if (!input.active) {
    await db.update(workflows).set({ active: false }).where(eq(workflows.id, wf.id));
    return;
  }
  const graph = JSON.parse(wf.graph) as Graph;
  const trigger = triggerOf(graph)?.config as TriggerConfig | undefined;
  if (!trigger || trigger.kind === "manual")
    throw new Refused("Only workflows with a schedule or webhook trigger can be activated.");
  const problems = validateGraph(graph);
  if (problems.length) throw new Refused(problems.join(" "));
  const lastSlot = trigger.kind === "schedule" && trigger.schedule ? slotOnActivation(trigger.schedule, new Date()) : null;
  await db.update(workflows).set({ active: true, lastSlot }).where(eq(workflows.id, wf.id));
}

export async function regenerateWebhook(actor: Actor, id: string) {
  await visibleWorkflow(actor, id);
  await db.update(workflows).set({ webhookToken: newToken() }).where(eq(workflows.id, id));
}

export async function listVersions(actor: Actor, id: string) {
  const wf = await visibleWorkflow(actor, id);
  const rows = await db
    .select({
      version: workflowVersions.version,
      authorEmail: workflowVersions.authorEmail,
      createdAt: workflowVersions.createdAt,
      restoredFrom: workflowVersions.restoredFrom,
    })
    .from(workflowVersions)
    .where(eq(workflowVersions.workflowId, id))
    .orderBy(desc(workflowVersions.version));
  return { workflow: { id: wf.id, name: wf.name, version: wf.version }, versions: rows };
}

async function versionGraph(workflowId: string, version: number) {
  const [row] = await db
    .select()
    .from(workflowVersions)
    .where(and(eq(workflowVersions.workflowId, workflowId), eq(workflowVersions.version, version)));
  return row ?? null;
}

export async function getVersion(actor: Actor, input: { id: string; version: number }) {
  const wf = await visibleWorkflow(actor, input.id);
  const row = await versionGraph(wf.id, input.version);
  if (!row) throw new NotFound("That version");
  const [previous] = await db
    .select()
    .from(workflowVersions)
    .where(and(eq(workflowVersions.workflowId, wf.id), sql`${workflowVersions.version} < ${input.version}`))
    .orderBy(desc(workflowVersions.version))
    .limit(1);
  const graph = JSON.parse(row.graph) as Graph;
  return {
    workflow: { id: wf.id, name: wf.name, version: wf.version },
    version: { version: row.version, authorEmail: row.authorEmail, createdAt: row.createdAt, restoredFrom: row.restoredFrom },
    graph,
    changes: diffGraphs(previous ? (JSON.parse(previous.graph) as Graph) : null, graph),
  };
}

export async function restoreVersion(actor: Actor, input: { id: string; version: number }) {
  const wf = await visibleWorkflow(actor, input.id);
  const row = await versionGraph(wf.id, input.version);
  if (!row) throw new NotFound("That version");
  return saveWorkflow(actor, { id: wf.id, graph: JSON.parse(row.graph) as Graph }, input.version);
}
