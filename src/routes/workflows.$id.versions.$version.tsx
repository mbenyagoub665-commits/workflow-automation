import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/client/components/AppShell";
import { BackLink } from "@/client/components/BackLink";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { PageHeader } from "@/client/components/PageHeader";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/client/components/ui/card";
import { StepConfig } from "@/client/editor/StepConfig";
import { formatTime } from "@/client/lib/format";
import { useAction } from "@/client/lib/useAction";
import { STEP_LABELS } from "@/shared/graph";
import { getVersion, restoreVersion } from "@/serverFunctions/app";

export const Route = createFileRoute("/workflows/$id/versions/$version")({
  loader: ({ params }) => getVersion({ data: { id: params.id, version: Number(params.version) } }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? `Version ${loaderData.version.version}` : "Version" }] }),
  component: VersionPage,
});

const CHANGE_LABELS = { added: "Added", removed: "Removed", changed: "Changed" } as const;

function VersionPage() {
  const { workflow, version, graph, changes } = Route.useLoaderData();
  const navigate = useNavigate();
  const { run, pending } = useAction();
  const [confirming, setConfirming] = useState(false);
  const isCurrent = version.version === workflow.version;
  const changeOf = new Map(changes.map((c) => [c.id, c.change]));

  return (
    <AppShell wide>
      <PageHeader
        backLink={<BackLink to="/workflows/$id/history" params={{ id: workflow.id }}>Version history</BackLink>}
        title={`${workflow.name} · version ${version.version}`}
        description={`Saved by ${version.authorEmail}, ${formatTime(version.createdAt)}`}
        actions={
          !isCurrent && (
            <Button data-testid="restore" disabled={pending} onClick={() => setConfirming(true)}>
              <RotateCcw aria-hidden /> Restore
            </Button>
          )
        }
      />
      <section className="space-y-2" data-testid="changes">
        <h2 className="font-medium">Changes from the version before</h2>
        {changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No step changed.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {changes.map((c) => (
              <li key={c.id} data-testid="change" data-change={c.change}>
                <Badge variant={c.change === "removed" ? "destructive" : c.change === "added" ? "default" : "secondary"}>
                  {CHANGE_LABELS[c.change]}
                </Badge>{" "}
                {c.name}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-4">
        {graph.steps.map((step) => (
          <Card key={step.id} data-testid="version-step">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {step.name}
                <span className="text-sm font-normal text-muted-foreground">{STEP_LABELS[step.type]}</span>
                {changeOf.get(step.id) && <Badge variant="outline">{CHANGE_LABELS[changeOf.get(step.id)!]}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <StepConfig step={step} onChange={() => {}} context={{ credentials: [], tables: [], readOnly: true }} />
            </CardContent>
          </Card>
        ))}
      </section>
      {confirming && (
        <ConfirmDialog
          title={`Restore version ${version.version}?`}
          confirmLabel="Restore"
          onClose={() => setConfirming(false)}
          onConfirm={() =>
            run(async () => {
              await restoreVersion({ data: { id: workflow.id, version: version.version } });
              setConfirming(false);
              await navigate({ to: "/workflows/$id/history", params: { id: workflow.id } });
            }, "Restored as a new version")
          }
        >
          It is saved as a new version.
        </ConfirmDialog>
      )}
    </AppShell>
  );
}
