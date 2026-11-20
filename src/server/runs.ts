import { and, count, desc, eq, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { executions, executionSteps, workflows } from "@/db/schema";
import type { Json } from "@/shared/graph";
import { NotFound, Refused, type Actor } from "./access";
import { cancel, resume, startRun } from "./engine";
import { visibleWorkflow } from "./workflows";

export const RUN_STATUSES = ["running", "waiting", "succeeded", "failed", "cancelled"] as const;
export const PAGE_SIZE = 20;

export const listRunsInput = z.object({
  workflowId: z.string().optional(),
  status: z.enum(RUN_STATUSES).optional(),
  page: z.number().int().min(1).default(1),
});
export const runIdInput = z.object({ id: z.string() });
export const decideInput = z.object({ id: z.string(), decision: z.enum(["approved", "rejected"]) });

function workflowsVisible(actor: Actor): SQL {
  if (actor.admin) return eq(workflows.orgId, actor.orgId);
  return and(eq(workflows.orgId, actor.orgId), or(eq(workflows.ownerId, actor.id), eq(workflows.shared, true)))!;
}

export async function listRuns(actor: Actor, input: z.infer<typeof listRunsInput>) {
  const where = and(
    workflowsVisible(actor),
    input.workflowId ? eq(executions.workflowId, input.workflowId) : undefined,
    input.status ? eq(executions.status, input.status) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: executions.id,
        workflowId: executions.workflowId,
        workflowName: workflows.name,
        version: executions.version,
        triggerKind: executions.triggerKind,
        startedByEmail: executions.startedByEmail,
        status: executions.status,
        startedAt: executions.startedAt,
        finishedAt: executions.finishedAt,
      })
      .from(executions)
      .innerJoin(workflows, eq(workflows.id, executions.workflowId))
      .where(where)
      .orderBy(desc(executions.startedAt), desc(executions.id))
      .limit(PAGE_SIZE)
      .offset((input.page - 1) * PAGE_SIZE),
    db
      .select({ n: count() })
      .from(executions)
      .innerJoin(workflows, eq(workflows.id, executions.workflowId))
      .where(where),
  ]);
  return { runs: rows, total: total?.n ?? 0, page: input.page, pageSize: PAGE_SIZE };
}

async function visibleRun(actor: Actor, id: string) {
  const [row] = await db
    .select({ run: executions, workflowName: workflows.name })
    .from(executions)
    .innerJoin(workflows, eq(workflows.id, executions.workflowId))
    .where(and(eq(executions.id, id), workflowsVisible(actor)));
  if (!row) throw new NotFound("That run");
  return row;
}

export async function getRun(actor: Actor, id: string) {
  const { run, workflowName } = await visibleRun(actor, id);
  const steps = await db
    .select()
    .from(executionSteps)
    .where(eq(executionSteps.executionId, id))
    .orderBy(executionSteps.position);
  return {
    run: {
      id: run.id,
      workflowId: run.workflowId,
      workflowName,
      version: run.version,
      triggerKind: run.triggerKind,
      startedByEmail: run.startedByEmail,
      status: run.status,
      error: run.error,
      retryOf: run.retryOf,
      resumeAt: run.resumeAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    },
    steps: steps.map((s) => ({
      id: s.id,
      stepName: s.stepName,
      stepType: s.stepType,
      status: s.status,
      reused: s.reused,
      input: JSON.parse(s.input) as Json,
      output: s.output ? (JSON.parse(s.output) as Record<string, Json[]>) : null,
      error: s.error,
      durationMs: s.durationMs,
    })),
  };
}

export async function runNow(actor: Actor, workflowId: string) {
  const wf = await visibleWorkflow(actor, workflowId);
  return startRun(wf, "manual", [{}], { id: actor.id, email: actor.email });
}

export async function cancelRun(actor: Actor, id: string) {
  await visibleRun(actor, id);
  if (!(await cancel(id))) throw new Refused("Only a running or waiting run can be cancelled.");
}

export async function decide(actor: Actor, input: z.infer<typeof decideInput>) {
  const { run } = await visibleRun(actor, input.id);
  if (run.status !== "waiting") throw new Refused("This run isn't waiting for approval.");
  const result = await resume(run.id, input.decision, actor.email);
  if (!result) throw new Refused("This run isn't waiting for approval.");
  return result;
}

/** A new run that reuses the failed run's finished steps and starts again at the one that failed. */
export async function retryRun(actor: Actor, id: string) {
  const { run } = await visibleRun(actor, id);
  if (run.status !== "failed") throw new Refused("Only a failed run can be retried.");
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, run.workflowId));
  if (!wf) throw new NotFound("That workflow");
  const reuse = await db
    .select()
    .from(executionSteps)
    .where(and(eq(executionSteps.executionId, id), eq(executionSteps.status, "succeeded")));
  return startRun(wf, run.triggerKind, JSON.parse(run.input), { id: actor.id, email: actor.email }, {
    graph: JSON.parse(run.graph),
    version: run.version,
    retryOf: run.id,
    reuse,
  });
}

/** A new run of the current version with the past run's trigger input. */
export async function replayRun(actor: Actor, id: string) {
  const { run } = await visibleRun(actor, id);
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, run.workflowId));
  if (!wf) throw new NotFound("That workflow");
  return startRun(wf, run.triggerKind, JSON.parse(run.input), { id: actor.id, email: actor.email }, { retryOf: run.id });
}

