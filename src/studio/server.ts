import { serve } from "@hono/node-server";
import { loadEnv, repoRoot } from "../config/env.js";
import { openDb } from "../db/sqlite.js";
import { createApp, createStudioContext } from "./app.js";

loadEnv();
const port = Number(process.env.STUDIO_API_PORT ?? 4747);
const host = process.env.STUDIO_API_HOST ?? "127.0.0.1";
const webOrigin = process.env.STUDIO_WEB_ORIGIN ?? "http://localhost:3000";

const ctx = createStudioContext(openDb());
const boot = ctx.jobs.reconcile();
if (boot.orphaned.length)
  console.warn(`[studio] orphaned jobs reconciled: ${boot.orphaned.join(", ")}`);
const reaper = setInterval(() => {
  try {
    ctx.jobs.reconcile();
  } catch (err) {
    console.error("[studio] reconcile failed", err);
  }
}, 30_000);
reaper.unref();

const app = createApp(ctx, {
  origins: [webOrigin, "http://127.0.0.1:3000", "http://localhost:3000"],
});
const server = serve({ fetch: app.fetch, port, hostname: host }, () => {
  console.log(`[studio] API listening on http://${host}:${port} (root ${repoRoot()})`);
});

const shutdown = () => {
  clearInterval(reaper);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
