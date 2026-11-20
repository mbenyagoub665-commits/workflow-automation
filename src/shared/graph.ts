// The workflow graph, shared by the editor and the server. Pure: no I/O.

export type StepType =
  | "trigger"
  | "http"
  | "condition"
  | "set"
  | "wait"
  | "approval"
  | "email"
  | "ai"
  | "table";

export type TriggerConfig = {
  kind: "manual" | "schedule" | "webhook";
  schedule?: {
    mode: "minutes" | "hours" | "daily" | "weekly";
    every?: number;
    time?: string; // HH:MM, UTC
    weekday?: number; // 0 = Sunday
  };
  webhook?: { method: "GET" | "POST"; respond: "immediately" | "lastStep" };
};

/** A JSON value parsed from storage or a request. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export type Pair = { name: string; value: string };

export type Step = {
  id: string;
  name: string;
  type: StepType;
  disabled?: boolean;
  onError?: "stop" | "continue";
  config: Record<string, Json>;
};

export type Connection = { from: string; port: string; to: string };

export type Graph = { steps: Step[]; connections: Connection[] };

export type Item = Record<string, Json>;

export const STEP_LABELS: Record<StepType, string> = {
  trigger: "Trigger",
  http: "HTTP request",
  condition: "Condition",
  set: "Set fields",
  wait: "Wait",
  approval: "Approval",
  email: "Send email",
  ai: "AI prompt",
  table: "Data table",
};

/** The outputs a step of this type has. */
export function portsOf(type: StepType): string[] {
  if (type === "condition") return ["true", "false"];
  if (type === "approval") return ["approved", "rejected"];
  return ["main"];
}

export const CONDITION_OPERATORS = [
  ["equals", "equals"],
  ["notEquals", "does not equal"],
  ["contains", "contains"],
  ["greaterThan", "is greater than"],
  ["lessThan", "is less than"],
  ["isEmpty", "is empty"],
  ["isTrue", "is true"],
] as const;

export function defaultConfig(type: StepType): Record<string, Json> {
  switch (type) {
    case "trigger":
      return { kind: "manual" };
    case "http":
      return { method: "GET", url: "", headers: [], query: [], body: "", credentialId: "", timeoutSeconds: 30 };
    case "condition":
      return { left: "", operator: "equals", right: "" };
    case "set":
      return { operations: [] };
    case "wait":
      return { amount: 1, unit: "minutes" };
    case "approval":
      return { message: "" };
    case "email":
      return { to: "", subject: "", body: "" };
    case "ai":
      return { prompt: "", schema: "" };
    case "table":
      return { tableId: "", operation: "insert", values: [], filterColumn: "", filterValue: "" };
  }
}

export function triggerOf(graph: Graph): Step | undefined {
  return graph.steps.find((s) => s.type === "trigger");
}

export function triggerKind(graph: Graph): TriggerConfig["kind"] {
  const t = triggerOf(graph);
  return ((t?.config as TriggerConfig | undefined)?.kind ?? "manual") as TriggerConfig["kind"];
}

/** Problems that stop a save, as sentences. Empty when the graph is valid. */
export function validateGraph(graph: Graph): string[] {
  const problems: string[] = [];
  const triggers = graph.steps.filter((s) => s.type === "trigger");
  if (triggers.length !== 1)
    problems.push(`A workflow needs exactly one trigger; this one has ${triggers.length}.`);
  const names = new Map<string, number>();
  for (const step of graph.steps) {
    const name = step.name.trim();
    if (!name) problems.push("Every step needs a name.");
    names.set(name, (names.get(name) ?? 0) + 1);
  }
  for (const [name, count] of names)
    if (name && count > 1) problems.push(`Two steps are named "${name}".`);
  const ids = new Map(graph.steps.map((s) => [s.id, s]));
  for (const c of graph.connections) {
    const from = ids.get(c.from);
    const to = ids.get(c.to);
    if (!from || !to) {
      problems.push("A connection points at a step that no longer exists.");
      continue;
    }
    if (!portsOf(from.type).includes(c.port))
      problems.push(`"${from.name}" has no "${c.port}" output.`);
    if (to.type === "trigger") problems.push("Nothing can connect into the trigger.");
    if (c.from === c.to) problems.push(`"${from.name}" connects to itself.`);
  }
  if (hasCycle(graph)) problems.push("The steps form a loop.");
  const trigger = triggers[0];
  if (trigger) {
    const t = trigger.config as TriggerConfig;
    if (t.kind === "schedule") {
      const s = t.schedule;
      if (!s) problems.push("Choose when the schedule runs.");
      else if ((s.mode === "minutes" || s.mode === "hours") && !(Number.isInteger(s.every) && (s.every ?? 0) >= 1))
        problems.push("The schedule's interval must be a whole number of at least 1.");
      else if ((s.mode === "daily" || s.mode === "weekly") && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time ?? ""))
        problems.push("The schedule's time must be HH:MM.");
    }
  }
  return [...new Set(problems)];
}

function hasCycle(graph: Graph): boolean {
  return topologicalOrder(graph) === null;
}

/** Step ids in an order where each comes after everything feeding it; null on a loop. */
export function topologicalOrder(graph: Graph): string[] | null {
  const incoming = new Map<string, number>(graph.steps.map((s) => [s.id, 0]));
  for (const c of graph.connections)
    if (incoming.has(c.to) && incoming.has(c.from)) incoming.set(c.to, incoming.get(c.to)! + 1);
  const position = new Map(graph.steps.map((s, i) => [s.id, i]));
  const ready = graph.steps.filter((s) => incoming.get(s.id) === 0).map((s) => s.id);
  const order: string[] = [];
  while (ready.length) {
    ready.sort((a, b) => position.get(a)! - position.get(b)!);
    const id = ready.shift()!;
    order.push(id);
    for (const c of graph.connections) {
      if (c.from !== id || !incoming.has(c.to)) continue;
      const left = incoming.get(c.to)! - 1;
      incoming.set(c.to, left);
      if (left === 0) ready.push(c.to);
    }
  }
  return order.length === graph.steps.length ? order : null;
}

export type StepChange = { id: string; name: string; change: "added" | "removed" | "changed" };

/** What changed from `before` to `after`, step by step. */
export function diffGraphs(before: Graph | null, after: Graph): StepChange[] {
  const changes: StepChange[] = [];
  const old = new Map((before?.steps ?? []).map((s) => [s.id, s]));
  const links = (g: Graph | null, id: string) =>
    JSON.stringify(
      (g?.connections ?? [])
        .filter((c) => c.from === id)
        .map((c) => `${c.port}>${c.to}`)
        .sort(),
    );
  for (const step of after.steps) {
    const prev = old.get(step.id);
    if (!prev) changes.push({ id: step.id, name: step.name, change: "added" });
    else if (
      JSON.stringify(stable(prev)) !== JSON.stringify(stable(step)) ||
      links(before, step.id) !== links(after, step.id)
    )
      changes.push({ id: step.id, name: step.name, change: "changed" });
    old.delete(step.id);
  }
  for (const step of old.values()) changes.push({ id: step.id, name: step.name, change: "removed" });
  return changes;
}

function stable(step: Step) {
  return {
    name: step.name,
    type: step.type,
    disabled: Boolean(step.disabled),
    onError: step.onError ?? "stop",
    config: sortKeys(step.config),
  };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  return value;
}

// ---- Expressions: {{ $json.a.b }} and {{ $node["Step"].json.a }} ----

export class ExpressionError extends Error {}

const EXPRESSION = /\{\{\s*([\s\S]*?)\s*\}\}/g;

type Scope = { json: Item; node: (name: string) => Item | undefined };

/** Resolves every expression in `text`. A field that is one whole expression keeps the value's type. */
export function resolveText(text: string, scope: Scope): unknown {
  const whole = /^\{\{\s*([\s\S]*?)\s*\}\}$/.exec(text.trim());
  if (whole && text.trim().indexOf("{{", 2) === -1) return evaluate(whole[1]!, scope);
  return text.replace(EXPRESSION, (_m, expr: string) => {
    const value = evaluate(expr, scope);
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

/** Resolves expressions in every string inside `value`. */
export function resolveDeep(value: unknown, scope: Scope): unknown {
  if (typeof value === "string") return value.includes("{{") ? resolveText(value, scope) : value;
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, scope));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveDeep(v, scope)]));
  return value;
}

function evaluate(expr: string, scope: Scope): unknown {
  let rest = expr.trim();
  let value: unknown;
  let start: RegExpExecArray | null;
  if ((start = /^\$json/.exec(rest))) {
    value = scope.json;
    rest = rest.slice(start[0].length);
  } else if ((start = /^\$node\[\s*(["'])(.*?)\1\s*\]\.json/.exec(rest))) {
    const name = start[2]!;
    value = scope.node(name);
    if (value === undefined)
      throw new ExpressionError(`{{ ${expr} }}: step "${name}" has no output in this run.`);
    rest = rest.slice(start[0].length);
  } else {
    throw new ExpressionError(`{{ ${expr} }}: an expression starts with $json or $node["Step name"].json.`);
  }
  const path = /^(?:\.([A-Za-z_$][\w$]*)|\[\s*(\d+)\s*\]|\[\s*(["'])(.*?)\3\s*\])/;
  while (rest.length) {
    const m = path.exec(rest);
    if (!m) throw new ExpressionError(`{{ ${expr} }}: can't read "${rest}".`);
    const key = m[1] ?? m[2] ?? m[4]!;
    if (value === null || typeof value !== "object" || !(key in (value as object)))
      throw new ExpressionError(`{{ ${expr} }}: there is no "${key}" here.`);
    value = (value as Record<string, unknown>)[key];
    rest = rest.slice(m[0].length);
  }
  return value;
}

// ---- Conditions ----

export function compare(left: unknown, operator: string, right: unknown): boolean {
  const ls = left === undefined || left === null ? "" : typeof left === "string" ? left : JSON.stringify(left);
  const rs = right === undefined || right === null ? "" : typeof right === "string" ? right : JSON.stringify(right);
  switch (operator) {
    case "equals":
      return ls === rs;
    case "notEquals":
      return ls !== rs;
    case "contains":
      return ls.includes(rs);
    case "greaterThan":
      return Number(left) > Number(right);
    case "lessThan":
      return Number(left) < Number(right);
    case "isEmpty":
      return (
        left === undefined ||
        left === null ||
        ls === "" ||
        (Array.isArray(left) && left.length === 0) ||
        (typeof left === "object" && Object.keys(left as object).length === 0)
      );
    case "isTrue":
      return left === true || ls === "true";
    default:
      return false;
  }
}

// ---- Schedules ----

/** The most recent slot (epoch minutes) at or before `now`, for a schedule. */
export function currentSlot(schedule: NonNullable<TriggerConfig["schedule"]>, now: Date): number {
  const minutes = Math.floor(now.getTime() / 60000);
  const every = Math.max(1, Math.floor(schedule.every ?? 1));
  if (schedule.mode === "minutes") return minutes - (minutes % every);
  if (schedule.mode === "hours") {
    const hours = Math.floor(minutes / 60);
    return (hours - (hours % every)) * 60;
  }
  const [h, m] = (schedule.time ?? "00:00").split(":").map(Number);
  const day = Math.floor(minutes / 1440);
  let slot = day * 1440 + h! * 60 + m!;
  if (schedule.mode === "daily") return slot > minutes ? slot - 1440 : slot;
  // weekly: 1970-01-01 was a Thursday (4).
  const weekday = schedule.weekday ?? 1;
  const today = (day + 4) % 7;
  slot -= ((today - weekday + 7) % 7) * 1440;
  return slot > minutes ? slot - 7 * 1440 : slot;
}

/** The slot recorded on activation: interval schedules fire in the current slot, timed ones wait for the next. */
export function slotOnActivation(schedule: NonNullable<TriggerConfig["schedule"]>, now: Date): number {
  const slot = currentSlot(schedule, now);
  return schedule.mode === "minutes" || schedule.mode === "hours" ? slot - 1 : slot;
}
