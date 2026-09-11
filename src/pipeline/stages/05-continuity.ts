import * as fs from "node:fs";
import * as path from "node:path";
import { runContinuityController } from "../../agents/continuity-controller.js";
import { promptVersions } from "../../agents/prompts.js";
import { CreativeBriefSchema } from "../../schema/brief.js";
import { type ContinuityBible, ContinuityBibleSchema } from "../../schema/continuity.js";
import type { StoryboardArtifact } from "../../schema/storyboard.js";
import { StoryboardArtifactSchema } from "../../schema/storyboard.js";
import { exists, readJson, shortHash, writeJsonAtomic } from "../../util/fs.js";
import type { StageDef } from "../stage.js";

/** Sidecar: per-shot hash of the storyboard entry (and available refs) the bible was built from. */
export const CONTINUITY_HASHES_FILE = "shot_hashes.json";

export function continuityShotHashes(
  storyboard: StoryboardArtifact,
  available: Record<string, string[]>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of storyboard.shots) out[s.id] = shortHash({ shot: s, refs: available });
  return out;
}

function entitySet(sb: StoryboardArtifact): string {
  return [...new Set(sb.shots.flatMap((s) => s.entities_in_frame))].sort().join(",");
}

/**
 * Keep continuity text verbatim for everything that did not change. A re-run of the continuity
 * LLM rewrites every sentence; without this merge one storyboard edit would change every shot's
 * hash and re-pay every keyframe and clip.
 */
export function mergeContinuity(
  previous: ContinuityBible,
  fresh: ContinuityBible,
  prevHashes: Record<string, string>,
  hashes: Record<string, string>,
  sameEntitySet: boolean,
  allRefs: Set<string>,
): { bible: ContinuityBible; preservedShots: string[] } {
  const preservedShots: string[] = [];
  const perShot = fresh.per_shot.map((p) => {
    if (prevHashes[p.shot_id] !== hashes[p.shot_id]) return p;
    const old = previous.per_shot.find((q) => q.shot_id === p.shot_id);
    if (!old || old.reference_images.some((r) => !allRefs.has(r))) return p;
    preservedShots.push(p.shot_id);
    return old;
  });
  const bible: ContinuityBible = sameEntitySet
    ? {
        entities: previous.entities,
        locks: previous.locks,
        style_bible: previous.style_bible,
        per_shot: perShot,
      }
    : { ...fresh, per_shot: perShot };
  return { bible, preservedShots };
}

/** Identity-critical references lead, nothing duplicated, at most four per shot. */
function enforceIdentityRefs(
  bible: ContinuityBible,
  identityRefs: Record<string, string[]>,
  storyboard: StoryboardArtifact,
): ContinuityBible {
  const per_shot = bible.per_shot.map((p) => {
    const shot = storyboard.shots.find((s) => s.id === p.shot_id);
    const must = (shot?.entities_in_frame ?? []).flatMap((id) => identityRefs[id] ?? []);
    if (!must.length) return p;
    const ordered = [...must.slice(0, 3), ...p.reference_images.filter((r) => !must.includes(r))];
    return { ...p, reference_images: [...new Set(ordered)].slice(0, 4) };
  });
  return { ...bible, per_shot };
}

export const continuityStage: StageDef = {
  id: "continuity",
  version: "2",
  dir: "05_continuity",
  dependsOn: ["brief", "storyboard"],
  extraInputs: (run) => ({
    prompts: promptVersions(["continuity-controller"]),
    entities: run.brand.profile.entities.map((e) => e.id),
    merge: run.options.continuity_merge ?? "preserve_unchanged",
  }),
  async run(ctx) {
    const { run } = ctx;
    const brief = ctx.input("brief", CreativeBriefSchema);
    const storyboard = ctx.input("storyboard", StoryboardArtifactSchema);

    // Reference images available per entity (brand assets), copied into the run so artifacts stay portable.
    const refsDir = path.join(ctx.stageDir, "refs");
    fs.mkdirSync(refsDir, { recursive: true });
    const available: Record<string, string[]> = {};
    const identity: Record<string, string[]> = {};
    for (const ent of run.brand.profile.entities) {
      available[ent.id] = [];
      identity[ent.id] = [];
      ent.reference_images.forEach((abs, i) => {
        const target = path.join(refsDir, `${ent.id}_${i + 1}${path.extname(abs) || ".png"}`);
        if (!fs.existsSync(target)) fs.copyFileSync(abs, target);
        const rel = run.rel(target);
        available[ent.id]?.push(rel);
        if (ent.identity_refs.includes(abs)) identity[ent.id]?.push(rel);
      });
    }
    const allRefs = new Set(Object.values(available).flat());
    const hashes = continuityShotHashes(storyboard, available);
    const hashFile = ctx.file(CONTINUITY_HASHES_FILE);
    const merge = run.options.continuity_merge ?? "preserve_unchanged";
    const outputFile = run.outputPath(this.dir);
    let previous: ContinuityBible | null = null;
    let prevHashes: Record<string, string> | null = null;
    if (merge === "preserve_unchanged" && exists(outputFile) && exists(hashFile)) {
      const parsed = ContinuityBibleSchema.safeParse(readJson(outputFile));
      if (parsed.success) {
        previous = parsed.data;
        prevHashes = readJson<Record<string, string>>(hashFile);
      }
    }
    const prevEntitySet = previous
      ? [...new Set(previous.entities.map((e) => e.id))].sort().join(",")
      : null;
    const sameEntitySet = prevEntitySet === entitySet(storyboard);

    let bible: ContinuityBible;
    if (
      previous &&
      prevHashes &&
      sameEntitySet &&
      storyboard.shots.every((s) => prevHashes?.[s.id] === hashes[s.id]) &&
      previous.per_shot.length === storyboard.shots.length
    ) {
      // Nothing that feeds continuity changed: reuse the bible without a model call.
      bible = previous;
      run.events.info(
        this.id,
        "storyboard shots unchanged; continuity reused without a model call",
      );
    } else {
      const result = await runContinuityController(run, this.id, brief, storyboard, available);
      bible = result.data;
      if (previous && prevHashes) {
        const merged = mergeContinuity(previous, bible, prevHashes, hashes, sameEntitySet, allRefs);
        bible = merged.bible;
        if (merged.preservedShots.length)
          run.events.info(
            this.id,
            `continuity preserved verbatim for ${merged.preservedShots.length} unchanged shot(s)`,
          );
      }
    }
    bible = enforceIdentityRefs(bible, identity, storyboard);
    ctx.writeOutput(bible);
    writeJsonAtomic(hashFile, hashes);
    run.events.info(
      this.id,
      `${bible.entities.length} entities locked, ${bible.per_shot.filter((p) => p.reference_images.length).length} shots with references`,
    );
    return { status: "done" };
  },
};
