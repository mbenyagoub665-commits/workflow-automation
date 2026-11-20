import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { AppShell } from "@/client/components/AppShell";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader } from "@/client/components/PageHeader";
import { StatusBadge } from "@/client/components/StatusBadge";
import { Button } from "@/client/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/client/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { formatDuration, formatTime, TRIGGER_LABELS } from "@/client/lib/format";
import { getRuns } from "@/serverFunctions/app";

const STATUSES = ["running", "waiting", "succeeded", "failed", "cancelled"] as const;
const search = z.object({
  workflowId: z.string().optional(),
  status: z.enum(STATUSES).optional(),
  page: z.number().int().min(1).optional(),
});

export const Route = createFileRoute("/runs/")({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getRuns({ data: { ...deps, page: deps.page ?? 1 } }),
  head: () => ({ meta: [{ title: "Runs" }] }),
  component: RunsPage,
});

function RunsPage() {
  const { runs, total, page, pageSize } = Route.useLoaderData();
  const filters = Route.useSearch();
  const navigate = useNavigate({ from: "/runs/" });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const scoped = filters.workflowId ? runs[0]?.workflowName : null;

  return (
    <AppShell wide>
      <PageHeader
        title={scoped ? `Runs of ${scoped}` : "Runs"}
        actions={
          <NativeSelect
            aria-label="Status"
            data-testid="status-filter"
            value={filters.status ?? ""}
            onChange={(e) =>
              navigate({ search: (s) => ({ ...s, status: (e.target.value || undefined) as never, page: undefined }) })
            }
          >
            <NativeSelectOption value="">All statuses</NativeSelectOption>
            {STATUSES.map((s) => (
              <NativeSelectOption key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        }
      />
      {runs.length === 0 ? (
        <EmptyState
          kind={filters.status ? "filtered" : "no-data"}
          title={filters.status ? "No runs with this status" : "No runs yet"}
          description={filters.status ? undefined : "Runs appear here when a workflow starts."}
        />
      ) : (
        <>
          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Started by</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id} data-testid="run-row" data-status={r.status}>
                    <TableCell>
                      <Link to="/runs/$id" params={{ id: r.id }} aria-label={`Open run of ${r.workflowName}`}>
                        <StatusBadge status={r.status} />
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link to="/runs/$id" params={{ id: r.id }} className="hover:underline">
                        {r.workflowName}
                      </Link>
                      <span className="text-muted-foreground"> · v{r.version}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.startedByEmail ?? TRIGGER_LABELS[r.triggerKind] ?? r.triggerKind}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatTime(r.startedAt)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.finishedAt ? formatDuration(r.finishedAt - r.startedAt) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-3 text-sm text-muted-foreground">
              <span data-testid="page-label">
                Page {page} of {pages}
              </span>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => navigate({ search: (s) => ({ ...s, page: page - 1 }) })}>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                data-testid="next-page"
                disabled={page >= pages}
                onClick={() => navigate({ search: (s) => ({ ...s, page: page + 1 }) })}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
