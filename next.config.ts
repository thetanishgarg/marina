import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  devIndicators: false,
  // Pin the Turbopack root to this folder. The repo also contains nested apps
  // (marina-agent/, jarvis-lab/) with their own lockfiles, and a standalone
  // build leaves a second copy of `next` under .next/standalone — either can
  // make Turbopack pick the wrong root, panic with "Next.js package not found"
  // and send the browser into an endless reload loop in dev.
  turbopack: { root: __dirname },
  // Google Cloud Run / Docker builds set NEXT_OUTPUT=standalone to get a
  // self-contained server (.next/standalone/server.js). Vercel builds leave it
  // unset and keep the default output.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
