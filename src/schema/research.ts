import { z } from "zod";
import { ResearchDepth } from "./common.js";

export const ResearchNotesSchema = z.object({
  depth: ResearchDepth,
  summary: z.string(),
  facts: z.array(
    z.object({
      claim: z.string(),
      source: z.string().nullable(),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
  audience_language: z
    .array(z.string())
    .describe("Phrases the audience actually uses about this topic"),
  sensory_details: z
    .array(z.string())
    .describe("Concrete, filmable details: objects, gestures, sounds, places"),
  sources: z.array(z.object({ title: z.string(), url: z.string().nullable() })),
  cautions: z.array(z.string()).describe("Claims to avoid or soften"),
});
export type ResearchNotes = z.infer<typeof ResearchNotesSchema>;

export const EMPTY_RESEARCH: ResearchNotes = {
  depth: "none",
  summary: "Research skipped by the creative brief.",
  facts: [],
  audience_language: [],
  sensory_details: [],
  sources: [],
  cautions: [],
};
