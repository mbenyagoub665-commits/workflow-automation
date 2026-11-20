import { createFileRoute } from "@tanstack/react-router";
import { waitUntil } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { startRun } from "@/server/engine";
import { triggerOf, type Graph, type TriggerConfig } from "@/shared/graph";

// Public (everyapp.config.ts): anyone holding a workflow's unguessable URL
// may start it while it is active. Everything else answers 404.
const HIDDEN_HEADERS = /^(host|cookie|authorization|x-everyapp-|cf-|x-forwarded-|x-real-ip)/i;

async function handle(request: Request, token: string): Promise<Response> {
  const notFound = () => Response.json({ error: "Not found" }, { status: 404 });
  if (!token || token.length < 20) return notFound();
  const [wf] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.webhookToken, token), eq(workflows.active, true), eq(workflows.triggerKind, "webhook")));
  if (!wf) return notFound();
  const trigger = triggerOf(JSON.parse(wf.graph) as Graph)?.config as TriggerConfig;
  const method = trigger.webhook?.method ?? "POST";
  if (request.method !== method) return notFound();

  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (!HIDDEN_HEADERS.test(key)) headers[key] = value;
  });
  let body: unknown = null;
  if (request.method === "POST") {
    const type = request.headers.get("content-type") ?? "";
    const text = await request.text();
    if (type.includes("application/json")) {
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        return Response.json({ error: "The body isn't valid JSON." }, { status: 400 });
      }
    } else if (type.includes("application/x-www-form-urlencoded")) {
      body = Object.fromEntries(new URLSearchParams(text));
    } else body = text;
  }
  const input = [{ method: request.method, query: Object.fromEntries(url.searchParams), headers, body }];

  if ((trigger.webhook?.respond ?? "immediately") === "immediately") {
    const id = crypto.randomUUID();
    waitUntil(startRun(wf, "webhook", input, null, { id }));
    return Response.json({ runId: id, status: "started" }, { status: 202 });
  }
  const run = await startRun(wf, "webhook", input, null);
  if (run.status === "succeeded") {
    const out = run.lastOutput ?? [];
    return Response.json(out.length === 1 ? out[0] : out);
  }
  return Response.json({ runId: run.id, status: run.status }, { status: run.status === "failed" ? 500 : 202 });
}

export const Route = createFileRoute("/hook/$token")({
  server: {
    handlers: {
      GET: ({ request, params }) => handle(request, params.token),
      POST: ({ request, params }) => handle(request, params.token),
    },
  },
});
