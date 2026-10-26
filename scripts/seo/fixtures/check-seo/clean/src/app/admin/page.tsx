import type { Metadata } from "next";

// robots.txt already disallows /admin; the meta tag keeps it out of indexes that ignore robots.txt.
export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return "admin";
}
