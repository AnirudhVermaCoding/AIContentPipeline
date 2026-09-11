"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type * as React from "react";
import { cn } from "@/lib/utils";

export function Progress({
  value,
  className,
  tone = "accent",
}: {
  value: number;
  className?: string;
  tone?: "accent" | "ok" | "running" | "warn";
}) {
  const v = Math.max(0, Math.min(100, value));
  const bg =
    tone === "ok"
      ? "bg-ok"
      : tone === "running"
        ? "bg-running"
        : tone === "warn"
          ? "bg-warn"
          : "bg-accent";
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-2", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", bg)}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

export function Separator({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-border", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4 w-full", className)} />;
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto scroll-thin">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}
export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "h-9 px-3 text-left align-middle text-xs font-medium text-fg-muted whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}
export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2 align-middle", className)} {...props} />;
}
export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("border-b border-border last:border-0 hover:bg-surface-2/60", className)}
      {...props}
    />
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <TooltipPrimitive.Root delayDuration={200}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-xs rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs text-white shadow-md"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-neutral-900" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-xs text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorBanner({
  message,
  className,
}: {
  message: string | null | undefined;
  className?: string;
}) {
  if (!message) return null;
  return (
    <div
      className={cn(
        "rounded-md border border-danger/20 bg-danger-bg px-3 py-2 text-sm text-danger",
        className,
      )}
    >
      {message}
    </div>
  );
}

export function StatusDot({
  tone,
  pulse,
  className,
}: {
  tone: "ok" | "warn" | "danger" | "info" | "running" | "muted";
  pulse?: boolean;
  className?: string;
}) {
  const bg = {
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
    info: "bg-info",
    running: "bg-running",
    muted: "bg-neutral-300",
  }[tone];
  return (
    <span className={cn("inline-block h-2 w-2 rounded-full", bg, pulse && "pulse", className)} />
  );
}

export function Stat({
  label,
  value,
  hint,
  className,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  tone?: "ok" | "warn" | "danger";
}) {
  const color =
    tone === "ok"
      ? "text-ok"
      : tone === "warn"
        ? "text-warn"
        : tone === "danger"
          ? "text-danger"
          : "";
  return (
    <div className={cn("card px-4 py-3", className)}>
      <p className="text-xs text-fg-muted">{label}</p>
      <div className={cn("mt-1 text-xl font-semibold tracking-tight num", color)}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-fg-subtle">{hint}</div> : null}
    </div>
  );
}

export function SectionTitle({
  title,
  description,
  right,
}: {
  title: string;
  description?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description ? <p className="text-xs text-fg-muted">{description}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  right,
}: {
  title: string;
  description?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <div className="mt-1 text-sm text-fg-muted">{description}</div> : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  );
}
