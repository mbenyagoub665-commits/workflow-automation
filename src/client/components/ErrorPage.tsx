import { Link, type ErrorComponentProps } from "@tanstack/react-router";
import { AppShell } from "@/client/components/AppShell";
import { EmptyState } from "@/client/components/EmptyState";
import { Button } from "@/client/components/ui/button";
import { errorMessage } from "@/client/lib/format";

export function ErrorPage({ error }: ErrorComponentProps) {
  return <Problem title="Couldn't open this page" description={errorMessage(error)} />;
}

export function NotFoundPage() {
  return <Problem title="Page not found" />;
}

function Problem({ title, description }: { title: string; description?: string }) {
  return (
    <AppShell>
      <EmptyState
        kind="error"
        title={title}
        description={description}
        action={<Button render={<Link to="/" />}>Back to workflows</Button>}
      />
    </AppShell>
  );
}
