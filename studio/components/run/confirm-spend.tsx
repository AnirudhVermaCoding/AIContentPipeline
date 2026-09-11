"use client";

import type { BudgetCheckView, RegenerationEstimate } from "@pipeline/studio/api-types";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { ErrorBanner, Skeleton } from "@/components/ui/misc";

/**
 * The one dialog behind every button that spends money: shows the estimated incremental cost
 * (always labelled ESTIMATED), which budget rule would block it, and asks for confirmation.
 */
export function ConfirmSpendDialog({
  open,
  onOpenChange,
  title,
  description,
  loadEstimate,
  onConfirm,
  confirmLabel = "Confirm",
  instruction,
  busy,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  loadEstimate: () => Promise<
    | RegenerationEstimate
    | {
        estimate_usd: number;
        breakdown: RegenerationEstimate["breakdown"];
        budget: BudgetCheckView | null;
      }
  >;
  onConfirm: (instruction: string) => Promise<unknown>;
  confirmLabel?: string;
  instruction?: { label: string; placeholder: string; initial?: string } | null;
  busy?: boolean;
  children?: React.ReactNode;
}) {
  const [est, setEst] = useState<Awaited<ReturnType<typeof loadEstimate>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState(instruction?.initial ?? "");
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-estimate once each time the dialog opens
  useEffect(() => {
    if (!open) return;
    setEst(null);
    setError(null);
    setText(instruction?.initial ?? "");
    loadEstimate()
      .then(setEst)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [open]);
  const blocked = est?.budget && !est.budget.ok;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        {instruction ? (
          <div>
            <p className="mb-1 text-xs font-medium text-fg-muted">{instruction.label}</p>
            <Textarea
              rows={3}
              placeholder={instruction.placeholder}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        ) : null}
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-fg-muted">Estimated additional cost</span>
            {est ? (
              <Money usd={est.estimate_usd} approx source="ESTIMATED" size="lg" />
            ) : (
              <Skeleton className="h-6 w-24" />
            )}
          </div>
          {est?.breakdown.length ? (
            <ul className="mt-2 space-y-1 text-xs text-fg-muted">
              {est.breakdown.map((b) => (
                <li key={b.item} className="flex justify-between gap-3">
                  <span>
                    {b.item}
                    {b.note ? <span className="text-fg-subtle"> — {b.note}</span> : null}
                  </span>
                  <Money usd={b.usd} secondary={false} size="sm" />
                </li>
              ))}
            </ul>
          ) : null}
          {est?.budget ? (
            blocked ? (
              <div className="mt-2 flex items-start gap-2 rounded-md bg-danger-bg px-2 py-1.5 text-xs text-danger">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  This would exceed the {est.budget.blocking_rule?.replace("_", " ")} budget:{" "}
                  {est.budget.reason}
                </span>
              </div>
            ) : (
              <p className="mt-2 text-xs text-ok">
                Within today's and the wallet's remaining budget ✓
              </p>
            )
          ) : null}
        </div>
        <ErrorBanner message={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void onConfirm(text)} disabled={!est || !!blocked || busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
