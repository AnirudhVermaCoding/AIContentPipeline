import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface PromptFile {
  name: string;
  version: string;
  text: string;
}

const cache = new Map<string, PromptFile>();

export function promptsDir(): string {
  return process.env.AICP_PROMPTS_DIR ?? fileURLToPath(new URL("../../prompts/", import.meta.url));
}

/** Load `prompts/<name>.md` with a `version:` front-matter field (part of every input hash). */
export function loadPrompt(name: string): PromptFile {
  const cached = cache.get(name);
  if (cached) return cached;
  const file = path.join(promptsDir(), `${name}.md`);
  if (!fs.existsSync(file)) throw new Error(`Prompt file not found: ${file}`);
  const raw = fs.readFileSync(file, "utf8");
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  let version = "0";
  let text = raw;
  if (m) {
    const front = m[1] ?? "";
    text = m[2] ?? "";
    const v = front.match(/version:\s*(.+)/);
    if (v?.[1]) version = v[1].trim();
  }
  const prompt = { name, version, text: text.trim() };
  cache.set(name, prompt);
  return prompt;
}

export function promptVersions(names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) out[n] = loadPrompt(n).version;
  return out;
}
