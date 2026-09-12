import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The browser-side code keeps its Vite-era VITE_* variable names so that
  // .env.production, scripts/dev-env.mjs, the QA protocol, the docs and the
  // Vercel project env all stay valid. Next only exposes NEXT_PUBLIC_* to the
  // client on its own, so the three the browser reads are inlined here.
  env: {
    VITE_BACKEND_URL: process.env.VITE_BACKEND_URL,
    VITE_SOCKET_URL: process.env.VITE_SOCKET_URL,
    VITE_DATA_BASE: process.env.VITE_DATA_BASE,
    VITE_QUESTIONS_BASE: process.env.VITE_QUESTIONS_BASE,
  },
  // The Vite entry never wrapped the app in <StrictMode>; keeping it off keeps
  // dev-only double effects (socket identify, the /me/ session check) from
  // showing up as new behaviour.
  reactStrictMode: false,
  // `next dev` would otherwise inject a managed "agent rules" block into
  // CLAUDE.md on every run; that file is hand-curated (it points at the
  // bundled Next docs itself).
  agentRules: false,
};

export default nextConfig;
