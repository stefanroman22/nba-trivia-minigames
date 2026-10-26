import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `What the fixture site collects, why, and how to delete it.`,
  // A child openGraph replaces the layout's wholesale, so the shared fields are repeated.
  openGraph: { type: "website", url: "/privacy", title: "Privacy Policy", images: ["/opengraph-image"] },
};

export default function PrivacyPage() {
  return "Don't worry: nothing here.";
}
