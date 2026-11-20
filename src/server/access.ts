import { isAdmin, type EveryAppUser } from "@every-app/sdk/server";
import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "@/db";
import { users } from "@/db/schema";

/** The signed-in member as the queries see them. */
export type Actor = { id: string; email: string; orgId: string; admin: boolean };

/** The member, recorded on first sight (email from the Gateway's identity). */
export async function actorFrom(user: EveryAppUser): Promise<Actor> {
  await db
    .insert(users)
    .values({ id: user.id, orgId: user.orgId, email: user.email, createdAt: Date.now() })
    .onConflictDoUpdate({ target: users.id, set: { email: user.email, orgId: user.orgId } });
  return { id: user.id, email: user.email, orgId: user.orgId, admin: isAdmin(user) };
}

type OwnedTable = { orgId: SQLiteColumn; ownerId: SQLiteColumn; shared: SQLiteColumn };

/** Rows of the member's organization they may see: their own, shared ones, or all for an admin. */
export function visibleTo(actor: Actor, t: OwnedTable): SQL {
  if (actor.admin) return eq(t.orgId, actor.orgId);
  return and(eq(t.orgId, actor.orgId), or(eq(t.ownerId, actor.id), eq(t.shared, true)))!;
}

/** Whether the member may delete, unshare or hand over a row. */
export function manages(actor: Actor, row: { ownerId: string }): boolean {
  return actor.admin || row.ownerId === actor.id;
}

export class NotFound extends Error {
  constructor(what = "That item") {
    super(`${what} doesn't exist or isn't shared with you.`);
  }
}

export class Refused extends Error {}

export async function membersOf(orgId: string) {
  return db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.orgId, orgId))
    .orderBy(users.email);
}

export async function emailsOf(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r.email]));
}
