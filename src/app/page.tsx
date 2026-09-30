import type { Metadata } from "next";
import Landpage from "../views/Landpage";
import JsonLd from "../components/JsonLd";
import logo from "../assets/basketballLogo.webp";
import { SITE_NAME, SITE_URL, SITE_DESCRIPTION } from "../configurations/site";

// Root-only: a layout-level canonical/url would be inherited by /admin, /coming-soon and 404.
// A child openGraph replaces the layout's wholesale, so repeat the shared fields here.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    type: "website", siteName: SITE_NAME, locale: "en_US", url: "/",
    title: SITE_NAME, description: SITE_DESCRIPTION,
    images: [{ url: logo.src, width: logo.width, height: logo.height, alt: SITE_NAME }],
  },
};

const websiteJsonLd = {
  "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: `${SITE_URL}/`, description: SITE_DESCRIPTION,
  publisher: { "@type": "Organization", name: SITE_NAME, url: `${SITE_URL}/`, logo: `${SITE_URL}${logo.src}` },
};

export default function HomePage() {
  return (
    <>
      <JsonLd data={websiteJsonLd} />
      <Landpage />
    </>
  );
}
