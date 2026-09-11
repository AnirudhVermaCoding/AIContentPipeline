import * as path from "node:path";
import { appendJsonl, nowIso, readJsonl } from "../util/fs.js";

export interface PipelineEvent {
  ts: string;
  level: "info" | "warn" | "error" | "debug";
  stage: string | null;
  shot?: string | null;
  message: string;
  data?: Record<string, unknown>;
}

export interface Decision {
  ts: string;
  stage: string;
  category: string;
  subject: string;
  options_considered: string[];
  reason: string;
  shot?: string | null;
}

/** Append-only run log (events.jsonl) + decision log (decisions.jsonl) + console output. */
export class Events {
  private readonly eventsFile: string;
  private readonly decisionsFile: string;
  constructor(
    runDir: string,
    private readonly quiet = false,
  ) {
    this.eventsFile = path.join(runDir, "events.jsonl");
    this.decisionsFile = path.join(runDir, "decisions.jsonl");
  }

  private emit(e: Omit<PipelineEvent, "ts">): void {
    const full: PipelineEvent = { ts: nowIso(), ...e };
    appendJsonl(this.eventsFile, full);
    if (this.quiet && e.level === "debug") return;
    const tag = e.stage ? `[${e.stage}${e.shot ? `/${e.shot}` : ""}]` : "[run]";
    const line = `${tag} ${e.message}`;
    if (e.level === "error") console.error(line);
    else if (e.level === "warn") console.warn(line);
    else if (!this.quiet) console.log(line);
  }

  info(stage: string | null, message: string, data?: Record<string, unknown>, shot?: string): void {
    this.emit({ level: "info", stage, shot, message, data });
  }
  warn(stage: string | null, message: string, data?: Record<string, unknown>, shot?: string): void {
    this.emit({ level: "warn", stage, shot, message, data });
  }
  error(
    stage: string | null,
    message: string,
    data?: Record<string, unknown>,
    shot?: string,
  ): void {
    this.emit({ level: "error", stage, shot, message, data });
  }
  debug(
    stage: string | null,
    message: string,
    data?: Record<string, unknown>,
    shot?: string,
  ): void {
    this.emit({ level: "debug", stage, shot, message, data });
  }

  decision(d: Omit<Decision, "ts">): void {
    appendJsonl(this.decisionsFile, { ts: nowIso(), ...d });
    this.emit({
      level: "debug",
      stage: d.stage,
      shot: d.shot,
      message: `decision ${d.category}/${d.subject}: ${d.reason}`,
    });
  }

  decisions(): Decision[] {
    return readJsonl<Decision>(this.decisionsFile);
  }
}
