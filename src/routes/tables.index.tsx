import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/client/components/AppShell";
import { EmptyState } from "@/client/components/EmptyState";
import { NameDialog } from "@/client/components/NameDialog";
import { PageHeader } from "@/client/components/PageHeader";
import { Button } from "@/client/components/ui/button";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { RowsField, type Row } from "@/client/editor/fields";
import { COLUMN_TYPE_OPTIONS, formatTime } from "@/client/lib/format";
import { useAction } from "@/client/lib/useAction";
import { createTable, getTables } from "@/serverFunctions/app";

export const Route = createFileRoute("/tables/")({
  loader: () => getTables(),
  head: () => ({ meta: [{ title: "Data tables" }] }),
  component: TablesPage,
});

function TablesPage() {
  const tables = Route.useLoaderData();
  const navigate = useNavigate();
  const { run } = useAction();
  const [creating, setCreating] = useState(false);
  const [columns, setColumns] = useState<Row[]>([{ name: "", type: "text" }]);

  return (
    <AppShell>
      <PageHeader
        title="Data tables"
        actions={
          <Button data-testid="new-table" onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New table
          </Button>
        }
      />
      {tables.length === 0 ? (
        <EmptyState media="rows" title="No tables yet" description="Create one to keep rows your workflows read and write." />
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tables.map((t) => (
                <TableRow key={t.id} data-testid="table-row" data-name={t.name}>
                  <TableCell className="font-medium">
                    <Link to="/tables/$id" params={{ id: t.id }} className="hover:underline">
                      {t.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {t.ownerEmail}
                    {t.shared ? " · shared" : ""}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatTime(t.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
      {creating && (
        <NameDialog
          title="New table"
          submitLabel="Create"
          onClose={() => setCreating(false)}
          onSubmit={(name) =>
            run(async () => {
              const { id } = await createTable({
                data: {
                  name,
                  columns: columns
                    .filter((c) => c.name?.trim())
                    .map((c) => ({ name: c.name!.trim(), type: c.type as "text" })),
                },
              });
              setCreating(false);
              setColumns([{ name: "", type: "text" }]);
              await navigate({ to: "/tables/$id", params: { id } });
            })
          }
        >
          <RowsField
            name="columns"
            label="Columns"
            addLabel="Add column"
            rows={columns}
            columns={[
              { key: "name", label: "Column name" },
              { key: "type", label: "Type", options: COLUMN_TYPE_OPTIONS },
            ]}
            onChange={setColumns}
          />
        </NameDialog>
      )}
    </AppShell>
  );
}
