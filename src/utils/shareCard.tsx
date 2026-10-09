import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { SITE_HOST, SITE_NAME } from "../configurations/site";

/** Share-card format for Open Graph / Twitter (1200x630 PNG). */
export const shareCardSize = { width: 1200, height: 630 };
export const shareCardContentType = "image/png";

/** The branded card: logo + name, a large title, a subtitle and the address, on the site's dark/orange theme.
 *  Runs at build time (static routes) on Node, so the logo is read from public/. */
export async function renderShareCard(title: string, subtitle: string) {
  const logo = await readFile(path.join(process.cwd(), "public", "icon-192.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between",
          padding: "64px 72px", background: "linear-gradient(135deg, #101010 0%, #1c1c1e 60%, #2a160a 100%)", color: "#f5f3ef",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <img src={logoSrc} width={84} height={84} alt="" />
          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase" }}>{SITE_NAME}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: title.length > 24 ? 72 : 88, fontWeight: 800, lineHeight: 1.05, maxWidth: 1000 }}>{title}</div>
          <div style={{ fontSize: 34, color: "#c9c6c0", maxWidth: 980, lineHeight: 1.3 }}>{subtitle}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", width: 120, height: 8, borderRadius: 4, background: "#ff6a1a" }} />
          <div style={{ fontSize: 30, color: "#ff8a3d", fontWeight: 700 }}>{SITE_HOST}</div>
        </div>
      </div>
    ),
    shareCardSize,
  );
}
