/** A step's items as JSON, for the editor and the run page. */
export function ItemsView({ label, value, testId }: { label: string; value: unknown; testId?: string }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <pre
        data-testid={testId}
        className="max-h-72 overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap break-all"
      >
        {value === null || value === undefined ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
