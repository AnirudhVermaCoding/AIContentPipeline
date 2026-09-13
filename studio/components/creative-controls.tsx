"use client";

import type { CreativeSettingsView } from "@pipeline/studio/api-types";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export interface CreativeValues {
  creative_freedom: number;
  goal_focus: number;
}

type Range = CreativeSettingsView["creative_ranges"][number];

/** Semantic label for a value, from the range table the API serves. */
export function labelFor(ranges: ReadonlyArray<Range> | undefined, value: number): string {
  if (!ranges?.length) return "";
  const hit = ranges.find((r) => value <= r.max + 1e-9) ?? ranges[ranges.length - 1];
  return hit?.label ?? "";
}

export function summaryFor(ranges: ReadonlyArray<Range> | undefined, value: number): string {
  if (!ranges?.length) return "";
  const hit = ranges.find((r) => value <= r.max + 1e-9) ?? ranges[ranges.length - 1];
  return hit?.summary ?? "";
}

export const fmtControl = (v: number): string => v.toFixed(2);

function ControlRow({
  id,
  title,
  helper,
  value,
  onChange,
  ranges,
  leftLabel,
  rightLabel,
  brandDefault,
  compact,
  disabled,
}: {
  id: string;
  title: string;
  helper: string;
  value: number;
  onChange: (v: number) => void;
  ranges: ReadonlyArray<Range> | undefined;
  leftLabel: string;
  rightLabel: string;
  brandDefault?: number | null;
  compact?: boolean;
  disabled?: boolean;
}) {
  const label = labelFor(ranges, value);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {title}
        </label>
        <span className="text-sm">
          {label ? <span className="font-medium">{label}</span> : null}
          <span className="num ml-1.5 text-fg-muted">{fmtControl(value)}</span>
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <span className="w-16 shrink-0 whitespace-nowrap text-[11px] text-fg-subtle">
          {leftLabel}
        </span>
        <Slider
          id={id}
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          aria-label={title}
          aria-valuetext={`${fmtControl(value)} ${label}`}
        />
        <span className="w-16 shrink-0 whitespace-nowrap text-right text-[11px] text-fg-subtle">
          {rightLabel}
        </span>
      </div>
      <p className={cn("mt-1 text-xs text-fg-subtle", compact && "line-clamp-2")}>
        {helper}
        {brandDefault != null ? (
          <span className="text-fg-subtle">
            {" "}
            Brand default: {labelFor(ranges, brandDefault)} · {fmtControl(brandDefault)}.
          </span>
        ) : null}
      </p>
      {!compact && summaryFor(ranges, value) ? (
        <p className="mt-1 text-xs text-fg-muted">{summaryFor(ranges, value)}</p>
      ) : null}
    </div>
  );
}

/**
 * Creative Freedom and Goal Focus sliders with live semantic labels and presets. Everything it
 * displays (labels, ranges, presets) comes from the studio settings so the pipeline stays the
 * single source of truth; nothing here talks about temperature or sampling.
 */
export function CreativeControlsEditor({
  value,
  onChange,
  settings,
  brandDefault,
  compact,
  disabled,
}: {
  value: CreativeValues;
  onChange: (v: CreativeValues) => void;
  settings: CreativeSettingsView | null | undefined;
  brandDefault?: CreativeValues | null;
  compact?: boolean;
  disabled?: boolean;
}) {
  const presets = settings?.presets ?? [];
  const activePreset = presets.find(
    (p) =>
      Math.abs(p.creative_freedom - value.creative_freedom) < 0.005 &&
      Math.abs(p.goal_focus - value.goal_focus) < 0.005,
  );
  return (
    <div className="space-y-4">
      {presets.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-fg-muted">Presets</span>
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              title={`${p.description} (${fmtControl(p.creative_freedom)} / ${fmtControl(p.goal_focus)})`}
              onClick={() =>
                onChange({ creative_freedom: p.creative_freedom, goal_focus: p.goal_focus })
              }
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                activePreset?.id === p.id
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-border bg-surface text-fg hover:bg-surface-2",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              {p.name}
            </button>
          ))}
          {!activePreset ? <Badge variant="outline">custom</Badge> : null}
        </div>
      ) : null}
      <ControlRow
        id="creative-freedom"
        title="Creative Freedom"
        helper="Controls how adventurous the creative direction may be. Hard product, brand, factual and budget constraints are always preserved."
        value={value.creative_freedom}
        onChange={(v) => onChange({ ...value, creative_freedom: v })}
        ranges={settings?.creative_ranges}
        leftLabel="Safe"
        rightLabel="Wild"
        brandDefault={brandDefault?.creative_freedom}
        compact={compact}
        disabled={disabled}
      />
      <ControlRow
        id="goal-focus"
        title="Goal Focus"
        helper="Controls how strongly each creative decision should serve the video's primary goal."
        value={value.goal_focus}
        onChange={(v) => onChange({ ...value, goal_focus: v })}
        ranges={settings?.goal_ranges}
        leftLabel="Explore"
        rightLabel="Goal-first"
        brandDefault={brandDefault?.goal_focus}
        compact={compact}
        disabled={disabled}
      />
    </div>
  );
}

/** Compact read-only rendering, e.g. "Bold · 0.70". */
export function CreativeChip({
  label,
  value,
  title,
}: {
  label: string;
  value: number;
  title: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-sm" title={title}>
      <span className="font-medium">{label}</span>
      <span className="num text-fg-muted">· {fmtControl(value)}</span>
    </span>
  );
}
