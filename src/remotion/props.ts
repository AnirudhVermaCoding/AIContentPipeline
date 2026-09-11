import type { Edl } from "../schema/edl";

/** Everything the composition needs; asset paths are relative to the bundle's public dir. */
export interface BrandVideoProps {
  edl: Edl;
  brand: {
    name: string;
    colors: {
      primary: string;
      secondary: string;
      accent: string;
      background: string;
      text: string;
    };
    fonts: { heading: string; body: string; source: "google" | "system" };
    safeZone: { top_pct: number; bottom_pct: number; side_pct: number };
  };
  /** Music volume (linear) per frame, already ducked by the voice envelope. */
  musicVolumeByFrame: number[];
  logoSrc: string | null;
}

export const COMPOSITION_ID = "BrandVideo";
