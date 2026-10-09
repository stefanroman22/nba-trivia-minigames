import type { Metadata } from "next";
import Landpage from "../views/Landpage";
import JsonLd from "../components/JsonLd";
import { visibleGames } from "../utils/GameUtils";
import {
  LOGO_URL, ORG_ID, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL, WEBSITE_ID,
} from "../configurations/site";

// Root-only canonical: a layout-level one would be inherited by every page.
// A child openGraph replaces the layout's wholesale, so the shared fields are repeated.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US", url: "/", title: SITE_TITLE, description: SITE_DESCRIPTION },
};

/** Site name, organisation and the list of games (Search Central: site names, Organization, ItemList).
 *  The old brand lives only in Organization.alternateName (never WebSite.alternateName). */
const homeJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite", "@id": WEBSITE_ID, name: SITE_NAME, alternateName: ["SwishQuest", "swishquest.com"],
      url: `${SITE_URL}/`, description: SITE_DESCRIPTION, inLanguage: "en", publisher: { "@id": ORG_ID },
    },
    {
      "@type": "Organization", "@id": ORG_ID, name: SITE_NAME,
      url: `${SITE_URL}/`, logo: { "@type": "ImageObject", url: LOGO_URL, width: 512, height: 512 },
    },
    {
      "@type": "ItemList", name: `${SITE_NAME} games`,
      itemListElement: visibleGames
        .filter((g) => g.id !== "coming-soon")
        .map((g, i) => ({ "@type": "ListItem", position: i + 1, name: g.name, url: `${SITE_URL}${g.urlPath}` })),
    },
  ],
};

export default function HomePage() {
  return (
    <>
      <JsonLd data={homeJsonLd} />
      <Landpage />
    </>
  );
}
