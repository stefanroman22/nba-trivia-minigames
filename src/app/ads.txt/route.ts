import { ADSENSE_PUB_ID } from "../../configurations/ads";

// NEXT_PUBLIC_ADSENSE_PUB_ID is inlined at build time. A static public/ads.txt cannot be conditional, so this
// route serves the file only once a publisher id is set (unset now: 404).

/** /ads.txt: the single AdSense line (IAB ads.txt format), or 404 while no publisher id is configured. */
export function GET() {
  if (!ADSENSE_PUB_ID) return new Response("Not found", { status: 404 });
  const pub = ADSENSE_PUB_ID.replace(/^ca-/, "");
  return new Response(`google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
