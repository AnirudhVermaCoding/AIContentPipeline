import type { RunContext } from "../pipeline/run.js";
import type { CreativeBrief } from "../schema/brief.js";
import { type ResearchNotes, ResearchNotesSchema } from "../schema/research.js";
import { type AgentResult, callAgent } from "./base.js";

export async function runResearcher(
  run: RunContext,
  stageId: string,
  brief: CreativeBrief,
): Promise<AgentResult<ResearchNotes>> {
  const b = run.brand.profile;
  const userMessage = `# Research request (depth: ${brief.research_depth})
Topic concept: ${brief.concept}
Key message: ${brief.key_message}
Audience insight: ${brief.audience_insight}

## Questions to answer
${brief.research_questions.length ? brief.research_questions.map((q) => `- ${q}`).join("\n") : "- What concrete, filmable details make this true?"}

## Brand context
Audience: ${b.audience.primary}
Product: ${b.product.name}: ${b.product.description}
Forbidden claims: ${[...b.product.forbidden_claims, ...b.forbidden.claims].join("; ") || "none"}

Set depth to "${brief.research_depth}". Return ResearchNotes.`;

  return callAgent(run, {
    name: "researcher",
    tier: "creative",
    schema: ResearchNotesSchema,
    userMessage,
    stageId,
    webSearch: brief.research_depth === "deep",
    validate: (r) => {
      const issues: string[] = [];
      if (r.facts.length === 0 && r.sensory_details.length === 0)
        issues.push("return at least one fact or sensory detail");
      return issues;
    },
  });
}
