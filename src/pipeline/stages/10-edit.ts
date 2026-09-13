import { z } from "zod";
import { controlsForRun, creativeHashInputs } from "../../creative/controls.js";
import { AudioPlanSchema } from "../../schema/audio.js";
import { CreativeBriefSchema } from "../../schema/brief.js";
import { type EditMode, OUTPUT } from "../../schema/common.js";
import type { Edl, TextOverlay, TimelineItem } from "../../schema/edl.js";
import { StoryboardArtifactSchema } from "../../schema/storyboard.js";
import { VoiceResultSchema } from "../../schema/voice.js";
import { loadShotRecord } from "../shots.js";
import type { StageDef } from "../stage.js";

const ORDER: EditMode[] = ["NONE", "FINISH_ONLY", "LIGHT", "ASSEMBLY"];
const richer = (a: EditMode, b: EditMode): EditMode =>
  ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;

/**
 * Edit Decision (MVP-A, deterministic): realise the brief's edit intent against the assets that
 * actually exist and the brand's policies. Cuts by default; text, end card, logo and captions only
 * when the brief and the brand both allow them.
 */
export const editStage: StageDef = {
  id: "edit",
  version: "1",
  dir: "10_edit",
  dependsOn: ["brief", "storyboard", "voice", "animate", "audio"],
  extraInputs: (run) => ({
    edit: run.brand.profile.edit_defaults,
    text: run.brand.profile.text_policy,
    cta: run.brand.profile.cta,
    ...creativeHashInputs(run.manifest),
  }),
  async run(ctx) {
    const { run } = ctx;
    const b = run.brand.profile;
    // Creative controls (medium influence, deterministic): freedom scales still motion inside the
    // brand's bound; goal focus trims decorative overlays. No new effects, no fake transitions.
    const controls = controlsForRun(run);
    const cf = controls.creative_freedom;
    const gf = controls.goal_focus;
    const motionScale = cf <= 0.4 ? 0.6 : cf <= 0.6 ? 0.8 : 1;
    const brief = ctx.input("brief", CreativeBriefSchema);
    const storyboard = ctx.input("storyboard", StoryboardArtifactSchema);
    const voice = ctx.input("voice", VoiceResultSchema);
    const audio = ctx.input("audio", AudioPlanSchema);
    ctx.input("animate", z.object({ shots: z.array(z.object({ shot_id: z.string() })) }));

    // Timeline from the conformed storyboard and the produced assets.
    const timeline: TimelineItem[] = [];
    const reasons: string[] = [];
    storyboard.shots.forEach((shot, i) => {
      const record = loadShotRecord(run, shot.id);
      if (!record?.final) throw new Error(`${shot.id} has no final asset`);
      const start = storyboard.shot_start_s[i] ?? 0;
      const isVideo = record.final.kind === "video";
      const treatment = isVideo
        ? "none"
        : record.source === "STILL" && record.status !== "downgraded"
          ? "hold"
          : shot.movement === "pan_left" || shot.movement === "pan_right"
            ? "parallax"
            : "ken_burns";
      timeline.push({
        shot_id: shot.id,
        asset: record.final.path,
        kind: record.final.kind,
        in_s: 0,
        out_s: isVideo ? record.final.meta.duration_s : shot.duration_s,
        start_s: Math.round(start * 1000) / 1000,
        duration_s: shot.duration_s,
        treatment,
        treatment_amount:
          treatment === "hold" || treatment === "none"
            ? 0
            : Math.round(b.edit_defaults.still_motion_amount * motionScale * 100) / 100,
        fit: "cover",
      });
    });
    const lastItem = timeline[timeline.length - 1];
    const bodyEnd = lastItem ? lastItem.start_s + lastItem.duration_s : 0;

    // Text policy.
    const textAllowed = brief.text_overlay_intent !== "none" && b.text_policy.captions !== "never";
    let overlays: TextOverlay[] = [];
    if (textAllowed) {
      storyboard.shots.forEach((shot, i) => {
        if (!shot.text_overlay) return;
        const start = (storyboard.shot_start_s[i] ?? 0) + 0.4;
        const end = (storyboard.shot_start_s[i] ?? 0) + shot.duration_s - 0.2;
        if (end - start < 0.8) return;
        overlays.push({
          text: shot.text_overlay.text,
          role: shot.text_overlay.role,
          start_s: Math.round(start * 100) / 100,
          end_s: Math.round(end * 100) / 100,
          position: "top_safe",
          style: shot.text_overlay.role === "hook" ? "brand_heading" : "brand_body",
        });
      });
      if (gf < 0.3 && overlays.some((o) => o.role === "emphasis")) {
        overlays = overlays.filter((o) => o.role !== "emphasis");
        reasons.push("low goal focus: emphasis overlays dropped in favour of mood");
      }
      if (
        gf >= 0.8 &&
        brief.text_overlay_intent === "captions" &&
        (b.text_policy.captions === "when_needed" || b.text_policy.captions === "always")
      ) {
        const hook = overlays.find((o) => o.role === "hook");
        const cta = overlays.find((o) => o.role === "cta");
        const keep = [hook, cta].filter((o): o is TextOverlay => !!o);
        if (keep.length && keep.length < overlays.length) {
          overlays = keep;
          reasons.push("goal-first: overlays limited to the hook and the call to action");
        }
      }
      if (
        b.text_policy.captions === "brand_hook_only" ||
        brief.text_overlay_intent === "hook_only"
      ) {
        const hook = overlays.find((o) => o.role === "hook") ?? overlays[0];
        overlays = hook ? [hook] : [];
      }
    }
    reasons.push(
      `creative freedom ${controls.creative_label} ${cf.toFixed(2)} (still motion ×${motionScale}), goal focus ${controls.goal_label} ${gf.toFixed(2)}`,
    );
    const wantsCaptions =
      brief.text_overlay_intent === "captions" &&
      (b.text_policy.captions === "when_needed" || b.text_policy.captions === "always") &&
      !!voice.words?.length;

    const endCardWanted =
      b.cta.end_card &&
      brief.cta_decision.use &&
      (brief.cta_decision.style === "end_card" || brief.cta_decision.style === null);
    const logo = b.visual.logos[0] ?? null;
    const logoPlacement = b.edit_defaults.logo_placement;

    // Mode: start from intent, promote when the brand's policies need a richer edit, clamp to allowed.
    let mode: EditMode = brief.edit_mode_intent;
    const singleClip = timeline.length === 1 && timeline[0]?.kind === "video";
    if (mode === "NONE" && (!singleClip || overlays.length || endCardWanted)) {
      mode = "FINISH_ONLY";
      reasons.push("NONE needs a single continuous clip and no text; using FINISH_ONLY");
    }
    if (
      mode === "FINISH_ONLY" &&
      (overlays.length || endCardWanted || (logo && logoPlacement !== "none"))
    ) {
      mode = "LIGHT";
      reasons.push("brand policy asks for a hook line, end card or logo; using LIGHT");
    }
    if (mode === "LIGHT" && wantsCaptions) {
      mode = "ASSEMBLY";
      reasons.push("captions requested; using ASSEMBLY");
    }
    if (!b.edit_defaults.modes_allowed.includes(mode)) {
      const allowed = ORDER.filter((m) => b.edit_defaults.modes_allowed.includes(m));
      const next =
        allowed.find((m) => ORDER.indexOf(m) >= ORDER.indexOf(mode)) ??
        allowed[allowed.length - 1] ??
        "ASSEMBLY";
      reasons.push(`${mode} not allowed for this brand; using ${next}`);
      mode = next;
    }
    mode = richer(mode, "NONE");

    const light = mode === "LIGHT" || mode === "ASSEMBLY";
    const endCard =
      light && endCardWanted
        ? {
            duration_s: 2.5,
            text: brief.cta_decision.text ?? b.cta.patterns[0] ?? null,
            show_logo: !!logo,
            background: b.visual.colors.background,
          }
        : null;
    const total = bodyEnd + (endCard ? endCard.duration_s : 0);

    const edl: Edl = {
      mode,
      output: { ...OUTPUT },
      target_duration_s: brief.target_duration_s,
      total_duration_s: Math.round(total * 100) / 100,
      timeline,
      text_overlays: light ? overlays : [],
      transitions: timeline.slice(0, -1).map((t) => ({
        after_shot: t.shot_id,
        type: "cut" as const,
        duration_s: 0,
        reason: "cut by default",
      })),
      audio: {
        voice_path: audio.voice?.path ?? null,
        voice_start_s: storyboard.voice_offset_s,
        music_path: audio.music?.path ?? null,
        music_gain_db: audio.music?.gain_db ?? b.music.gain_db,
        ducking: audio.music?.ducking ?? null,
        envelope_path: audio.voice?.envelope_path ?? null,
        fade_out_s: audio.music?.fade_out_s ?? 1.5,
      },
      end_card: endCard,
      logo:
        light && logo && logoPlacement !== "none"
          ? { path: logo.path, placement: logoPlacement }
          : null,
      captions:
        mode === "ASSEMBLY" && wantsCaptions && voice.words
          ? { words: voice.words, style: "clean" }
          : null,
      decision_reason: [`intent ${brief.edit_mode_intent} → ${mode}`, ...reasons].join("; "),
    };

    // Structural checks.
    for (let i = 1; i < timeline.length; i++) {
      const prev = timeline[i - 1];
      const cur = timeline[i];
      if (prev && cur && Math.abs(prev.start_s + prev.duration_s - cur.start_s) > 0.05) {
        throw new Error(`timeline gap between ${prev.shot_id} and ${cur.shot_id}`);
      }
    }
    if (voice.audio_path && edl.audio.voice_start_s + voice.duration_s > bodyEnd + 0.1) {
      throw new Error("narration runs past the last shot");
    }
    if (total < b.pacing.duration_s.min * 0.85 || total > b.pacing.duration_s.max * 1.15) {
      run.events.warn(
        this.id,
        `total ${total.toFixed(1)}s is outside the brand range ${b.pacing.duration_s.min}-${b.pacing.duration_s.max}s`,
      );
    }

    ctx.writeOutput(edl);
    run.events.decision({
      stage: this.id,
      category: "edit",
      subject: "mode",
      options_considered: b.edit_defaults.modes_allowed,
      reason: edl.decision_reason,
    });
    run.events.info(
      this.id,
      `${mode}: ${timeline.length} shots, ${edl.text_overlays.length} text overlay(s), ${endCard ? "end card, " : ""}${edl.captions ? "captions, " : ""}${edl.audio.music_path ? "music" : "no music"}, ${edl.total_duration_s}s`,
    );
    return { status: "done" };
  },
};
