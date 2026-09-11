import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `pnpm studio`: start the API server (tsx, repo root) and the Next.js app (studio/) together,
 * with one root so both agree on runs/, data/, brands/ and .env. Ctrl-C stops both; running
 * pipeline jobs are separate processes and keep going (they pause on their own SIGINT).
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiPort = process.env.STUDIO_API_PORT ?? "4747";
const webPort = process.env.STUDIO_WEB_PORT ?? "3000";
const env = {
  ...process.env,
  AICP_ROOT: root,
  STUDIO_API_PORT: apiPort,
  STUDIO_API_URL: `http://127.0.0.1:${apiPort}`,
  NEXT_PUBLIC_STUDIO_API_URL: `http://127.0.0.1:${apiPort}`,
  STUDIO_WEB_ORIGIN: `http://localhost:${webPort}`,
};

const children: ChildProcess[] = [];
function run(name: string, cmd: string, args: string[], cwd: string): ChildProcess {
  const child = spawn(cmd, args, { cwd, env, stdio: "inherit" });
  child.on("exit", (code) => {
    console.log(`[studio] ${name} exited (${code ?? "signal"})`);
    if (!stopping) stop(code ?? 0);
  });
  children.push(child);
  return child;
}

let stopping = false;
function stop(code: number): void {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (!c.killed) c.kill("SIGINT");
  setTimeout(() => process.exit(code), 1500).unref();
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

const mode = process.argv.includes("--prod") ? "start" : "dev";
const studioDir = path.join(root, "studio");
if (!fs.existsSync(path.join(studioDir, "node_modules"))) {
  console.warn("[studio] studio/node_modules missing — run `pnpm install` at the repo root first");
}
run("api", process.execPath, ["--import", "tsx", path.join(root, "src/studio/server.ts")], root);
const nextBin = path.join(studioDir, "node_modules", ".bin", "next");
run("web", nextBin, [mode, "-H", "127.0.0.1", "-p", webPort], studioDir);
console.log(`[studio] open http://localhost:${webPort}`);
