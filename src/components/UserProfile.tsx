import { useRef, useState } from "react";
import copy from "copy-to-clipboard";
import { useSelector } from "react-redux";
import type { RootState } from "../store";
import { AnimatePresence, motion } from "framer-motion";
import SegmentedTabs from "./motion/SegmentedTabs";
import AutoHeight from "./motion/AutoHeight";
import CopyIcon from "./motion/CopyIcon";
import defaultAvatar from "../assets/default.png";
import FriendsPanel from "./FriendsPanel";
import { useProfilePhoto } from "../hooks/useProfilePhoto";
import { useNavigate } from "../hooks/useNavigate";

type ProfileView = "friends" | "profile";

const PROFILE_VIEWS: { key: ProfileView; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "friends", label: "Friends" },
];

// The view the player last picked, remembered per browser; Profile until they pick Friends.
const VIEW_KEY = "sq:profile-view";
const readView = (): ProfileView => {
  try {
    return localStorage.getItem(VIEW_KEY) === "friends" ? "friends" : "profile";
  } catch {
    return "profile";
  }
};

/**
 * The landing page's profile card: an at-a-glance identity (photo, name, player ID, points, rank)
 * and the Friends panel. Account settings (username, email, data export, deletion, log out) live
 * on the Profile settings page (/profile), reached from here or the header's profile menu.
 */
function UserProfile() {
  const { user } = useSelector((state: RootState) => state.user);
  const navigate = useNavigate();
  const { uploadingPhoto, handlePhotoUpload } = useProfilePhoto();

  // Profile is the default view; a player who switches to Friends keeps it on later visits.
  // Read before the first paint (this card only renders in the browser, once a user is signed in),
  // so a Friends pick doesn't flash Profile first.
  const [view, setViewState] = useState<ProfileView>(readView);
  const setView = (next: ProfileView) => {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // storage blocked: the choice just isn't remembered
    }
  };

  const [idCopied, setIdCopied] = useState(false);
  const idCopyTimer = useRef<number | null>(null);
  const copyPlayerId = () => {
    if (!user?.id) return;
    copy(String(user.id));
    setIdCopied(true);
    if (idCopyTimer.current) window.clearTimeout(idCopyTimer.current);
    idCopyTimer.current = window.setTimeout(() => setIdCopied(false), 1600);
  };

  return (
    <motion.div
      className="profile-wrap"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <SegmentedTabs
        className="profile-view-toggle"
        itemClassName="profile-view-btn"
        aria-label="Profile section"
        options={PROFILE_VIEWS}
        value={view}
        onChange={setView}
      />

      {/* The card glides to the new height when the view (or a Friends sub-tab) changes. */}
      <AutoHeight>
      {view === "friends" ? (
        <div className="profile-view-body">
          <FriendsPanel />
        </div>
      ) : (
        <div className="profile-view-body pc">
          {/* Identity on the left (photo, name, player ID), points and rank on the right,
              Profile settings under the photo. */}
          <div className="pc-grid">
            <div className="pc-avatar">
              <AnimatePresence mode="wait">
                <motion.img
                  key={user?.profile_photo || "default"}
                  src={user?.profile_photo || defaultAvatar.src}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = defaultAvatar.src; }}
                  alt=""
                  initial={{ opacity: 0, scale: 1.06 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                />
              </AnimatePresence>
              {uploadingPhoto && (
                <span className="pc-avatar-busy"><span className="loader" style={{ width: 22, height: 22, borderWidth: 3 }} /></span>
              )}
              <label htmlFor="photo-upload" className="pc-photo-btn" aria-label="Change photo" title="Change photo">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
              </label>
              <input id="photo-upload" type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoUpload} />
            </div>

            <div className="pc-meta">
              <h2 className="font-display pc-name">{user?.username}</h2>
              <span className="pc-id tnum">
                #{user?.id}
                <button
                  type="button"
                  className={`pc-copy${idCopied ? " is-copied" : ""}`}
                  onClick={copyPlayerId}
                  aria-label={idCopied ? "Player ID copied" : "Copy player ID"}
                  title={idCopied ? "Copied" : "Copy player ID"}
                >
                  <CopyIcon copied={idCopied} />
                </button>
              </span>
            </div>

            <div className="pc-stats">
              <div className="pc-stat">
                <span className="pc-stat-lbl">Points</span>
                <span className="font-display tnum pc-stat-num is-brand">{user?.points}</span>
              </div>
              <span className="pc-stat-divider" aria-hidden="true" />
              <div className="pc-stat">
                <span className="pc-stat-lbl">Rank</span>
                <span className="font-display pc-stat-num">{user?.rank}</span>
              </div>
            </div>

            <button type="button" className="pc-settings" onClick={() => navigate("/profile")}>
              Profile settings
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </div>
        </div>
      )}
      </AutoHeight>
    </motion.div>
  );
}

export default UserProfile;
