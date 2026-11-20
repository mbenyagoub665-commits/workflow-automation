import { Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/client/components/ui/native-select";
import { Textarea } from "@/client/components/ui/textarea";

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function TextField({
  name,
  label,
  value,
  onChange,
  placeholder,
  multiline,
  readOnly,
  type,
  hint,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  readOnly?: boolean;
  type?: string;
  hint?: ReactNode;
}) {
  const id = `field-${name}`;
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      {multiline ? (
        <Textarea
          id={id}
          data-testid={id}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          className="font-mono text-xs"
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          id={id}
          data-testid={id}
          type={type}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

export function SelectField({
  name,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  name: string;
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = `field-${name}`;
  return (
    <Field label={label} htmlFor={id}>
      <NativeSelect
        id={id}
        data-testid={id}
        value={value}
        disabled={disabled}
        className="w-full"
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, l]) => (
          <NativeSelectOption key={v} value={v}>
            {l}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}

export type Row = Record<string, string>;

/** Rows of small inputs, such as headers or field changes. */
export function RowsField({
  name,
  label,
  rows,
  columns,
  onChange,
  readOnly,
  addLabel = "Add",
}: {
  name: string;
  label: string;
  rows: Row[];
  columns: { key: string; label: string; options?: readonly (readonly [string, string])[] }[];
  onChange: (rows: Row[]) => void;
  readOnly?: boolean;
  addLabel?: string;
}) {
  return (
    <div className="space-y-1.5" data-testid={`rows-${name}`}>
      <Label>{label}</Label>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          {columns.map((col) =>
            col.options ? (
              <NativeSelect
                key={col.key}
                aria-label={col.label}
                data-testid={`${name}-${i}-${col.key}`}
                value={row[col.key] ?? ""}
                disabled={readOnly}
                onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, [col.key]: e.target.value } : r)))}
              >
                {col.options.map(([v, l]) => (
                  <NativeSelectOption key={v} value={v}>
                    {l}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : (
              <Input
                key={col.key}
                aria-label={col.label}
                placeholder={col.label}
                data-testid={`${name}-${i}-${col.key}`}
                value={row[col.key] ?? ""}
                readOnly={readOnly}
                onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, [col.key]: e.target.value } : r)))}
              />
            ),
          )}
          {!readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
            >
              <X aria-hidden />
            </Button>
          )}
        </div>
      ))}
      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid={`add-${name}`}
          onClick={() =>
            onChange([...rows, Object.fromEntries(columns.map((c) => [c.key, c.options?.[0]?.[0] ?? ""]))])
          }
        >
          <Plus aria-hidden /> {addLabel}
        </Button>
      )}
    </div>
  );
}
