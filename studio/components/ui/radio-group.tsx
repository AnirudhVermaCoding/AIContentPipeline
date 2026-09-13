"use client";

import { cn } from "@/lib/utils";

export interface RadioOption<T extends string> {
  id: T;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** Native radios in a labelled group; keyboard and screen-reader behaviour come for free. */
export function RadioGroup<T extends string>({
  name,
  value,
  onValueChange,
  options,
  disabled,
  className,
}: {
  name: string;
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<RadioOption<T>>;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cn("grid gap-1.5", className)}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <label
            key={o.id}
            className={cn(
              "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
              active ? "border-accent bg-surface-2" : "border-border hover:bg-surface-2",
              (disabled || o.disabled) && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.id}
              checked={active}
              disabled={disabled || o.disabled}
              onChange={() => onValueChange(o.id)}
              className="mt-0.5 accent-neutral-900"
            />
            <span className="min-w-0">
              <span className="block font-medium">{o.label}</span>
              {o.description ? (
                <span className="block text-xs text-fg-muted">{o.description}</span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
