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
  // Six small stylesheets were render-blocking <link>s (Lighthouse: ~720 ms on mobile); inlined they arrive with the HTML.
  experimental: { inlineCss: true },
  // Baseline response headers. Deliberately no Content-Security-Policy yet (it needs a tested allow-list for
  // Google sign-in, the NBA image CDN and Vercel; see docs/legal/OPEN_ITEMS.md) and no Cross-Origin-Opener-Policy
  // (same-origin would break the Google sign-in popup).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
      {
        // Only https://swishquest.com may be indexed. The production aliases 301 there (vercel.json); this
        // covers everything else that serves the site (per-deployment URLs, the dev branch URL, previews).
        source: "/:path*",
        missing: [{ type: "host", value: "swishquest.com" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
    ];
  },
};

export default nextConfig;
