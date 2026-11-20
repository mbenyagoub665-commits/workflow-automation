import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, History, ListChecks, MoreHorizontal, Pencil, Play, Plus, Save, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/client/components/AppShell";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { NameDialog } from "@/client/components/NameDialog";
import { PageHeader } from "@/client/components/PageHeader";
import { StatusBadge } from "@/client/components/StatusBadge";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/client/components/ui/card";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Label } from "@/client/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/client/components/ui/native-select";
import { Switch } from "@/client/components/ui/switch";
import { StepConfig } from "@/client/editor/StepConfig";
import { ItemsView } from "@/client/editor/StepData";
import { SelectField, TextField } from "@/client/editor/fields";

import { useAction } from "@/client/lib/useAction";
import {
  defaultConfig,
  portsOf,
  STEP_LABELS,
  triggerKind,
  validateGraph,
  type Graph,
  type Step,
  type StepType,
} from "@/shared/graph";
import {
  deleteWorkflow,
  duplicateWorkflow,
  getWorkflow,
  regenerateWebhook,
  renameWorkflow,
  runWorkflow,
  saveWorkflow,
  setWorkflowActive,
  shareWorkflow,
  transferWorkflow,
} from "@/serverFunctions/app";

export const Route = createFileRoute("/workflows/$id/")({
  loader: ({ params }) => getWorkflow({ data: { id: params.id } }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData?.workflow.name ?? "Workflow" }] }),
  component: EditorPage,
});

const ADDABLE: StepType[] = ["http", "condition", "set", "wait", "approval", "email", "ai", "table"];
const PORT_LABELS: Record<string, string> = { main: "Next", true: "If true", false: "If false", approved: "If approved", rejected: "If rejected" };

function EditorPage() {
  const data = Route.useLoaderData();
  // A fresh editor per saved version: saving or restoring resets local edits.
  return <Editor key={`${data.workflow.id}:${data.workflow.version}`} data={data} />;
}

function Editor({ data }: { data: ReturnType<typeof Route.useLoaderData> }) {
  const { workflow, credentials, tables, latestRun, stepData, members } = data;
  const navigate = useNavigate();
  const { run, pending } = useAction();
  const [graph, setGraph] = useState<Graph>(data.graph);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(data.graph.steps[0]?.id ?? null);
  const [addType, setAddType] = useState<StepType>("http");
  const [dialog, setDialog] = useState<null | "rename" | "delete" | "transfer">(null);
  const [transferTo, setTransferTo] = useState("");
  const problems = useMemo(() => validateGraph(graph), [graph]);
  const selected = graph.steps.find((s) => s.id === selectedId) ?? null;
  const kind = triggerKind(data.graph);

  function update(next: Graph) {
    setGraph(next);
    setDirty(true);
  }
  function patchStep(id: string, patch: Partial<Step>) {
    update({ ...graph, steps: graph.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  }
  function addStep() {
    const label = STEP_LABELS[addType];
    let name = label;
    for (let n = 2; graph.steps.some((s) => s.name === name); n++) name = `${label} ${n}`;
    const step: Step = { id: crypto.randomUUID(), name, type: addType, config: defaultConfig(addType) };
    const from = selected ?? graph.steps[graph.steps.length - 1];
    const connections = [...graph.connections];
    if (from) connections.push({ from: from.id, port: portsOf(from.type)[0]!, to: step.id });
    const at = from ? graph.steps.findIndex((s) => s.id === from.id) + 1 : graph.steps.length;
    const steps = [...graph.steps];
    steps.splice(at, 0, step);
    update({ steps, connections });
    setSelectedId(step.id);
  }
  function removeStep(id: string) {
    update({
      steps: graph.steps.filter((s) => s.id !== id),
      connections: graph.connections.filter((c) => c.from !== id && c.to !== id),
    });
    setSelectedId(graph.steps[0]?.id ?? null);
  }
  function move(id: string, delta: number) {
    const i = graph.steps.findIndex((s) => s.id === id);
    const j = i + delta;
    if (j < 0 || j >= graph.steps.length) return;
    const steps = [...graph.steps];
    [steps[i], steps[j]] = [steps[j]!, steps[i]!];
    update({ ...graph, steps });
  }
  async function save() {
    if (problems.length) {
      toast.error(problems[0]);
      return false;
    }
    const saved = await run(() => saveWorkflow({ data: { id: workflow.id, graph } }), "Saved");
    return saved !== undefined;
  }
  async function runNow() {
    if (dirty && !(await save())) return;
    const result = await run(() => runWorkflow({ data: { id: workflow.id } }));
    if (result) {
      if (result.status === "failed") toast.error("The run failed");
      else toast.success(result.status === "waiting" ? "The run is waiting" : "The run finished");
    }
  }

  const activatable = kind === "schedule" || kind === "webhook";

  return (
    <AppShell wide>
      <PageHeader
        title={<span data-testid="workflow-title">{workflow.name}</span>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>Version {workflow.version}</span>
            <span>·</span>
            <span>{workflow.ownerEmail}</span>
            {workflow.shared && <Badge variant="secondary">Shared with the team</Badge>}
            {dirty && <Badge variant="outline" data-testid="unsaved">Unsaved changes</Badge>}
          </span>
        }
        actions={
          <>
            {activatable && (
              <Label className="mr-2 flex items-center gap-2">
                <Switch
                  data-testid="active-switch"
                  checked={workflow.active}
                  disabled={pending || dirty}
                  onCheckedChange={(active) =>
                    run(() => setWorkflowActive({ data: { id: workflow.id, active } }), active ? "Activated" : "Deactivated")
                  }
                />
                Active
              </Label>
            )}
            <Button variant="outline" data-testid="save" onClick={() => void save()} disabled={pending || !dirty}>
              <Save aria-hidden /> Save
            </Button>
            <Button data-testid="run" onClick={() => void runNow()} disabled={pending}>
              <Play aria-hidden /> Run
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="More" data-testid="workflow-menu" />}>
                <MoreHorizontal aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setDialog("rename")}>
                  <Pencil aria-hidden /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    run(async () => {
                      const copy = await duplicateWorkflow({ data: { id: workflow.id } });
                      await navigate({ to: "/workflows/$id", params: { id: copy.id } });
                    }, "Workflow duplicated")
                  }
                >
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link to="/workflows/$id/history" params={{ id: workflow.id }} />}>
                  <History aria-hidden /> Version history
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link to="/runs" search={{ workflowId: workflow.id }} />}>
                  <ListChecks aria-hidden /> Runs
                </DropdownMenuItem>
                {workflow.canManage && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      data-testid="toggle-share"
                      onClick={() =>
                        run(
                          () => shareWorkflow({ data: { id: workflow.id, shared: !workflow.shared } }),
                          workflow.shared ? "Now private" : "Shared with the team",
                        )
                      }
                    >
                      {workflow.shared ? "Make private" : "Share with the team"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDialog("transfer")}>Transfer ownership</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => setDialog("delete")}>
                      <Trash2 aria-hidden /> Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {latestRun && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          Latest run:
          <Link to="/runs/$id" params={{ id: latestRun.id }} className="underline" data-testid="latest-run">
            <StatusBadge status={latestRun.status} />
          </Link>
        </p>
      )}
      {problems.length > 0 && (
        <Alert variant="destructive" data-testid="problems">
          <AlertDescription>{problems.join(" ")}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
        <div className="space-y-3">
          <ol className="space-y-2" aria-label="Steps">
            {graph.steps.map((step, i) => {
              const outs = graph.connections.filter((c) => c.from === step.id);
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    data-testid="step-item"
                    data-name={step.name}
                    aria-current={step.id === selectedId}
                    onClick={() => setSelectedId(step.id)}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted aria-[current=true]:border-primary"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{step.name}</span>
                      {stepData[step.id] && <StatusBadge status={stepData[step.id]!.status} />}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {STEP_LABELS[step.type]}
                      {step.disabled ? " · off" : ""}
                      {outs.length > 0 &&
                        ` → ${outs
                          .map((c) => `${c.port === "main" ? "" : `${c.port}: `}${graph.steps.find((s) => s.id === c.to)?.name ?? "?"}`)
                          .join(", ")}`}
                    </span>
                  </button>
                  {step.id === selectedId && (
                    <div className="mt-1 flex gap-1">
                      <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0} onClick={() => move(step.id, -1)}>
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={i === graph.steps.length - 1} onClick={() => move(step.id, 1)}>
                        <ArrowDown aria-hidden />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="flex gap-2">
            <NativeSelect aria-label="Step type" data-testid="add-step-type" value={addType} onChange={(e) => setAddType(e.target.value as StepType)}>
              {ADDABLE.map((t) => (
                <NativeSelectOption key={t} value={t}>
                  {STEP_LABELS[t]}
                </NativeSelectOption>
              ))}
              <NativeSelectOption value="trigger">Trigger</NativeSelectOption>
            </NativeSelect>
            <Button variant="outline" data-testid="add-step" onClick={addStep}>
              <Plus aria-hidden /> Add step
            </Button>
          </div>
        </div>

        {selected ? (
          <div className="min-w-0 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{STEP_LABELS[selected.type]}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <TextField name="step-name" label="Name" value={selected.name} onChange={(name) => patchStep(selected.id, { name })} />
                <StepConfig
                  step={selected}
                  onChange={(config) => patchStep(selected.id, { config })}
                  context={{
                    credentials,
                    tables,
                    webhookUrl: workflow.webhookUrl,
                    onRegenerate: () => run(() => regenerateWebhook({ data: { id: workflow.id } }), "The old URL no longer works"),
                  }}
                />
                {selected.type !== "trigger" && (
                  <div className="flex flex-wrap items-end gap-4">
                    <SelectField
                      name="on-error"
                      label="On error"
                      value={selected.onError ?? "stop"}
                      options={[
                        ["stop", "Stop the run"],
                        ["continue", "Continue with the error"],
                      ]}
                      onChange={(v) => patchStep(selected.id, { onError: v as "stop" | "continue" })}
                    />
                    <Label className="flex h-8 items-center gap-2">
                      <Checkbox
                        data-testid="step-disabled"
                        checked={Boolean(selected.disabled)}
                        onCheckedChange={(checked) => patchStep(selected.id, { disabled: checked === true })}
                      />
                      Skip this step
                    </Label>
                  </div>
                )}
                <Connections graph={graph} step={selected} onChange={update} />
                <Button variant="outline" size="sm" data-testid="remove-step" onClick={() => removeStep(selected.id)}>
                  <Trash2 aria-hidden /> Remove step
                </Button>
              </CardContent>
            </Card>
            {stepData[selected.id] ? (
              <div className="grid gap-4 lg:grid-cols-2" data-testid="step-data">
                <ItemsView label="Input from the latest run" value={stepData[selected.id]!.input} testId="step-input" />
                {stepData[selected.id]!.error ? (
                  <ItemsView label="Error" value={stepData[selected.id]!.error} testId="step-error" />
                ) : (
                  <ItemsView label="Output from the latest run" value={stepData[selected.id]!.output} testId="step-output" />
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {dialog === "rename" && (
        <NameDialog
          title="Rename workflow"
          initial={workflow.name}
          submitLabel="Rename"
          onClose={() => setDialog(null)}
          onSubmit={(name) => run(() => renameWorkflow({ data: { id: workflow.id, name } }).then(() => setDialog(null)))}
        />
      )}
      {dialog === "delete" && (
        <ConfirmDialog
          title={`Delete ${workflow.name}?`}
          confirmLabel="Delete"
          destructive
          onClose={() => setDialog(null)}
          onConfirm={() =>
            run(async () => {
              await deleteWorkflow({ data: { id: workflow.id } });
              await navigate({ to: "/" });
            }, "Workflow deleted")
          }
        >
          Its runs and versions are deleted too.
        </ConfirmDialog>
      )}
      {dialog === "transfer" && (
        <ConfirmDialog
          title="Transfer ownership"
          confirmLabel="Transfer"
          onClose={() => setDialog(null)}
          onConfirm={() => {
            if (!transferTo) return;
            void run(async () => {
              await transferWorkflow({ data: { id: workflow.id, ownerId: transferTo } });
              setDialog(null);
            }, "Ownership transferred");
          }}
        >
          <NativeSelect aria-label="New owner" className="mt-2 w-full" value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
            <NativeSelectOption value="">Choose a member</NativeSelectOption>
            {members
              .filter((m: { id: string }) => m.id !== workflow.ownerId)
              .map((m: { id: string; email: string }) => (
                <NativeSelectOption key={m.id} value={m.id}>
                  {m.email}
                </NativeSelectOption>
              ))}
          </NativeSelect>
          <span className="mt-2 block">Steps that use the current owner's credentials stop working.</span>
        </ConfirmDialog>
      )}
    </AppShell>
  );
}

function Connections({ graph, step, onChange }: { graph: Graph; step: Step; onChange: (g: Graph) => void }) {
  const others = graph.steps.filter((s) => s.id !== step.id && s.type !== "trigger");
  return (
    <div className="space-y-3" data-testid="connections">
      {portsOf(step.type).map((port) => {
        const links = graph.connections.filter((c) => c.from === step.id && c.port === port);
        const free = others.filter((s) => !links.some((c) => c.to === s.id));
        return (
          <div key={port} className="space-y-1.5">
            <Label>{PORT_LABELS[port] ?? port}</Label>
            <div className="flex flex-wrap items-center gap-2">
              {links.map((c) => (
                <Badge key={c.to} variant="secondary" data-testid={`link-${port}`}>
                  {graph.steps.find((s) => s.id === c.to)?.name}
                  <button
                    type="button"
                    aria-label={`Disconnect ${graph.steps.find((s) => s.id === c.to)?.name}`}
                    onClick={() =>
                      onChange({ ...graph, connections: graph.connections.filter((x) => x !== c) })
                    }
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </Badge>
              ))}
              {free.length > 0 && (
                <NativeSelect
                  size="sm"
                  aria-label={`Connect ${PORT_LABELS[port] ?? port}`}
                  data-testid={`connect-${port}`}
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    onChange({ ...graph, connections: [...graph.connections, { from: step.id, port, to: e.target.value }] });
                  }}
                >
                  <NativeSelectOption value="">Connect to…</NativeSelectOption>
                  {free.map((s) => (
                    <NativeSelectOption key={s.id} value={s.id}>
                      {s.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

