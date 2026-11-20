import { createFileRoute } from "@tanstack/react-router";
import { KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/client/components/AppShell";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader } from "@/client/components/PageHeader";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { SelectField, TextField } from "@/client/editor/fields";
import { formatTime } from "@/client/lib/format";
import { useAction } from "@/client/lib/useAction";
import { deleteCredential, getCredentials, saveCredential } from "@/serverFunctions/app";

export const Route = createFileRoute("/credentials")({
  loader: () => getCredentials(),
  head: () => ({ meta: [{ title: "Credentials" }] }),
  component: CredentialsPage,
});

const KIND_LABELS: Record<string, string> = {
  header: "Header",
  bearer: "Bearer token",
  basic: "Username and password",
};

type Editing = { id?: string; name: string; kind: string } | null;

function CredentialsPage() {
  const credentials = Route.useLoaderData();
  const { run } = useAction();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  return (
    <AppShell>
      <PageHeader
        title="Credentials"
        description="Only you can use or see your credentials."
        actions={
          <Button data-testid="new-credential" onClick={() => setEditing({ name: "", kind: "bearer" })}>
            <Plus aria-hidden /> New credential
          </Button>
        }
      />
      {credentials.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No credentials yet"
          description="Save a token or password here, then pick it in an HTTP request step."
        />
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Changed</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {credentials.map((c) => (
                <TableRow key={c.id} data-testid="credential-row" data-name={c.name}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{KIND_LABELS[c.kind] ?? c.kind}</TableCell>
                  <TableCell className="text-muted-foreground">{formatTime(c.updatedAt)}</TableCell>
                  <TableCell className="space-x-1 text-right whitespace-nowrap">
                    <Button size="sm" variant="outline" onClick={() => setEditing({ id: c.id, name: c.name, kind: c.kind })}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting({ id: c.id, name: c.name })}>
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
      {editing && (
        <CredentialDialog
          editing={editing}
          onClose={() => setEditing(null)}
          onSave={(data) => run(() => saveCredential({ data }).then(() => setEditing(null)), "Credential saved")}
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
            void run(() => deleteCredential({ data: { id } }), "Credential deleted");
          }}
        >
          Steps that use it fail until they get another one.
        </ConfirmDialog>
      )}
    </AppShell>
  );
}

type SaveData = {
  id?: string;
  name: string;
  secret?:
    | { kind: "header"; headerName: string; headerValue: string }
    | { kind: "bearer"; token: string }
    | { kind: "basic"; username: string; password: string };
};

function CredentialDialog({
  editing,
  onClose,
  onSave,
}: {
  editing: NonNullable<Editing>;
  onClose: () => void;
  onSave: (data: SaveData) => Promise<unknown>;
}) {
  const [name, setName] = useState(editing.name);
  const [kind, setKind] = useState(editing.kind);
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = (key: string) => (value: string) => setFields({ ...fields, [key]: value });
  const replacing = Boolean(editing.id);
  const anySecret = Object.values(fields).some((v) => v);

  function secret(): SaveData["secret"] {
    if (replacing && !anySecret) return undefined;
    if (kind === "header") return { kind: "header", headerName: fields.headerName ?? "", headerValue: fields.headerValue ?? "" };
    if (kind === "basic") return { kind: "basic", username: fields.username ?? "", password: fields.password ?? "" };
    return { kind: "bearer", token: fields.token ?? "" };
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void onSave({ id: editing.id, name, secret: secret() });
          }}
        >
          <DialogHeader>
            <DialogTitle>{replacing ? "Edit credential" : "New credential"}</DialogTitle>
          </DialogHeader>
          <TextField name="credential-name" label="Name" value={name} onChange={setName} />
          <SelectField
            name="credential-kind"
            label="Kind"
            value={kind}
            options={Object.entries(KIND_LABELS)}
            onChange={setKind}
          />
          {replacing && <p className="text-muted-foreground">Leave the secret blank to keep the saved one.</p>}
          {kind === "header" && (
            <>
              <TextField name="header-name" label="Header name" value={fields.headerName ?? ""} onChange={set("headerName")} placeholder="X-Api-Key" />
              <TextField name="header-value" label="Header value" type="password" value={fields.headerValue ?? ""} onChange={set("headerValue")} />
            </>
          )}
          {kind === "bearer" && (
            <TextField name="token" label="Token" type="password" value={fields.token ?? ""} onChange={set("token")} />
          )}
          {kind === "basic" && (
            <>
              <TextField name="username" label="Username" value={fields.username ?? ""} onChange={set("username")} />
              <TextField name="password" label="Password" type="password" value={fields.password ?? ""} onChange={set("password")} />
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" data-testid="save-credential" disabled={!name.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
