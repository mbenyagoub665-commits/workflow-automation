export function formatTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60000)} min`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message) as unknown;
      if (Array.isArray(parsed) && parsed[0]?.message) return String(parsed[0].message);
    } catch {
      /* not a validation error */
    }
    return error.message;
  }
  return "That didn't work.";
}

export const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  schedule: "Schedule",
  webhook: "Webhook",
  retry: "Retry",
};

export const COLUMN_TYPE_OPTIONS = [
  ["text", "Text"],
  ["number", "Number"],
  ["boolean", "True/false"],
  ["date", "Date"],
] as const;
