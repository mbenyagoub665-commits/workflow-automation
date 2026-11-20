import { createLink } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { forwardRef, type AnchorHTMLAttributes } from "react";

const Anchor = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(function Anchor(
  { children, ...props },
  ref,
) {
  return (
    <a
      ref={ref}
      {...props}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft className="size-4" aria-hidden />
      {children}
    </a>
  );
});

/** The way back to the page above, above a PageHeader's title. */
export const BackLink = createLink(Anchor);
