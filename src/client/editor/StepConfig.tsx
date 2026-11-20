import { CopyButton } from "@/client/components/CopyButton";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { CONDITION_OPERATORS, type Step, type TriggerConfig } from "@/shared/graph";
import { Field, RowsField, SelectField, TextField, type Row } from "./fields";

export type EditorContext = {
  credentials: { id: string; name: string }[];
  tables: { id: string; name: string }[];
  webhookUrl?: string;
  onRegenerate?: () => void;
  readOnly?: boolean;
};

const WEEKDAYS = [
  ["0", "Sunday"],
  ["1", "Monday"],
  ["2", "Tuesday"],
  ["3", "Wednesday"],
  ["4", "Thursday"],
  ["5", "Friday"],
  ["6", "Saturday"],
] as const;

export function StepConfig({
  step,
  onChange,
  context,
}: {
  step: Step;
  onChange: (config: Record<string, unknown>) => void;
  context: EditorContext;
}) {
  const c = step.config;
  const ro = context.readOnly;
  const set = (key: string, value: unknown) => onChange({ ...c, [key]: value });
  const str = (key: string) => (c[key] === undefined || c[key] === null ? "" : String(c[key]));
  const rows = (key: string) => (Array.isArray(c[key]) ? (c[key] as Row[]) : []);

  switch (step.type) {
    case "trigger": {
      const t = c as TriggerConfig;
      const schedule = t.schedule ?? { mode: "minutes", every: 15 };
      const webhook = t.webhook ?? { method: "POST", respond: "immediately" };
      return (
        <div className="space-y-4">
          <SelectField
            name="kind"
            label="Starts"
            value={t.kind}
            disabled={ro}
            options={[
              ["manual", "When someone clicks Run"],
              ["schedule", "On a schedule"],
              ["webhook", "When its webhook is called"],
            ]}
            onChange={(kind) =>
              onChange({
                kind,
                ...(kind === "schedule" ? { schedule } : {}),
                ...(kind === "webhook" ? { webhook } : {}),
              })
            }
          />
          {t.kind === "schedule" && (
            <>
              <SelectField
                name="schedule-mode"
                label="Repeat"
                value={schedule.mode}
                disabled={ro}
                options={[
                  ["minutes", "Every N minutes"],
                  ["hours", "Every N hours"],
                  ["daily", "Daily"],
                  ["weekly", "Weekly"],
                ]}
                onChange={(mode) =>
                  set("schedule", {
                    mode,
                    ...(mode === "minutes" || mode === "hours" ? { every: schedule.every ?? 1 } : { time: schedule.time ?? "09:00" }),
                    ...(mode === "weekly" ? { weekday: schedule.weekday ?? 1 } : {}),
                  })
                }
              />
              {(schedule.mode === "minutes" || schedule.mode === "hours") && (
                <TextField
                  name="schedule-every"
                  label={schedule.mode === "minutes" ? "Every (minutes)" : "Every (hours)"}
                  type="number"
                  readOnly={ro}
                  value={String(schedule.every ?? "")}
                  onChange={(v) => set("schedule", { ...schedule, every: v === "" ? undefined : Number(v) })}
                />
              )}
              {schedule.mode === "weekly" && (
                <SelectField
                  name="schedule-weekday"
                  label="Day"
                  value={String(schedule.weekday ?? 1)}
                  disabled={ro}
                  options={WEEKDAYS}
                  onChange={(v) => set("schedule", { ...schedule, weekday: Number(v) })}
                />
              )}
              {(schedule.mode === "daily" || schedule.mode === "weekly") && (
                <TextField
                  name="schedule-time"
                  label="Time (UTC)"
                  type="time"
                  readOnly={ro}
                  value={schedule.time ?? ""}
                  onChange={(v) => set("schedule", { ...schedule, time: v })}
                />
              )}
            </>
          )}
          {t.kind === "webhook" && (
            <>
              <SelectField
                name="webhook-method"
                label="Method"
                value={webhook.method}
                disabled={ro}
                options={[
                  ["POST", "POST"],
                  ["GET", "GET"],
                ]}
                onChange={(method) => set("webhook", { ...webhook, method })}
              />
              <SelectField
                name="webhook-respond"
                label="Respond with"
                value={webhook.respond}
                disabled={ro}
                options={[
                  ["immediately", "The run's id, right away"],
                  ["lastStep", "The last step's output, when the run ends"],
                ]}
                onChange={(respond) => set("webhook", { ...webhook, respond })}
              />
              {context.webhookUrl && (
                <Field label="Webhook URL" htmlFor="webhook-url" hint="Answers only while the workflow is active.">
                  <div className="flex gap-2">
                    <Input id="webhook-url" data-testid="webhook-url" readOnly value={context.webhookUrl} className="font-mono text-xs" />
                    <CopyButton value={context.webhookUrl} successMessage="Copied the URL" />
                  </div>
                  {context.onRegenerate && !ro && (
                    <Button type="button" variant="outline" size="sm" data-testid="regenerate-webhook" onClick={context.onRegenerate}>
                      New URL
                    </Button>
                  )}
                </Field>
              )}
            </>
          )}
        </div>
      );
    }
    case "http":
      return (
        <div className="space-y-4">
          <SelectField
            name="method"
            label="Method"
            value={str("method") || "GET"}
            disabled={ro}
            options={["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => [m, m] as const)}
            onChange={(v) => set("method", v)}
          />
          <TextField name="url" label="URL" readOnly={ro} value={str("url")} placeholder="https://api.example.com/items/{{ $json.id }}" onChange={(v) => set("url", v)} />
          <RowsField name="query" label="Query" readOnly={ro} rows={rows("query")} columns={[{ key: "name", label: "Name" }, { key: "value", label: "Value" }]} onChange={(v) => set("query", v)} />
          <RowsField name="headers" label="Headers" readOnly={ro} rows={rows("headers")} columns={[{ key: "name", label: "Name" }, { key: "value", label: "Value" }]} onChange={(v) => set("headers", v)} />
          <TextField name="body" label="JSON body" multiline readOnly={ro} value={str("body")} placeholder='{ "name": "{{ $json.name }}" }' onChange={(v) => set("body", v)} />
          <SelectField
            name="credential"
            label="Credential"
            value={str("credentialId")}
            disabled={ro}
            options={[
              ["", "None"],
              ...context.credentials.map((cr) => [cr.id, cr.name] as const),
              ...(str("credentialId") && !context.credentials.some((cr) => cr.id === str("credentialId"))
                ? [[str("credentialId"), ro ? "A saved credential" : "Deleted credential"] as const]
                : []),
            ]}
            onChange={(v) => set("credentialId", v)}
          />
          <TextField name="timeout" label="Timeout (seconds)" type="number" readOnly={ro} value={str("timeoutSeconds")} onChange={(v) => set("timeoutSeconds", Number(v))} />
        </div>
      );
    case "condition":
      return (
        <div className="space-y-4">
          <TextField name="left" label="Value" readOnly={ro} value={str("left")} placeholder="{{ $json.status }}" onChange={(v) => set("left", v)} />
          <SelectField name="operator" label="Test" value={str("operator") || "equals"} disabled={ro} options={CONDITION_OPERATORS} onChange={(v) => set("operator", v)} />
          {str("operator") !== "isEmpty" && str("operator") !== "isTrue" && (
            <TextField name="right" label="Compared with" readOnly={ro} value={str("right")} onChange={(v) => set("right", v)} />
          )}
        </div>
      );
    case "set":
      return (
        <RowsField
          name="operations"
          label="Changes to each item"
          readOnly={ro}
          addLabel="Add change"
          rows={rows("operations")}
          columns={[
            { key: "op", label: "Change", options: [["set", "Set"], ["rename", "Rename"], ["remove", "Remove"]] },
            { key: "field", label: "Field" },
            { key: "value", label: "Value or new name" },
          ]}
          onChange={(v) => set("operations", v)}
        />
      );
    case "wait":
      return (
        <div className="grid grid-cols-2 gap-3">
          <TextField name="amount" label="Wait for" type="number" readOnly={ro} value={str("amount")} onChange={(v) => set("amount", Number(v))} />
          <SelectField
            name="unit"
            label="Unit"
            value={str("unit") || "minutes"}
            disabled={ro}
            options={[["seconds", "Seconds"], ["minutes", "Minutes"], ["hours", "Hours"], ["days", "Days"]]}
            onChange={(v) => set("unit", v)}
          />
        </div>
      );
    case "approval":
      return <TextField name="message" label="What to approve" multiline readOnly={ro} value={str("message")} onChange={(v) => set("message", v)} />;
    case "email":
      return (
        <div className="space-y-4">
          <TextField name="to" label="To" readOnly={ro} value={str("to")} onChange={(v) => set("to", v)} />
          <TextField name="subject" label="Subject" readOnly={ro} value={str("subject")} onChange={(v) => set("subject", v)} />
          <TextField name="email-body" label="Message" multiline readOnly={ro} value={str("body")} onChange={(v) => set("body", v)} />
        </div>
      );
    case "ai":
      return (
        <div className="space-y-4">
          <TextField name="prompt" label="Prompt" multiline readOnly={ro} value={str("prompt")} onChange={(v) => set("prompt", v)} />
          <TextField
            name="schema"
            label="Output schema (JSON Schema, optional)"
            multiline
            readOnly={ro}
            value={str("schema")}
            onChange={(v) => set("schema", v)}
            hint="Without one, the answer is in the item's text field."
          />
        </div>
      );
    case "table": {
      const op = str("operation") || "insert";
      return (
        <div className="space-y-4">
          <SelectField
            name="table"
            label="Table"
            value={str("tableId")}
            disabled={ro}
            options={[["", "Choose a table"], ...context.tables.map((t) => [t.id, t.name] as const), ...(ro && str("tableId") ? [[str("tableId"), "A data table"] as const] : [])]}
            onChange={(v) => set("tableId", v)}
          />
          <SelectField
            name="operation"
            label="Action"
            value={op}
            disabled={ro}
            options={[["insert", "Insert a row"], ["update", "Update rows"], ["find", "Find rows"], ["delete", "Delete rows"]]}
            onChange={(v) => set("operation", v)}
          />
          {op !== "insert" && (
            <div className="grid grid-cols-2 gap-3">
              <TextField name="filter-column" label="Where column" readOnly={ro} value={str("filterColumn")} onChange={(v) => set("filterColumn", v)} />
              <TextField name="filter-value" label="Equals" readOnly={ro} value={str("filterValue")} onChange={(v) => set("filterValue", v)} />
            </div>
          )}
          {(op === "insert" || op === "update") && (
            <RowsField
              name="values"
              label="Values"
              readOnly={ro}
              rows={rows("values")}
              columns={[{ key: "column", label: "Column" }, { key: "value", label: "Value" }]}
              onChange={(v) => set("values", v)}
            />
          )}
        </div>
      );
    }
  }
}
