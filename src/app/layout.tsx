import type { Metadata } from "next";
import type { ReactNode } from "react";
// Global stylesheets, in the order the Vite entry loaded them.
import "../styles/theme.css";
import "../styles/ui.css";
import "../index.css";
import "../App.css";
// These two rode along in the old main bundle on every route (App.tsx imported
// Landpage statically) and LandPage.css owns the shared .app-shell/.page shell
// rules that the game and admin pages rely on. Next would otherwise scope them
// to "/" and a direct load of /wordle would lose the page padding.
import "../styles/LandPage.css";
import "../styles/GlobalStyles.css";
import logo from "../assets/basketballLogo.webp";
import Providers from "./providers";

export const metadata: Metadata = {
  title: { default: "HOOPS24", template: "%s | HOOPS24" },
  description:
    "Free daily NBA trivia minigames — wordle, grids, guess-the-player and more. Play solo or online, score points and climb the leaderboard.",
  icons: { icon: [{ url: logo.src, type: "image/webp" }] },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // LandPage.css sets `html { scroll-behavior: smooth }`; the attribute lets
    // Next suspend that while it scrolls to the top on a route change, so the
    // jump doesn't animate through the page fade.
    // suppressHydrationWarning: browser extensions stamp attributes onto <html>
    // before React hydrates (e.g. data-mdv-preview-bridge="ready"), which React
    // would otherwise report as a server/client mismatch. It only silences
    // attribute diffs on this one element, not its children.
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        {/* Fonts are self-hosted (public/fonts/ + @font-face in theme.css).
            Preload the critical faces so the hero text (LCP) paints in its final
            font instead of repainting on a late swap.
            Russo One latin is inlined in the CSS (LCP font); no preload needed. */}
        <link rel="preload" href="/fonts/chakra-petch-400-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/chakra-petch-700-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <div id="root">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
