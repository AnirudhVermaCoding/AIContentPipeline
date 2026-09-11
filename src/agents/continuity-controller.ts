import type { RunContext } from "../pipeline/run.js";
import type { CreativeBrief } from "../schema/brief.js";
import { type ContinuityBible, ContinuityBibleSchema } from "../schema/continuity.js";
import type { Storyboard } from "../schema/storyboard.js";
import { type AgentResult, callAgent } from "./base.js";
import { knownEntityIds } from "./storyboard-artist.js";

export async function runContinuityController(
  run: RunContext,
  stageId: string,
  brief: CreativeBrief,
  storyboard: Storyboard,
  availableRefs: Record<string, string[]>,
): Promise<AgentResult<ContinuityBible>> {
  const b = run.brand.profile;
  const used = new Set(storyboard.shots.flatMap((s) => s.entities_in_frame));
  const known = knownEntityIds(run, brief);
  const entityLines = [...known]
    .map((id) => {
      const brandEnt = b.entities.find((e) => e.id === id);
      const briefEnt = brief.entities_needed.find((e) => e.id === id);
      const desc = brandEnt
        ? `${brandEnt.kind}: ${brandEnt.name}. Static: ${brandEnt.static_features}. Usually: ${brandEnt.dynamic_defaults || "n/a"}`
        : `new: ${briefEnt?.description ?? ""}`;
      const refs = availableRefs[id] ?? [];
      return `- ${id} (${used.has(id) ? "in frame" : "not used"}) ${desc}. Reference images: ${refs.length ? refs.join(", ") : "none"}`;
    })
    .join("\n");
  const shots = storyboard.shots
    .map(
      (s) =>
        `- ${s.id} @${s.location_id}: ${s.description} | action: ${s.action} | entities: ${s.entities_in_frame.join(", ") || "none"} | light: ${s.lighting} | continuity: ${s.continuity_notes}`,
    )
    .join("\n");
  const userMessage = `# Continuity assignment
${run.brain.visual}

## Brief visual world
${brief.visual_world.setting}; ${brief.visual_world.time_of_day}; ${brief.visual_world.lighting}; palette: ${brief.visual_world.palette_note}; texture: ${brief.visual_world.texture_note}

## Entities (use only these ids; only these reference image paths)
${entityLines || "- none"}

## Shots
${shots}

Write the ContinuityBible. Every entity that is in frame anywhere must have an entry; every shot must have exactly one per_shot entry.`;

  const allRefs = new Set(Object.values(availableRefs).flat());
  return callAgent(run, {
    name: "continuity-controller",
    tier: "fast",
    schema: ContinuityBibleSchema,
    userMessage,
    stageId,
    expectedOutputTokens: 2500,
    validate: (cb) => {
      const issues: string[] = [];
      const ids = new Set(cb.entities.map((e) => e.id));
      for (const id of used)
        if (!ids.has(id)) issues.push(`entity "${id}" appears in shots but has no entry`);
      for (const e of cb.entities) {
        if (!known.has(e.id)) issues.push(`unknown entity id "${e.id}"`);
        if (e.identity_block.trim().split(/\s+/).length < 6)
          issues.push(`identity_block for ${e.id} is too thin`);
        for (const r of e.reference_images)
          if (!allRefs.has(r))
            issues.push(`entity ${e.id} lists an unavailable reference image ${r}`);
      }
      const shotIds = storyboard.shots.map((s) => s.id);
      const seen = new Map<string, number>();
      for (const p of cb.per_shot) {
        seen.set(p.shot_id, (seen.get(p.shot_id) ?? 0) + 1);
        if (!shotIds.includes(p.shot_id))
          issues.push(`per_shot references unknown shot ${p.shot_id}`);
        for (const r of p.reference_images)
          if (!allRefs.has(r))
            issues.push(`${p.shot_id} lists an unavailable reference image ${r}`);
        if (p.reference_images.length > 4)
          issues.push(`${p.shot_id} lists more than 4 reference images`);
      }
      for (const id of shotIds) {
        const c = seen.get(id) ?? 0;
        if (c !== 1) issues.push(`shot ${id} must have exactly one per_shot entry (has ${c})`);
      }
      return issues;
    },
  });
}
