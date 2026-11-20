import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Copy, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/client/components/AppShell";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { EmptyState } from "@/client/components/EmptyState";
import { NameDialog } from "@/client/components/NameDialog";
import { PageHeader } from "@/client/components/PageHeader";
import { StatusBadge } from "@/client/components/StatusBadge";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { TRIGGER_LABELS } from "@/client/lib/format";
import { useAction } from "@/client/lib/useAction";
import {
  createWorkflow,
  deleteWorkflow,
  duplicateWorkflow,
  getWorkflows,
} from "@/serverFunctions/app";

export const Route = createFileRoute("/")({
  loader: () => getWorkflows(),
  head: () => ({ meta: [{ title: "Workflows" }] }),
  component: WorkflowsPage,
});

function WorkflowsPage() {
  const { workflows } = Route.useLoaderData();
  const navigate = useNavigate();
  const { run } = useAction();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  const newButton = (
    <Button data-testid="new-workflow" onClick={() => setCreating(true)}>
      <Plus aria-hidden /> New workflow
    </Button>
  );

  return (
    <AppShell>
      <PageHeader title="Workflows" actions={newButton} />
      {workflows.length === 0 ? (
        <EmptyState
          media="rows"
          title="No workflows yet"
          description="Create one and it will appear here."
        />
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {workflows.map((wf) => (
                <TableRow key={wf.id} data-testid="workflow-row" data-name={wf.name}>
                  <TableCell className="font-medium">
                    <Link to="/workflows/$id" params={{ id: wf.id }} className="hover:underline">
                      {wf.name}
                    </Link>
                  </TableCell>
                  <TableCell>{TRIGGER_LABELS[wf.triggerKind] ?? wf.triggerKind}</TableCell>
                  <TableCell>
                    {wf.active ? <Badge>Active</Badge> : <span className="text-muted-foreground">Inactive</span>}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={wf.lastRunStatus} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {wf.ownerEmail}
                    {wf.shared ? " · shared" : ""}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button variant="ghost" size="icon" aria-label={`Actions for ${wf.name}`} />}
                      >
                        <MoreHorizontal aria-hidden />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            run(async () => {
                              const copy = await duplicateWorkflow({ data: { id: wf.id } });
                              await navigate({ to: "/workflows/$id", params: { id: copy.id } });
                            }, "Workflow duplicated")
                          }
                        >
                          <Copy aria-hidden /> Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeleting({ id: wf.id, name: wf.name })}
                        >
                          <Trash2 aria-hidden /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
      {creating && (
        <NameDialog
          title="New workflow"
          submitLabel="Create"
          onClose={() => setCreating(false)}
          onSubmit={(name) =>
            run(async () => {
              const { id } = await createWorkflow({ data: { name } });
              setCreating(false);
              await navigate({ to: "/workflows/$id", params: { id } });
            })
          }
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete"
          destructive
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            void run(() => deleteWorkflow({ data: { id } }), "Workflow deleted");
          }}
        >
          Its runs and versions are deleted too.
        </ConfirmDialog>
      )}
    </AppShell>
  );
}
