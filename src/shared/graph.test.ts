import { describe, expect, it } from "vitest";
import {
  compare,
  currentSlot,
  diffGraphs,
  ExpressionError,
  resolveText,
  validateGraph,
  type Graph,
} from "./graph";

const base: Graph = {
  steps: [
    { id: "t", name: "Start", type: "trigger", config: { kind: "manual" } },
    { id: "a", name: "Check", type: "condition", config: { left: "", operator: "equals", right: "" } },
    { id: "b", name: "Yes", type: "set", config: { operations: [] } },
    { id: "c", name: "No", type: "set", config: { operations: [] } },
    { id: "d", name: "Join", type: "set", config: { operations: [] } },
  ],
  connections: [
    { from: "t", port: "main", to: "a" },
    { from: "a", port: "true", to: "b" },
    { from: "a", port: "false", to: "c" },
    { from: "b", port: "main", to: "d" },
    { from: "c", port: "main", to: "d" },
  ],
};

describe("validateGraph", () => {
  it("accepts branches that rejoin", () => {
    expect(validateGraph(base)).toEqual([]);
  });
  it("refuses a loop, two triggers and duplicate names", () => {
    const looped = { ...base, connections: [...base.connections, { from: "d", port: "main", to: "a" }] };
    expect(validateGraph(looped)).toContain("The steps form a loop.");
    const twoTriggers = { ...base, steps: [...base.steps, { id: "x", name: "Other", type: "trigger" as const, config: { kind: "manual" } }] };
    expect(validateGraph(twoTriggers).join()).toMatch(/exactly one trigger/);
    const dup = { ...base, steps: base.steps.map((s) => (s.id === "c" ? { ...s, name: "Yes" } : s)) };
    expect(validateGraph(dup)).toContain('Two steps are named "Yes".');
  });
});

describe("expressions", () => {
  const scope = {
    json: { user: { name: "Ada", tags: ["x"] }, n: 3 },
    node: (name: string) => (name === "Fetch" ? { id: 7 } : undefined),
  };
  it("resolves $json and $node paths", () => {
    expect(resolveText("{{ $json.user.name }}", scope)).toBe("Ada");
    expect(resolveText("{{ $json.n }}", scope)).toBe(3);
    expect(resolveText('Hi {{ $json.user.tags[0] }} #{{ $node["Fetch"].json.id }}', scope)).toBe("Hi x #7");
  });
  it("fails on what can't resolve", () => {
    expect(() => resolveText("{{ $json.missing }}", scope)).toThrow(ExpressionError);
    expect(() => resolveText('{{ $node["Nope"].json.id }}', scope)).toThrow(/Nope/);
  });
});

describe("compare and diff", () => {
  it("compares", () => {
    expect(compare(5, "greaterThan", "3")).toBe(true);
    expect(compare("", "isEmpty", "")).toBe(true);
    expect(compare("abc", "contains", "b")).toBe(true);
  });
  it("diffs steps", () => {
    const after: Graph = {
      steps: [...base.steps.filter((s) => s.id !== "c"), { id: "e", name: "New", type: "wait" as const, config: {} }].map((s) =>
        s.id === "b" ? { ...s, name: "Yes!" } : s,
      ),
      connections: base.connections.filter((c) => c.to !== "c" && c.from !== "c"),
    };
    const changes = diffGraphs(base, after);
    expect(changes).toContainEqual({ id: "e", name: "New", change: "added" });
    expect(changes).toContainEqual({ id: "c", name: "No", change: "removed" });
    expect(changes).toContainEqual({ id: "b", name: "Yes!", change: "changed" });
  });
  it("finds the due daily slot", () => {
    const now = new Date("2026-01-01T10:30:00Z");
    const slot = currentSlot({ mode: "daily", time: "09:00" }, now);
    expect(new Date(slot * 60000).toISOString()).toBe("2026-01-01T09:00:00.000Z");
  });
});
