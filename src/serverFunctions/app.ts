import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { ensureUserMiddleware } from "@every-app/sdk/tanstack-start";
import { z } from "zod";
import { actorFrom, membersOf } from "@/server/access";
import * as credentials from "@/server/credentials";
import * as runs from "@/server/runs";
import * as tables from "@/server/tables";
import * as workflows from "@/server/workflows";

// Every server function runs behind ensureUserMiddleware: `context.user` is
// the member the Gateway signed in, and each query takes them as `actor`.
const member = createServerFn().middleware([ensureUserMiddleware]);
const memberPost = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware]);
const parse = <T extends z.ZodType>(schema: T) => (data: unknown) => schema.parse(data) as z.infer<T>;

// ---- Workflows ----

export const getWorkflows = member.handler(async ({ context }) => {
  const actor = await actorFrom(context.user);
  return { workflows: await workflows.listWorkflows(actor), me: actor.id };
});

export const getWorkflow = member.validator(parse(workflows.idInput)).handler(async ({ data, context }) => {
  const actor = await actorFrom(context.user);
  const result = await workflows.getWorkflow(actor, data.id);
  const origin = new URL(getRequest().url).origin;
  return {
    ...result,
    workflow: { ...result.workflow, webhookUrl: `${origin}/hook/${result.workflow.webhookToken}` },
    members: result.workflow.canManage ? await membersOf(actor.orgId) : ([] as { id: string; email: string }[]),
  };
});

export const createWorkflow = memberPost.validator(parse(workflows.createWorkflowInput)).handler(async ({ data, context }) =>
  workflows.createWorkflow(await actorFrom(context.user), data),
);
export const saveWorkflow = memberPost.validator(parse(workflows.saveWorkflowInput)).handler(async ({ data, context }) =>
  workflows.saveWorkflow(await actorFrom(context.user), data as never),
);
export const renameWorkflow = memberPost.validator(parse(workflows.renameWorkflowInput)).handler(async ({ data, context }) =>
  workflows.renameWorkflow(await actorFrom(context.user), data),
);
export const duplicateWorkflow = memberPost.validator(parse(workflows.idInput)).handler(async ({ data, context }) =>
  workflows.duplicateWorkflow(await actorFrom(context.user), data.id),
);
export const deleteWorkflow = memberPost.validator(parse(workflows.idInput)).handler(async ({ data, context }) =>
  workflows.deleteWorkflow(await actorFrom(context.user), data.id),
);
export const shareWorkflow = memberPost.validator(parse(workflows.shareWorkflowInput)).handler(async ({ data, context }) =>
  workflows.shareWorkflow(await actorFrom(context.user), data),
);
export const transferWorkflow = memberPost.validator(parse(workflows.transferWorkflowInput)).handler(async ({ data, context }) =>
  workflows.transferWorkflow(await actorFrom(context.user), data),
);
export const setWorkflowActive = memberPost.validator(parse(workflows.activateInput)).handler(async ({ data, context }) =>
  workflows.setActive(await actorFrom(context.user), data),
);
export const regenerateWebhook = memberPost.validator(parse(workflows.idInput)).handler(async ({ data, context }) =>
  workflows.regenerateWebhook(await actorFrom(context.user), data.id),
);
export const getVersions = member.validator(parse(workflows.idInput)).handler(async ({ data, context }) =>
  workflows.listVersions(await actorFrom(context.user), data.id),
);
export const getVersion = member.validator(parse(workflows.versionInput)).handler(async ({ data, context }) =>
  workflows.getVersion(await actorFrom(context.user), data),
);
export const restoreVersion = memberPost.validator(parse(workflows.versionInput)).handler(async ({ data, context }) =>
  workflows.restoreVersion(await actorFrom(context.user), data),
);

// ---- Runs ----

export const runWorkflow = memberPost.validator(parse(workflows.idInput)).handler(async ({ data, context }) => {
  const run = await runs.runNow(await actorFrom(context.user), data.id);
  return { id: run.id, status: run.status };
});
export const getRuns = member.validator(parse(runs.listRunsInput)).handler(async ({ data, context }) =>
  runs.listRuns(await actorFrom(context.user), data),
);
export const getRun = member.validator(parse(runs.runIdInput)).handler(async ({ data, context }) =>
  runs.getRun(await actorFrom(context.user), data.id),
);
export const cancelRun = memberPost.validator(parse(runs.runIdInput)).handler(async ({ data, context }) =>
  runs.cancelRun(await actorFrom(context.user), data.id),
);
export const decideRun = memberPost.validator(parse(runs.decideInput)).handler(async ({ data, context }) => {
  const result = await runs.decide(await actorFrom(context.user), data);
  return { status: result.status };
});
export const retryRun = memberPost.validator(parse(runs.runIdInput)).handler(async ({ data, context }) => {
  const run = await runs.retryRun(await actorFrom(context.user), data.id);
  return { id: run.id, status: run.status };
});
export const replayRun = memberPost.validator(parse(runs.runIdInput)).handler(async ({ data, context }) => {
  const run = await runs.replayRun(await actorFrom(context.user), data.id);
  return { id: run.id, status: run.status };
});

// ---- Credentials ----

export const getCredentials = member.handler(async ({ context }) =>
  credentials.listCredentials(await actorFrom(context.user)),
);
export const saveCredential = memberPost.validator(parse(credentials.saveCredentialInput)).handler(async ({ data, context }) =>
  credentials.saveCredential(await actorFrom(context.user), data),
);
export const deleteCredential = memberPost.validator(parse(credentials.credentialIdInput)).handler(async ({ data, context }) =>
  credentials.deleteCredential(await actorFrom(context.user), data.id),
);

// ---- Data tables ----

export const getTables = member.handler(async ({ context }) => tables.listTables(await actorFrom(context.user)));
export const getTable = member.validator(parse(tables.tableIdInput)).handler(async ({ data, context }) => {
  const actor = await actorFrom(context.user);
  const result = await tables.getTable(actor, data.id);
  return { ...result, members: result.table.canManage ? await membersOf(actor.orgId) : ([] as { id: string; email: string }[]) };
});
export const createTable = memberPost.validator(parse(tables.createTableInput)).handler(async ({ data, context }) =>
  tables.createTable(await actorFrom(context.user), data),
);
export const renameTable = memberPost.validator(parse(tables.renameTableInput)).handler(async ({ data, context }) =>
  tables.renameTable(await actorFrom(context.user), data),
);
export const shareTable = memberPost.validator(parse(tables.shareTableInput)).handler(async ({ data, context }) =>
  tables.shareTable(await actorFrom(context.user), data),
);
export const transferTable = memberPost.validator(parse(tables.transferTableInput)).handler(async ({ data, context }) =>
  tables.transferTable(await actorFrom(context.user), data),
);
export const deleteTable = memberPost.validator(parse(tables.tableIdInput)).handler(async ({ data, context }) =>
  tables.deleteTable(await actorFrom(context.user), data.id),
);
export const addColumn = memberPost.validator(parse(tables.addColumnInput)).handler(async ({ data, context }) =>
  tables.addColumn(await actorFrom(context.user), data),
);
export const renameColumn = memberPost.validator(parse(tables.renameColumnInput)).handler(async ({ data, context }) =>
  tables.renameColumn(await actorFrom(context.user), data),
);
export const deleteColumn = memberPost.validator(parse(tables.deleteColumnInput)).handler(async ({ data, context }) =>
  tables.deleteColumn(await actorFrom(context.user), data),
);
export const saveRow = memberPost.validator(parse(tables.saveRowInput)).handler(async ({ data, context }) =>
  tables.saveRow(await actorFrom(context.user), data),
);
export const deleteRow = memberPost.validator(parse(tables.deleteRowInput)).handler(async ({ data, context }) =>
  tables.deleteRow(await actorFrom(context.user), data),
);
