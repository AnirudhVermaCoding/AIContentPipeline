"use client";

import type { CreativeSettingsView } from "@pipeline/studio/api-types";
import { RadioGroup } from "@/components/ui/radio-group";
import { useStudio } from "@/lib/studio-context";

export type Variation = CreativeSettingsView["variation_options"][number]["id"];

const FALLBACK: CreativeSettingsView["variation_options"] = [
  { id: "small", label: "Small variation", description: "" },
  { id: "fresh", label: "Fresh direction", description: "" },
  { id: "different", label: "Completely different", description: "" },
];

/**
 * "How different should the new version be?" for every regeneration dialog. Separate from the
 * run's creative freedom: this is distance from the previous version, not adventurousness.
 */
export function VariationPicker({
  value,
  onChange,
  disabled,
  name = "variation",
}: {
  value: Variation;
  onChange: (v: Variation) => void;
  disabled?: boolean;
  name?: string;
}) {
  const { settings } = useStudio();
  const options = settings?.creative.variation_options ?? FALLBACK;
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-fg-muted">
        How different should the new version be?
      </p>
      <RadioGroup
        name={name}
        value={value}
        onValueChange={onChange}
        options={options}
        disabled={disabled}
      />
    </div>
  );
}
