import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, RefreshCw, RotateCcw, Square, X } from "lucide-react";
import { AppShell } from "@/client/components/AppShell";
import { BackLink } from "@/client/components/BackLink";
import { PageHeader } from "@/client/components/PageHeader";
import { StatusBadge } from "@/client/components/StatusBadge";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/client/components/ui/card";
import { ItemsView } from "@/client/editor/StepData";
import { formatDuration, formatTime, TRIGGER_LABELS } from "@/client/lib/format";
import { useAction } from "@/client/lib/useAction";
import { STEP_LABELS, type StepType } from "@/shared/graph";
import { cancelRun, decideRun, getRun, replayRun, retryRun } from "@/serverFunctions/app";

export const Route = createFileRoute("/runs/$id")({
  loader: ({ params }) => getRun({ data: { id: params.id } }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? `Run of ${loaderData.run.workflowName}` : "Run" }] }),
  component: RunPage,
});

function RunPage() {
  const { run: execution, steps } = Route.useLoaderData();
  const navigate = useNavigate();
  const { run, pending } = useAction();
  const waitingApproval = execution.status === "waiting" && steps.some((s) => s.status === "waiting" && s.stepType === "approval");
  const open = (id: string) => navigate({ to: "/runs/$id", params: { id } });

  return (
    <AppShell wide>
      <PageHeader
        backLink={<BackLink to="/runs" search={{ workflowId: execution.workflowId }}>Runs</BackLink>}
        title={
          <span className="flex items-center gap-3">
            <Link to="/workflows/$id" params={{ id: execution.workflowId }} className="hover:underline">
              {execution.workflowName}
            </Link>
            <StatusBadge status={execution.status} />
          </span>
        }
        description={
          <span data-testid="run-meta">
            Version {execution.version} · {TRIGGER_LABELS[execution.triggerKind] ?? execution.triggerKind}
            {execution.startedByEmail ? ` by ${execution.startedByEmail}` : ""} · started {formatTime(execution.startedAt)}
            {execution.finishedAt ? ` · ended ${formatTime(execution.finishedAt)}` : ""}
          </span>
        }
        actions={
          <>
            {(execution.status === "running" || execution.status === "waiting") && (
              <Button variant="outline" data-testid="cancel-run" disabled={pending} onClick={() => run(() => cancelRun({ data: { id: execution.id } }), "Run cancelled")}>
                <Square aria-hidden /> Cancel
              </Button>
            )}
            {execution.status === "failed" && (
              <Button
                variant="outline"
                data-testid="retry-run"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const next = await retryRun({ data: { id: execution.id } });
                    await open(next.id);
                  })
                }
              >
                <RotateCcw aria-hidden /> Retry from failed step
              </Button>
            )}
            <Button
              variant="outline"
              data-testid="replay-run"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const next = await replayRun({ data: { id: execution.id } });
                  await open(next.id);
                })
              }
            >
              <RefreshCw aria-hidden /> Replay
            </Button>
          </>
        }
      />
      {execution.retryOf && (
        <p className="text-sm text-muted-foreground">
          Started from{" "}
          <Link to="/runs/$id" params={{ id: execution.retryOf }} className="underline">
            an earlier run
          </Link>
          .
        </p>
      )}
      {execution.error && (
        <Alert variant="destructive" data-testid="run-error">
          <AlertDescription>{execution.error}</AlertDescription>
        </Alert>
      )}
      {execution.status === "waiting" && execution.resumeAt && (
        <p className="text-sm text-muted-foreground">Continues at {formatTime(execution.resumeAt)}.</p>
      )}
      {waitingApproval && (
        <Card data-testid="approval">
          <CardHeader>
            <CardTitle>Waiting for approval</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button data-testid="approve" disabled={pending} onClick={() => run(() => decideRun({ data: { id: execution.id, decision: "approved" } }), "Approved")}>
              <Check aria-hidden /> Approve
            </Button>
            <Button variant="outline" data-testid="reject" disabled={pending} onClick={() => run(() => decideRun({ data: { id: execution.id, decision: "rejected" } }), "Rejected")}>
              <X aria-hidden /> Reject
            </Button>
          </CardContent>
        </Card>
      )}
      <ol className="space-y-4" aria-label="Steps">
        {steps.map((s) => (
          <li key={s.id}>
            <Card data-testid="run-step" data-name={s.stepName} data-status={s.status}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {s.stepName}
                  <span className="text-sm font-normal text-muted-foreground">{STEP_LABELS[s.stepType as StepType] ?? s.stepType}</span>
                  <StatusBadge status={s.status} />
                  {s.reused && <Badge variant="outline">From the earlier run</Badge>}
                  <span className="ml-auto text-sm font-normal text-muted-foreground">{formatDuration(s.durationMs)}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {s.error && (
                  <Alert variant="destructive">
                    <AlertDescription data-testid="step-error">{s.error}</AlertDescription>
                  </Alert>
                )}
                <div className="grid gap-4 lg:grid-cols-2">
                  <ItemsView label="Input" value={s.input} />
                  <ItemsView label="Output" value={s.output ? outputOf(s.output) : null} testId="run-step-output" />
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
    </AppShell>
  );
}

/** One port's items as a list; several ports by name. */
function outputOf(output: Record<string, unknown[]>) {
  const ports = Object.keys(output);
  if (ports.length === 1) return output[ports[0]!];
  return output;
}
