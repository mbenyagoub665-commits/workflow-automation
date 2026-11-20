import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

// Rows are keyed by the Gateway's organization (`org_id`) and owner
// (`owner_id`, the Gateway's `user.id`). Every query filters on both.

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  email: text("email").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const workflows = sqliteTable(
  "workflows",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    shared: integer("shared", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(false),
    graph: text("graph").notNull(),
    triggerKind: text("trigger_kind").notNull(),
    version: integer("version").notNull(),
    webhookToken: text("webhook_token").notNull(),
    // The last schedule slot (epoch minutes) that fired.
    lastSlot: integer("last_slot"),
    lastRunStatus: text("last_run_status"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("workflows_org").on(t.orgId),
    index("workflows_token").on(t.webhookToken),
  ],
);

export const workflowVersions = sqliteTable(
  "workflow_versions",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id").notNull(),
    version: integer("version").notNull(),
    authorId: text("author_id").notNull(),
    authorEmail: text("author_email").notNull(),
    graph: text("graph").notNull(),
    restoredFrom: integer("restored_from"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("versions_workflow").on(t.workflowId, t.version)],
);

export const credentials = sqliteTable("credentials", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  // AES-GCM ciphertext of the secret fields, never sent to a page.
  secret: text("secret").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const executions = sqliteTable(
  "executions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    version: integer("version").notNull(),
    triggerKind: text("trigger_kind").notNull(),
    startedById: text("started_by_id"),
    startedByEmail: text("started_by_email"),
    status: text("status").notNull(),
    input: text("input").notNull(),
    graph: text("graph").notNull(),
    error: text("error"),
    resumeAt: integer("resume_at"),
    retryOf: text("retry_of"),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (t) => [
    index("executions_workflow").on(t.workflowId, t.startedAt),
    index("executions_org").on(t.orgId, t.startedAt),
  ],
);

export const executionSteps = sqliteTable(
  "execution_steps",
  {
    id: text("id").primaryKey(),
    executionId: text("execution_id").notNull(),
    position: integer("position").notNull(),
    stepId: text("step_id").notNull(),
    stepName: text("step_name").notNull(),
    stepType: text("step_type").notNull(),
    status: text("status").notNull(),
    input: text("input").notNull(),
    // { port: items[] }
    output: text("output"),
    error: text("error"),
    reused: integer("reused", { mode: "boolean" }).notNull().default(false),
    startedAt: integer("started_at").notNull(),
    durationMs: integer("duration_ms"),
  },
  (t) => [index("steps_execution").on(t.executionId, t.position)],
);

export const dataTables = sqliteTable("data_tables", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  shared: integer("shared", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export const dataColumns = sqliteTable("data_columns", {
  id: text("id").primaryKey(),
  tableId: text("table_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  position: integer("position").notNull(),
});

export const dataRows = sqliteTable(
  "data_rows",
  {
    id: text("id").primaryKey(),
    tableId: text("table_id").notNull(),
    // { columnId: value }
    values: text("values").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("rows_table").on(t.tableId)],
);
