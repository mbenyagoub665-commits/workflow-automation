import { env } from "cloudflare:workers";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { credentials } from "@/db/schema";
import { NotFound, type Actor } from "./access";

const secretFields = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("header"), headerName: z.string().trim().min(1, "Header name is required").max(200), headerValue: z.string().min(1, "Value is required").max(4000) }),
  z.object({ kind: z.literal("bearer"), token: z.string().min(1, "Token is required").max(4000) }),
  z.object({ kind: z.literal("basic"), username: z.string().min(1, "Username is required").max(400), password: z.string().max(4000) }),
]);
export type CredentialSecret = z.infer<typeof secretFields>;

export const saveCredentialInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Name is required").max(120),
  secret: secretFields.optional(),
});
export const credentialIdInput = z.object({ id: z.string() });

async function key(): Promise<CryptoKey> {
  const raw = env.CREDENTIALS_KEY;
  if (!raw) throw new Error("CREDENTIALS_KEY isn't set, so credentials can't be stored.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function encrypt(secret: CredentialSecret): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(secret));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), data));
  return `${b64(iv)}.${b64(sealed)}`;
}

async function decrypt(text: string): Promise<CredentialSecret> {
  const [iv, sealed] = text.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv!) }, await key(), unb64(sealed!));
  return JSON.parse(new TextDecoder().decode(plain)) as CredentialSecret;
}

const shown = { id: credentials.id, name: credentials.name, kind: credentials.kind, updatedAt: credentials.updatedAt };

/** The member's own credentials; never their secret values. */
export function listCredentials(actor: Actor) {
  return db
    .select(shown)
    .from(credentials)
    .where(and(eq(credentials.orgId, actor.orgId), eq(credentials.ownerId, actor.id)))
    .orderBy(desc(credentials.updatedAt));
}

/** Names of a workflow owner's credentials, for picking one in a step. */
export function credentialNamesOf(orgId: string, ownerId: string) {
  return db
    .select({ id: credentials.id, name: credentials.name })
    .from(credentials)
    .where(and(eq(credentials.orgId, orgId), eq(credentials.ownerId, ownerId)))
    .orderBy(credentials.name);
}

export async function saveCredential(actor: Actor, input: z.infer<typeof saveCredentialInput>) {
  const now = Date.now();
  if (!input.id) {
    if (!input.secret) throw new Error("Enter the secret to save.");
    const id = crypto.randomUUID();
    await db.insert(credentials).values({
      id,
      orgId: actor.orgId,
      ownerId: actor.id,
      name: input.name,
      kind: input.secret.kind,
      secret: await encrypt(input.secret),
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }
  const change: Partial<typeof credentials.$inferInsert> = { name: input.name, updatedAt: now };
  if (input.secret) {
    change.kind = input.secret.kind;
    change.secret = await encrypt(input.secret);
  }
  const [row] = await db
    .update(credentials)
    .set(change)
    .where(and(eq(credentials.id, input.id), eq(credentials.orgId, actor.orgId), eq(credentials.ownerId, actor.id)))
    .returning({ id: credentials.id });
  if (!row) throw new NotFound("That credential");
  return row;
}

export async function deleteCredential(actor: Actor, id: string) {
  const [row] = await db
    .delete(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.orgId, actor.orgId), eq(credentials.ownerId, actor.id)))
    .returning({ id: credentials.id });
  if (!row) throw new NotFound("That credential");
  return row;
}

/** The decrypted secret of a credential the workflow owner owns, or null. */
export async function credentialForRun(orgId: string, ownerId: string, id: string) {
  const [row] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.orgId, orgId), eq(credentials.ownerId, ownerId)));
  if (!row) return null;
  return { name: row.name, secret: await decrypt(row.secret) };
}
