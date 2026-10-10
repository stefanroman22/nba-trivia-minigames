import type { Metadata } from "next";
import ProfileSettings from "../../views/ProfileSettings";

// A signed-in player's own settings: nothing to index.
export const metadata: Metadata = {
  title: "Profile settings",
  robots: { index: false, follow: false },
};

export default function ProfilePage() {
  return <ProfileSettings />;
}
