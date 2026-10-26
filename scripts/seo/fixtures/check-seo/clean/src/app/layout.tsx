import type { Metadata } from "next";
import type { ReactNode } from "react";

// No canonical here: every child would inherit "/" (alternates are per page).
export const metadata: Metadata = {
  metadataBase: new URL("https://example.com"),
  title: { default: "Fixture Site — trivia", template: "%s | Fixture Site" },
  description: "A fixture site for check:seo, with a default title and description for the home page.",
  openGraph: { type: "website", siteName: "Fixture Site", title: "Fixture Site", description: "Fixture" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
