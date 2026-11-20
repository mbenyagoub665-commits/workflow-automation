import { Link } from "@tanstack/react-router";

const LINKS = [
  { to: "/", label: "Workflows", exact: true },
  { to: "/runs", label: "Runs", exact: false },
  { to: "/tables", label: "Tables", exact: false },
  { to: "/credentials", label: "Credentials", exact: false },
] as const;

/** The app's sections, in the bar beside the way back to the Gateway. */
export function AppNav() {
  return (
    <nav className="flex min-w-0 items-center gap-3 overflow-x-auto text-sm" aria-label="Sections">
      {LINKS.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          activeOptions={{ exact: link.exact }}
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground data-[status=active]:font-medium data-[status=active]:text-foreground"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
