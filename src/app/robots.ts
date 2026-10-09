import type { MetadataRoute } from "next";
import { SITE_URL } from "../configurations/site";

/** robots.txt (RFC 9309 / Google's robots spec). Production allows every crawler, AI assistants included:
 *  the site wants to be found and cited, and blocking Google-Extended would also drop Gemini grounding.
 *  /admin is disallowed (it is also noindex). Any non-production build (previews, local) disallows
 *  everything, so preview URLs never compete with swishquest.com. */
export default function robots(): MetadataRoute.Robots {
  if (process.env.VERCEL_ENV !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
