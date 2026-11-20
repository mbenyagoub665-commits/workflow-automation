import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/client/components/AppShell";
import { BackLink } from "@/client/components/BackLink";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { EmptyState } from "@/client/components/EmptyState";
import { NameDialog } from "@/client/components/NameDialog";
import { PageHeader } from "@/client/components/PageHeader";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Input } from "@/client/components/ui/input";
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
import { COLUMN_TYPE_OPTIONS } from "@/client/lib/format";
import { useAction } from "@/client/lib/useAction";
import {
  addColumn,
  deleteColumn,
  deleteRow,
  deleteTable,
  getTable,
  renameColumn,
  renameTable,
  saveRow,
  shareTable,
  transferTable,
} from "@/serverFunctions/app";

export const Route = createFileRoute("/tables/$id")({
  loader: ({ params }) => getTable({ data: { id: params.id } }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData?.table.name ?? "Table" }] }),
  component: TablePage,
});

type Column = { id: string; name: string; type: string };
type Dialog =
  | { kind: "rename-table" }
  | { kind: "delete-table" }
  | { kind: "transfer" }
  | { kind: "add-column" }
  | { kind: "rename-column"; column: Column }
  | { kind: "delete-column"; column: Column }
  | null;

function show(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function TablePage() {
  const { table, columns, rows, members } = Route.useLoaderData();
  const navigate = useNavigate();
  const { run, pending } = useAction();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [newColumnType, setNewColumnType] = useState("text");
  const [transferTo, setTransferTo] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; values: Record<string, string> } | null>(null);
  const [filter, setFilter] = useState({ column: "", text: "" });
  const [sort, setSort] = useState<{ column: string; dir: 1 | -1 } | null>(null);

  const shown = useMemo(() => {
    let list = rows;
    if (filter.column && filter.text)
      list = list.filter((r) => show(r.values[filter.column]).toLowerCase().includes(filter.text.toLowerCase()));
    if (sort) {
      const type = columns.find((c) => c.id === sort.column)?.type;
      list = [...list].sort((a, b) => {
        const x = a.values[sort.column];
        const y = b.values[sort.column];
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        const cmp = type === "number" ? Number(x) - Number(y) : String(x).localeCompare(String(y));
        return cmp * sort.dir;
      });
    }
    return list;
  }, [rows, filter, sort, columns]);

  const input = (column: Column, value: string, onChange: (v: string) => void, testId: string) =>
    column.type === "boolean" ? (
      <NativeSelect aria-label={column.name} data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)}>
        <NativeSelectOption value="">—</NativeSelectOption>
        <NativeSelectOption value="true">true</NativeSelectOption>
        <NativeSelectOption value="false">false</NativeSelectOption>
      </NativeSelect>
    ) : (
      <Input
        aria-label={column.name}
        data-testid={testId}
        type={column.type === "date" ? "date" : "text"}
        inputMode={column.type === "number" ? "decimal" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );

  return (
    <AppShell wide>
      <PageHeader
        backLink={<BackLink to="/tables">Data tables</BackLink>}
        title={<span data-testid="table-title">{table.name}</span>}
        description={
          <span className="flex items-center gap-2">
            {table.ownerEmail}
            {table.shared && <Badge variant="secondary">Shared with the team</Badge>}
          </span>
        }
        actions={
          <>
            <Button variant="outline" data-testid="add-column" onClick={() => setDialog({ kind: "add-column" })}>
              <Plus aria-hidden /> Column
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="More" data-testid="table-menu" />}>
                <MoreHorizontal aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setDialog({ kind: "rename-table" })}>
                  <Pencil aria-hidden /> Rename
                </DropdownMenuItem>
                {table.canManage && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      data-testid="toggle-share"
                      onClick={() =>
                        run(
                          () => shareTable({ data: { id: table.id, shared: !table.shared } }),
                          table.shared ? "Now private" : "Shared with the team",
                        )
                      }
                    >
                      {table.shared ? "Make private" : "Share with the team"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDialog({ kind: "transfer" })}>Transfer ownership</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => setDialog({ kind: "delete-table" })}>
                      <Trash2 aria-hidden /> Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {columns.length === 0 ? (
        <EmptyState title="No columns yet" description="Add a column to start adding rows." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label="Filter column"
              data-testid="filter-column"
              value={filter.column}
              onChange={(e) => setFilter({ ...filter, column: e.target.value })}
            >
              <NativeSelectOption value="">Filter by…</NativeSelectOption>
              {columns.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {filter.column && (
              <Input
                aria-label="Contains"
                placeholder="Contains"
                data-testid="filter-text"
                className="w-48"
                value={filter.text}
                onChange={(e) => setFilter({ ...filter, text: e.target.value })}
              />
            )}
          </div>
          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => (
                    <TableHead key={c.id}>
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          data-testid={`sort-${c.name}`}
                          className="inline-flex items-center gap-1"
                          onClick={() => setSort(sort?.column === c.id ? { column: c.id, dir: sort.dir === 1 ? -1 : 1 } : { column: c.id, dir: 1 })}
                        >
                          {c.name}
                          {sort?.column === c.id && (sort.dir === 1 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Column ${c.name}`} />}>
                            <MoreHorizontal aria-hidden />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => setDialog({ kind: "rename-column", column: c })}>Rename</DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onClick={() => setDialog({ kind: "delete-column", column: c })}>
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </span>
                    </TableHead>
                  ))}
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) =>
                  editing?.id === r.id ? (
                    <TableRow key={r.id} data-testid="data-row-editing">
                      {columns.map((c) => (
                        <TableCell key={c.id}>
                          {input(c, editing.values[c.id] ?? "", (v) => setEditing({ ...editing, values: { ...editing.values, [c.id]: v } }), `edit-${c.name}`)}
                        </TableCell>
                      ))}
                      <TableCell className="space-x-1 whitespace-nowrap">
                        <Button
                          size="sm"
                          data-testid="save-row"
                          disabled={pending}
                          onClick={() =>
                            run(async () => {
                              await saveRow({ data: { tableId: table.id, rowId: r.id, values: editing.values } });
                              setEditing(null);
                            })
                          }
                        >
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={r.id} data-testid="data-row">
                      {columns.map((c) => (
                        <TableCell key={c.id}>{show(r.values[c.id])}</TableCell>
                      ))}
                      <TableCell className="space-x-1 whitespace-nowrap text-right">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Edit row"
                          onClick={() =>
                            setEditing({ id: r.id, values: Object.fromEntries(columns.map((c) => [c.id, show(r.values[c.id])])) })
                          }
                        >
                          <Pencil aria-hidden />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Delete row"
                          onClick={() => run(() => deleteRow({ data: { tableId: table.id, rowId: r.id } }))}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ),
                )}
                <TableRow data-testid="new-row">
                  {columns.map((c) => (
                    <TableCell key={c.id}>
                      {input(c, draft[c.id] ?? "", (v) => setDraft({ ...draft, [c.id]: v }), `new-${c.name}`)}
                    </TableCell>
                  ))}
                  <TableCell>
                    <Button
                      size="sm"
                      data-testid="add-row"
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          await saveRow({ data: { tableId: table.id, values: draft } });
                          setDraft({});
                        })
                      }
                    >
                      Add row
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableCard>
        </>
      )}

      {dialog?.kind === "rename-table" && (
        <NameDialog
          title="Rename table"
          initial={table.name}
          submitLabel="Rename"
          onClose={() => setDialog(null)}
          onSubmit={(name) => run(() => renameTable({ data: { id: table.id, name } }).then(() => setDialog(null)))}
        />
      )}
      {dialog?.kind === "add-column" && (
        <NameDialog
          title="Add column"
          submitLabel="Add"
          onClose={() => setDialog(null)}
          onSubmit={(name) =>
            run(() => addColumn({ data: { tableId: table.id, name, type: newColumnType as "text" } }).then(() => setDialog(null)))
          }
        >
          <NativeSelect aria-label="Type" data-testid="column-type" className="w-full" value={newColumnType} onChange={(e) => setNewColumnType(e.target.value)}>
            {COLUMN_TYPE_OPTIONS.map(([v, l]) => (
              <NativeSelectOption key={v} value={v}>
                {l}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </NameDialog>
      )}
      {dialog?.kind === "rename-column" && (
        <NameDialog
          title="Rename column"
          initial={dialog.column.name}
          submitLabel="Rename"
          onClose={() => setDialog(null)}
          onSubmit={(name) =>
            run(() => renameColumn({ data: { tableId: table.id, columnId: dialog.column.id, name } }).then(() => setDialog(null)))
          }
        />
      )}
      {dialog?.kind === "delete-column" && (
        <ConfirmDialog
          title={`Delete column ${dialog.column.name}?`}
          confirmLabel="Delete"
          destructive
          onClose={() => setDialog(null)}
          onConfirm={() => {
            const columnId = dialog.column.id;
            setDialog(null);
            void run(() => deleteColumn({ data: { tableId: table.id, columnId } }));
          }}
        >
          Its values in every row are lost.
        </ConfirmDialog>
      )}
      {dialog?.kind === "delete-table" && (
        <ConfirmDialog
          title={`Delete ${table.name}?`}
          confirmLabel="Delete"
          destructive
          onClose={() => setDialog(null)}
          onConfirm={() =>
            run(async () => {
              await deleteTable({ data: { id: table.id } });
              await navigate({ to: "/tables" });
            }, "Table deleted")
          }
        >
          Every row is deleted with it.
        </ConfirmDialog>
      )}
      {dialog?.kind === "transfer" && (
        <ConfirmDialog
          title="Transfer ownership"
          confirmLabel="Transfer"
          onClose={() => setDialog(null)}
          onConfirm={() => {
            if (!transferTo) return;
            void run(async () => {
              await transferTable({ data: { id: table.id, ownerId: transferTo } });
              setDialog(null);
            }, "Ownership transferred");
          }}
        >
          <NativeSelect aria-label="New owner" className="mt-2 w-full" value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
            <NativeSelectOption value="">Choose a member</NativeSelectOption>
            {members
              .filter((m) => m.id !== table.ownerId)
              .map((m) => (
                <NativeSelectOption key={m.id} value={m.id}>
                  {m.email}
                </NativeSelectOption>
              ))}
          </NativeSelect>
        </ConfirmDialog>
      )}
    </AppShell>
  );
}
