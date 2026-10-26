import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description: "About the fixture site and the people behind it.",
  alternates: { canonical: "/about" },
};

export default function Page() {
  return "fixture";
}
