import { and, asc, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { dataColumns, dataRows, dataTables, users } from "@/db/schema";
import { manages, NotFound, Refused, visibleTo, type Actor } from "./access";

export const COLUMN_TYPES = ["text", "number", "boolean", "date"] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

const name = z.string().trim().min(1, "Name is required").max(120);
export const createTableInput = z.object({
  name,
  columns: z.array(z.object({ name, type: z.enum(COLUMN_TYPES) })).max(50),
});
export const tableIdInput = z.object({ id: z.string() });
export const renameTableInput = z.object({ id: z.string(), name });
export const shareTableInput = z.object({ id: z.string(), shared: z.boolean() });
export const transferTableInput = z.object({ id: z.string(), ownerId: z.string() });
export const addColumnInput = z.object({ tableId: z.string(), name, type: z.enum(COLUMN_TYPES) });
export const renameColumnInput = z.object({ tableId: z.string(), columnId: z.string(), name });
export const deleteColumnInput = z.object({ tableId: z.string(), columnId: z.string() });
export const saveRowInput = z.object({
  tableId: z.string(),
  rowId: z.string().optional(),
  values: z.record(z.string(), z.unknown()),
});
export const deleteRowInput = z.object({ tableId: z.string(), rowId: z.string() });

/** `value` as a `type` column holds it; throws when it doesn't fit. Empty is null. */
export function coerce(type: string, column: string, value: unknown): string | number | boolean | null {
  if (value === null || value === undefined || value === "") return null;
  if (type === "text") {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  } else if (type === "number") {
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
    if (Number.isFinite(n)) return n;
  } else if (type === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "false") return value === "true";
  } else if (type === "date") {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value)))
      return value.length === 10 ? value : new Date(value).toISOString();
  }
  throw new Refused(`"${column}" takes a ${type}; ${JSON.stringify(value)} isn't one.`);
}

const tableShown = {
  id: dataTables.id,
  name: dataTables.name,
  shared: dataTables.shared,
  ownerId: dataTables.ownerId,
  ownerEmail: users.email,
  createdAt: dataTables.createdAt,
};

export function listTables(actor: Actor) {
  return db
    .select(tableShown)
    .from(dataTables)
    .leftJoin(users, eq(users.id, dataTables.ownerId))
    .where(visibleTo(actor, dataTables))
    .orderBy(desc(dataTables.createdAt));
}

async function visibleTable(actor: Actor, id: string) {
  const [row] = await db
    .select()
    .from(dataTables)
    .where(and(eq(dataTables.id, id), visibleTo(actor, dataTables)));
  if (!row) throw new NotFound("That table");
  return row;
}

async function columnsOf(tableId: string) {
  return db.select().from(dataColumns).where(eq(dataColumns.tableId, tableId)).orderBy(asc(dataColumns.position));
}

export async function getTable(actor: Actor, id: string) {
  const table = await visibleTable(actor, id);
  const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, table.ownerId));
  const columns = await columnsOf(id);
  const rows = await db.select().from(dataRows).where(eq(dataRows.tableId, id)).orderBy(asc(dataRows.createdAt)).limit(2000);
  return {
    table: { ...table, ownerEmail: owner?.email ?? null, canManage: manages(actor, table) },
    columns: columns.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    rows: rows.map((r) => ({ id: r.id, values: JSON.parse(r.values) as Record<string, string | number | boolean | null> })),
  };
}

export async function createTable(actor: Actor, input: z.infer<typeof createTableInput>) {
  uniqueNames(input.columns.map((c) => c.name));
  const id = crypto.randomUUID();
  await db.batch([
    db.insert(dataTables).values({ id, orgId: actor.orgId, ownerId: actor.id, name: input.name, createdAt: Date.now() }),
    ...input.columns.map((c, i) =>
      db.insert(dataColumns).values({ id: crypto.randomUUID(), tableId: id, name: c.name, type: c.type, position: i }),
    ),
  ]);
  return { id };
}

function uniqueNames(names: string[]) {
  const seen = new Set<string>();
  for (const n of names) {
    if (seen.has(n.toLowerCase())) throw new Refused(`Two columns are named "${n}".`);
    seen.add(n.toLowerCase());
  }
}

export async function renameTable(actor: Actor, input: z.infer<typeof renameTableInput>) {
  await visibleTable(actor, input.id);
  await db.update(dataTables).set({ name: input.name }).where(eq(dataTables.id, input.id));
}

export async function shareTable(actor: Actor, input: z.infer<typeof shareTableInput>) {
  const table = await visibleTable(actor, input.id);
  if (!manages(actor, table)) throw new Refused("Only the owner or an admin can change sharing.");
  await db.update(dataTables).set({ shared: input.shared }).where(eq(dataTables.id, input.id));
}

export async function transferTable(actor: Actor, input: z.infer<typeof transferTableInput>) {
  const table = await visibleTable(actor, input.id);
  if (!manages(actor, table)) throw new Refused("Only the owner or an admin can transfer this table.");
  const [target] = await db.select().from(users).where(and(eq(users.id, input.ownerId), eq(users.orgId, actor.orgId)));
  if (!target) throw new NotFound("That member");
  await db.update(dataTables).set({ ownerId: target.id }).where(eq(dataTables.id, input.id));
}

export async function deleteTable(actor: Actor, id: string) {
  const table = await visibleTable(actor, id);
  if (!manages(actor, table)) throw new Refused("Only the owner or an admin can delete this table.");
  await db.batch([
    db.delete(dataRows).where(eq(dataRows.tableId, id)),
    db.delete(dataColumns).where(eq(dataColumns.tableId, id)),
    db.delete(dataTables).where(eq(dataTables.id, id)),
  ]);
}

export async function addColumn(actor: Actor, input: z.infer<typeof addColumnInput>) {
  await visibleTable(actor, input.tableId);
  const columns = await columnsOf(input.tableId);
  uniqueNames([...columns.map((c) => c.name), input.name]);
  await db.insert(dataColumns).values({
    id: crypto.randomUUID(),
    tableId: input.tableId,
    name: input.name,
    type: input.type,
    position: columns.length ? Math.max(...columns.map((c) => c.position)) + 1 : 0,
  });
}

export async function renameColumn(actor: Actor, input: z.infer<typeof renameColumnInput>) {
  await visibleTable(actor, input.tableId);
  const columns = await columnsOf(input.tableId);
  uniqueNames([...columns.filter((c) => c.id !== input.columnId).map((c) => c.name), input.name]);
  await db
    .update(dataColumns)
    .set({ name: input.name })
    .where(and(eq(dataColumns.id, input.columnId), eq(dataColumns.tableId, input.tableId)));
}

export async function deleteColumn(actor: Actor, input: z.infer<typeof deleteColumnInput>) {
  await visibleTable(actor, input.tableId);
  await db.delete(dataColumns).where(and(eq(dataColumns.id, input.columnId), eq(dataColumns.tableId, input.tableId)));
}

/** Values keyed by column id, checked against each column's type. */
function checkedValues(columns: { id: string; name: string; type: string }[], values: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const c of columns) if (c.id in values) out[c.id] = coerce(c.type, c.name, values[c.id]);
  return out;
}

export async function saveRow(actor: Actor, input: z.infer<typeof saveRowInput>) {
  await visibleTable(actor, input.tableId);
  const columns = await columnsOf(input.tableId);
  const values = checkedValues(columns, input.values);
  if (!input.rowId) {
    const id = crypto.randomUUID();
    await db.insert(dataRows).values({ id, tableId: input.tableId, values: JSON.stringify(values), createdAt: Date.now() });
    return { id };
  }
  const [row] = await db
    .select()
    .from(dataRows)
    .where(and(eq(dataRows.id, input.rowId), eq(dataRows.tableId, input.tableId)));
  if (!row) throw new NotFound("That row");
  const merged = { ...JSON.parse(row.values), ...values };
  await db.update(dataRows).set({ values: JSON.stringify(merged) }).where(eq(dataRows.id, row.id));
  return { id: row.id };
}

export async function deleteRow(actor: Actor, input: z.infer<typeof deleteRowInput>) {
  await visibleTable(actor, input.tableId);
  await db.delete(dataRows).where(and(eq(dataRows.id, input.rowId), eq(dataRows.tableId, input.tableId)));
}

// ---- For Data table steps: run as the workflow's owner ----

export async function tableForRun(orgId: string, ownerId: string, tableId: string) {
  const [table] = await db
    .select()
    .from(dataTables)
    .where(
      and(
        eq(dataTables.id, tableId),
        eq(dataTables.orgId, orgId),
        or(eq(dataTables.ownerId, ownerId), eq(dataTables.shared, true)),
      ),
    );
  if (!table) return null;
  const columns = await columnsOf(tableId);
  return { table, columns };
}

type Column = { id: string; name: string; type: string };

/** Values keyed by column name → keyed by id, typed. */
export function valuesByName(columns: Column[], pairs: { column: string; value: unknown }[]) {
  const out: Record<string, unknown> = {};
  for (const p of pairs) {
    const column = columns.find((c) => c.name === p.column);
    if (!column) throw new Refused(`The table has no column "${p.column}".`);
    out[column.id] = coerce(column.type, column.name, p.value);
  }
  return out;
}

export function rowAsItem(columns: Column[], row: { id: string; values: string }) {
  const values = JSON.parse(row.values) as Record<string, unknown>;
  const item: Record<string, unknown> = { id: row.id };
  for (const c of columns) item[c.name] = values[c.id] ?? null;
  return item;
}

export async function findRows(tableId: string, columns: Column[], filter: { column: string; value: unknown } | null) {
  const rows = await db.select().from(dataRows).where(eq(dataRows.tableId, tableId)).orderBy(asc(dataRows.createdAt));
  if (!filter || !filter.column) return rows;
  const column = columns.find((c) => c.name === filter.column);
  if (!column) throw new Refused(`The table has no column "${filter.column}".`);
  const want = coerce(column.type, column.name, filter.value);
  return rows.filter((r) => (JSON.parse(r.values)[column.id] ?? null) === want);
}

export async function insertRowForRun(tableId: string, values: Record<string, unknown>) {
  const id = crypto.randomUUID();
  await db.insert(dataRows).values({ id, tableId, values: JSON.stringify(values), createdAt: Date.now() });
  return { id, values: JSON.stringify(values) };
}

export async function updateRowsForRun(rows: { id: string; values: string }[], values: Record<string, unknown>) {
  const updated = rows.map((r) => ({ id: r.id, values: JSON.stringify({ ...JSON.parse(r.values), ...values }) }));
  if (updated.length)
    await db.batch(
      updated.map((r) => db.update(dataRows).set({ values: r.values }).where(eq(dataRows.id, r.id))) as [never, ...never[]],
    );
  return updated;
}

export async function deleteRowsForRun(rows: { id: string }[]) {
  if (rows.length)
    await db.batch(rows.map((r) => db.delete(dataRows).where(eq(dataRows.id, r.id))) as [never, ...never[]]);
}
