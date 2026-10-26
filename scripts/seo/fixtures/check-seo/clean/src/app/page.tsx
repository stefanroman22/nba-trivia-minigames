import type { Metadata } from "next";

// Root-only canonical; title and description come from the root layout's default.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", title: "Fixture Site", description: "Fixture" },
};

const data = { "@context": "https://schema.org", url: "https://example.com/" };

export default function HomePage() {
  return JSON.stringify(data);
}
