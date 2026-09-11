import type React from "react";
import { Composition } from "remotion";
import { BrandVideo } from "./compositions/BrandVideo";
import { type BrandVideoProps, COMPOSITION_ID } from "./props";

const defaultProps: BrandVideoProps = {
  edl: {
    mode: "ASSEMBLY",
    output: { width: 720, height: 1280, fps: 30 },
    target_duration_s: 10,
    total_duration_s: 10,
    timeline: [],
    text_overlays: [],
    transitions: [],
    audio: {
      voice_path: null,
      voice_start_s: 0,
      music_path: null,
      music_gain_db: -18,
      ducking: null,
      envelope_path: null,
      fade_out_s: 1,
    },
    end_card: null,
    logo: null,
    captions: null,
    decision_reason: "",
  },
  brand: {
    name: "Brand",
    colors: {
      primary: "#1F2A44",
      secondary: "#8FA3BF",
      accent: "#E9C46A",
      background: "#0F1420",
      text: "#F2F4F8",
    },
    fonts: { heading: "Inter", body: "Inter", source: "system" },
    safeZone: { top_pct: 12, bottom_pct: 20, side_pct: 8 },
  },
  musicVolumeByFrame: [],
  logoSrc: null,
};

export const Root: React.FC = () => (
  <Composition
    id={COMPOSITION_ID}
    component={BrandVideo as unknown as React.FC<Record<string, unknown>>}
    durationInFrames={300}
    fps={30}
    width={720}
    height={1280}
    defaultProps={defaultProps as unknown as Record<string, unknown>}
  />
);
