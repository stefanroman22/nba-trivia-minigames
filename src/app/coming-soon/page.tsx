import type { Metadata } from "next";
import NoPageFound from "../../views/NoPageFound";

export const metadata: Metadata = { title: "Coming soon", robots: { index: false, follow: false } };

export default function ComingSoonPage() {
  return <NoPageFound />;
}
