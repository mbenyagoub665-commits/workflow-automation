import { Badge } from "@/client/components/ui/badge";

const VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  succeeded: "secondary",
  failed: "destructive",
  running: "default",
  waiting: "outline",
  cancelled: "outline",
};

const LABELS: Record<string, string> = {
  succeeded: "Succeeded",
  failed: "Failed",
  running: "Running",
  waiting: "Waiting",
  cancelled: "Cancelled",
  skipped: "Skipped",
};

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant={VARIANTS[status] ?? "outline"} data-testid="status" data-status={status}>
      {LABELS[status] ?? status}
    </Badge>
  );
}
