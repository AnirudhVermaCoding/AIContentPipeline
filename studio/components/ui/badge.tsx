import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-surface-2 text-fg",
        outline: "border-border text-fg-muted",
        ok: "border-transparent bg-ok-bg text-ok",
        warn: "border-transparent bg-warn-bg text-warn",
        danger: "border-transparent bg-danger-bg text-danger",
        info: "border-transparent bg-info-bg text-info",
        running: "border-transparent bg-running-bg text-running",
        muted: "border-transparent bg-surface-2 text-fg-subtle",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
