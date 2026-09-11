import path from "node:path";
import type { NextConfig } from "next";

const api = process.env.STUDIO_API_URL ?? "http://127.0.0.1:4747";

const config: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: path.resolve(__dirname, "..") },
  typescript: { tsconfigPath: "./tsconfig.json" },
  async rewrites() {
    // JSON only; media and events are fetched from the API origin directly (no proxy buffering).
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
};

export default config;
