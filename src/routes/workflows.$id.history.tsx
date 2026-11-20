import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/client/components/AppShell";
import { BackLink } from "@/client/components/BackLink";
import { PageHeader } from "@/client/components/PageHeader";
import { Badge } from "@/client/components/ui/badge";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { formatTime } from "@/client/lib/format";
import { getVersions } from "@/serverFunctions/app";

export const Route = createFileRoute("/workflows/$id/history")({
  loader: ({ params }) => getVersions({ data: { id: params.id } }),
  head: () => ({ meta: [{ title: "Version history" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const { workflow, versions } = Route.useLoaderData();
  return (
    <AppShell>
      <PageHeader
        backLink={<BackLink to="/workflows/$id" params={{ id: workflow.id }}>{workflow.name}</BackLink>}
        title="Version history"
      />
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Saved by</TableHead>
              <TableHead>Saved</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((v) => (
              <TableRow key={v.version} data-testid="version-row">
                <TableCell className="font-medium">
                  <Link
                    to="/workflows/$id/versions/$version"
                    params={{ id: workflow.id, version: String(v.version) }}
                    className="hover:underline"
                  >
                    Version {v.version}
                  </Link>{" "}
                  {v.version === workflow.version && <Badge variant="secondary">Current</Badge>}
                  {v.restoredFrom !== null && (
                    <span className="text-muted-foreground"> · restored from version {v.restoredFrom}</span>
                  )}
                </TableCell>
                <TableCell>{v.authorEmail}</TableCell>
                <TableCell className="text-muted-foreground">{formatTime(v.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </AppShell>
  );
}
