import type React from "react";
import { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  continueRender,
  delayRender,
  Freeze,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { TextOverlay, TimelineItem } from "../../schema/edl";
import type { BrandVideoProps } from "../props";

const toFrames = (s: number, fps: number) => Math.round(s * fps);

function useBrandFonts(fonts: BrandVideoProps["brand"]["fonts"]): string {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (fonts.source !== "google" || typeof document === "undefined") return;
    const handle = delayRender("loading brand fonts", { timeoutInMilliseconds: 8000 });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setLoaded(true);
      continueRender(handle);
    };
    try {
      const families = [...new Set([fonts.heading, fonts.body])]
        .map((f) => `family=${encodeURIComponent(f)}:wght@500;600;700`)
        .join("&");
      const href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
      if (!document.querySelector(`link[href="${href}"]`)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.onload = () => {
          document.fonts?.ready.then(finish).catch(finish);
        };
        link.onerror = finish;
        document.head.appendChild(link);
      } else {
        finish();
      }
    } catch {
      finish();
    }
    // Fonts are a nicety: never hold the render for more than a few seconds.
    const timer = setTimeout(finish, 4000);
    return () => clearTimeout(timer);
  }, [fonts]);
  return loaded ? "google" : "system";
}

const Still: React.FC<{ item: TimelineItem; src: string }> = ({ item, src }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const frames = Math.max(1, toFrames(item.duration_s, fps));
  const p = Math.min(1, frame / frames);
  const amount = item.treatment === "hold" || item.treatment === "none" ? 0 : item.treatment_amount;
  const scale = 1 + 0.12 * amount * (item.treatment === "parallax" ? 0.6 : 1) * p;
  const translateX = item.treatment === "parallax" ? interpolate(p, [0, 1], [0, -18 * amount]) : 0;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: item.fit,
          transform: `scale(${scale}) translateX(${translateX}px)`,
        }}
      />
    </AbsoluteFill>
  );
};

const Clip: React.FC<{ item: TimelineItem; src: string }> = ({ item, src }) => {
  const { fps } = useVideoConfig();
  const shotFrames = Math.max(1, toFrames(item.duration_s, fps));
  const clipLen = Math.max(0.1, item.out_s - item.in_s);
  const ratio = clipLen / item.duration_s;
  // Slightly slow the clip to fill the shot when it is close; otherwise play it and hold the last frame.
  const playbackRate = ratio >= 0.8 && ratio < 1 ? ratio : 1;
  const playedFrames = Math.min(shotFrames, toFrames(clipLen / playbackRate, fps));
  const video = (
    <OffthreadVideo
      src={src}
      trimBefore={toFrames(item.in_s, fps)}
      trimAfter={toFrames(item.out_s, fps)}
      playbackRate={playbackRate}
      muted
      style={{ width: "100%", height: "100%", objectFit: item.fit }}
    />
  );
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Sequence from={0} durationInFrames={playedFrames} layout="none">
        {video}
      </Sequence>
      {playedFrames < shotFrames && (
        <Sequence from={playedFrames} durationInFrames={shotFrames - playedFrames} layout="none">
          <Freeze frame={Math.max(0, playedFrames - 1)}>{video}</Freeze>
        </Sequence>
      )}
    </AbsoluteFill>
  );
};

const Overlay: React.FC<{
  overlay: TextOverlay;
  brand: BrandVideoProps["brand"];
  fontMode: string;
}> = ({ overlay, brand, fontMode }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const fadeIn = interpolate(frame, [0, Math.round(fps * 0.35)], [0, 1], {
    extrapolateRight: "clamp",
  });
  const total = toFrames(overlay.end_s - overlay.start_s, fps);
  const fadeOut = interpolate(frame, [total - Math.round(fps * 0.3), total], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const family =
    overlay.style === "brand_heading"
      ? `${fontMode === "google" ? `"${brand.fonts.heading}", ` : ""}Georgia, "Helvetica Neue", sans-serif`
      : `${fontMode === "google" ? `"${brand.fonts.body}", ` : ""}"Helvetica Neue", Arial, sans-serif`;
  const top =
    overlay.position === "top_safe"
      ? height * (brand.safeZone.top_pct / 100 + 0.03)
      : overlay.position === "center"
        ? height * 0.45
        : height * (1 - brand.safeZone.bottom_pct / 100 - 0.14);
  return (
    <AbsoluteFill
      style={{ justifyContent: "flex-start", alignItems: "center", pointerEvents: "none" }}
    >
      <div
        style={{
          position: "absolute",
          top,
          left: width * (brand.safeZone.side_pct / 100),
          right: width * (brand.safeZone.side_pct / 100),
          textAlign: "center",
          color: brand.colors.text,
          fontFamily: family,
          fontSize: overlay.style === "brand_heading" ? 46 : 34,
          fontWeight: overlay.style === "brand_heading" ? 700 : 500,
          lineHeight: 1.2,
          textShadow: "0 2px 18px rgba(0,0,0,0.55)",
          opacity: Math.min(fadeIn, fadeOut),
        }}
      >
        {overlay.text}
      </div>
    </AbsoluteFill>
  );
};

const EndCard: React.FC<{ props: BrandVideoProps; fontMode: string }> = ({ props, fontMode }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const card = props.edl.end_card;
  if (!card) return null;
  const opacity = interpolate(frame, [0, Math.round(fps * 0.4)], [0, 1], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        backgroundColor: card.background,
        justifyContent: "center",
        alignItems: "center",
        opacity,
        gap: 28,
        flexDirection: "column",
      }}
    >
      {card.show_logo && props.logoSrc && (
        <Img
          src={props.logoSrc}
          style={{ maxWidth: "42%", maxHeight: "22%", objectFit: "contain" }}
        />
      )}
      {card.text && (
        <div
          style={{
            color: props.brand.colors.text,
            fontFamily: `${fontMode === "google" ? `"${props.brand.fonts.heading}", ` : ""}Georgia, sans-serif`,
            fontSize: 40,
            fontWeight: 600,
            textAlign: "center",
            padding: "0 10%",
            lineHeight: 1.25,
          }}
        >
          {card.text}
        </div>
      )}
    </AbsoluteFill>
  );
};

const Captions: React.FC<{ props: BrandVideoProps; fontMode: string }> = ({ props, fontMode }) => {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();
  const caps = props.edl.captions;
  if (!caps) return null;
  const t = frame / fps - props.edl.audio.voice_start_s;
  const chunk = 4;
  const words = caps.words;
  let idx = -1;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w && t >= w.start - 0.05 && t <= w.end + 0.25) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return null;
  const start = Math.floor(idx / chunk) * chunk;
  const group = words.slice(start, start + chunk);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          bottom: height * (props.brand.safeZone.bottom_pct / 100 + 0.02),
          left: width * (props.brand.safeZone.side_pct / 100),
          right: width * (props.brand.safeZone.side_pct / 100),
          textAlign: "center",
          fontFamily: `${fontMode === "google" ? `"${props.brand.fonts.body}", ` : ""}"Helvetica Neue", Arial, sans-serif`,
          fontSize: 34,
          fontWeight: 600,
          color: props.brand.colors.text,
          textShadow: "0 2px 10px rgba(0,0,0,0.7)",
        }}
      >
        {group.map((w, i) => (
          <span
            key={`${w.start}:${w.word}`}
            style={{ opacity: start + i <= idx ? 1 : 0.55, marginRight: 8 }}
          >
            {w.word}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const BrandVideo: React.FC<BrandVideoProps> = (props) => {
  const { fps } = useVideoConfig();
  const fontMode = useBrandFonts(props.brand.fonts);
  const { edl } = props;
  const endCardStart = edl.end_card ? edl.total_duration_s - edl.end_card.duration_s : null;
  const musicVolume = (f: number) =>
    props.musicVolumeByFrame[Math.min(props.musicVolumeByFrame.length - 1, Math.max(0, f))] ?? 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {edl.timeline.map((item) => (
        <Sequence
          key={item.shot_id}
          from={toFrames(item.start_s, fps)}
          durationInFrames={Math.max(1, toFrames(item.duration_s, fps))}
        >
          {item.kind === "video" ? (
            <Clip item={item} src={staticFile(item.asset)} />
          ) : (
            <Still item={item} src={staticFile(item.asset)} />
          )}
        </Sequence>
      ))}

      {edl.text_overlays.map((o) => (
        <Sequence
          key={`${o.start_s}:${o.role}`}
          from={toFrames(o.start_s, fps)}
          durationInFrames={Math.max(1, toFrames(o.end_s - o.start_s, fps))}
        >
          <Overlay overlay={o} brand={props.brand} fontMode={fontMode} />
        </Sequence>
      ))}

      {edl.captions && <Captions props={props} fontMode={fontMode} />}

      {edl.end_card && endCardStart !== null && (
        <Sequence
          from={toFrames(endCardStart, fps)}
          durationInFrames={Math.max(1, toFrames(edl.end_card.duration_s, fps))}
        >
          <EndCard props={props} fontMode={fontMode} />
        </Sequence>
      )}

      {edl.logo?.placement === "corner" && props.logoSrc && (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          <Img
            src={props.logoSrc}
            style={{ position: "absolute", top: "5%", right: "5%", width: "16%", opacity: 0.85 }}
          />
        </AbsoluteFill>
      )}

      {edl.audio.voice_path && (
        <Sequence from={toFrames(edl.audio.voice_start_s, fps)} layout="none">
          <Audio src={staticFile(edl.audio.voice_path)} />
        </Sequence>
      )}
      {edl.audio.music_path && props.musicVolumeByFrame.length > 0 && (
        <Audio src={staticFile(edl.audio.music_path)} volume={musicVolume} loop />
      )}
    </AbsoluteFill>
  );
};
