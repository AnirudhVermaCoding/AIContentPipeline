import {
  buildCreativeControlContext,
  controlsForRun,
  hardConstraintsFor,
} from "../creative/controls.js";
import type { RunContext } from "../pipeline/run.js";
import type { CreativeBrief } from "../schema/brief.js";
import type { ResearchNotes } from "../schema/research.js";
import { type Script, ScriptSchema } from "../schema/script.js";
import { type AgentResult, callAgent } from "./base.js";

const WORDS_PER_SECOND = 2.3;

export async function runScreenwriter(
  run: RunContext,
  stageId: string,
  brief: CreativeBrief,
  research: ResearchNotes,
): Promise<AgentResult<Script>> {
  const b = run.brand.profile;
  const wordBudget = Math.round(brief.target_duration_s * WORDS_PER_SECOND * 0.85);
  const facts = research.facts.map((f) => `- ${f.claim} (${f.confidence})`).join("\n");
  const controls = controlsForRun(run);
  const creative = buildCreativeControlContext({
    creativeFreedom: controls.creative_freedom,
    goalFocus: controls.goal_focus,
    stage: "script",
    goal: run.manifest.goal,
    hardConstraints: [
      ...hardConstraintsFor(run.brand),
      `Word budget: at most ${wordBudget} words; lines of 2 to 22 words; no em dashes.`,
      "Facts come only from the research notes and the brand profile; creativity never invents a claim.",
    ],
  });
  const userMessage = `# Script assignment
${run.brain.creative}

${run.brain.voice}

## Creative brief
Concept: ${brief.concept}
Hook: ${brief.hook.line} (${brief.hook.type})
Narrative device: ${brief.narrative_device}
Key message: ${brief.key_message}
Emotional arc: ${brief.emotional_arc.map((e) => `${e.beat} → ${e.emotion}`).join("; ")}
Target duration: ${brief.target_duration_s} s. Word budget: at most ${wordBudget} words${brief.cta_decision.use ? `\nCall to action: ${brief.cta_decision.text ?? "brand pattern"} (${brief.cta_decision.style ?? "spoken"})` : "\nNo call to action."}
Avoid: ${brief.avoid.join("; ") || "nothing specific"}

## Research
${research.summary}
${facts || "- no facts supplied"}
Audience language: ${research.audience_language.join(" | ") || "n/a"}
Sensory details: ${research.sensory_details.join(" | ") || "n/a"}
Cautions: ${research.cautions.join(" | ") || "none"}

${creative.text}

Narration policy for this brand is "${b.voice.narration_policy}". ${
    b.voice.narration_policy === "never"
      ? "Set music_only to true."
      : b.voice.narration_policy === "always"
        ? "The video must have narration."
        : "Decide honestly whether narration serves this story."
  }
Return the Script.`;

  const banned = [...b.forbidden.words, ...b.tone.avoid_phrases].map((w) => w.toLowerCase());
  return callAgent(run, {
    name: "screenwriter",
    tier: "creative",
    schema: ScriptSchema,
    userMessage,
    stageId,
    validate: (s) => {
      const issues: string[] = [];
      if (b.voice.narration_policy === "never" && !s.music_only)
        issues.push("music_only must be true");
      if (b.voice.narration_policy === "always" && s.music_only)
        issues.push("this brand always narrates");
      if (!s.music_only) {
        if (s.narration.length < 3) issues.push("need at least three narration lines");
        s.narration.forEach((line, i) => {
          const expected = `line_${String(i + 1).padStart(2, "0")}`;
          if (line.id !== expected) issues.push(`line ${i + 1} must have id ${expected}`);
          const words = line.text.trim().split(/\s+/).length;
          if (words < 2 || words > 24)
            issues.push(`${line.id} has ${words} words; keep lines between 2 and 22 words`);
          if (/—/.test(line.text)) issues.push(`${line.id} contains an em dash`);
          const lower = line.text.toLowerCase();
          for (const w of banned)
            if (w && lower.includes(w)) issues.push(`${line.id} uses the forbidden phrase "${w}"`);
        });
        const total = s.narration.reduce((n, l) => n + l.text.trim().split(/\s+/).length, 0);
        if (total > wordBudget * 1.25)
          issues.push(`${total} words is over the budget of ${wordBudget}; cut`);
      } else if (s.narration.length > 0) {
        issues.push("music_only scripts must have no narration lines");
      }
      return issues;
    },
  });
}
