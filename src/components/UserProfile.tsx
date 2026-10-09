import { useRef, useState } from "react";
import copy from "copy-to-clipboard";
import { showErrorAlert } from "../utils/Alerts";
import { useSelector, useDispatch } from "react-redux";
import type { RootState, AppDispatch } from "../store";
import { logout, updateProfilePhoto, updateUsername } from "../store/userSlice";
import { apiFetch } from "../utils/Api";
import { isBanPayload } from "../utils/ban";
import { USERNAME_FORMAT, nameNoteSlot, useNameCheck } from "../utils/nameCheck";
import { PhotoPrepError, prepareProfilePhoto } from "../utils/imagePrep";
import { AnimatePresence, motion } from "framer-motion";
import SwapText from "./motion/SwapText";
import SegmentedTabs from "./motion/SegmentedTabs";
import { BACKEND_URL } from "../configurations/backend";
import defaultAvatar from "../assets/default.png";
import FriendsPanel from "./FriendsPanel";

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

function UserProfile() {
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useSelector((state: RootState) => state.user);

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
  const [isEditing, setIsEditing] = useState(false);
  const [tempUsername, setTempUsername] = useState(user?.username || "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [idCopied, setIdCopied] = useState(false);
  const idCopyTimer = useRef<number | null>(null);
  const savedTimer = useRef<number | null>(null);
  const usernameInputRef = useRef<HTMLInputElement | null>(null);

  // Display names don't need to be unique — the public ID keeps players
  // distinct. The format is checked here; the server also moderates the name
  // (live via useNameCheck while editing, and again on save).
  const validateUsername = (username: string) => USERNAME_FORMAT.test(username);
  const nameNote = useNameCheck(tempUsername, isEditing && tempUsername !== (user?.username || ""));

  const copyPlayerId = () => {
    if (!user?.id) return;
    copy(user.id);
    setIdCopied(true);
    if (idCopyTimer.current) window.clearTimeout(idCopyTimer.current);
    idCopyTimer.current = window.setTimeout(() => setIdCopied(false), 1600);
  };

  const handleSave = async () => {
    if (!validateUsername(tempUsername)) {
      showErrorAlert(
        "Username must be 3-20 characters using letters, numbers or underscores.",
        "Invalid Username"
      );
      return;
    }
    if (user?.username === tempUsername) {
      setIsEditing(false);
      return;
    }

    // Optimistic: reflect the new name instantly and reconcile with the
    // backend in the background, reverting if it rejects the change.
    const previousUsername = user?.username || "";
    dispatch(updateUsername(tempUsername));
    setIsEditing(false);
    setSaveState("saving");

    try {
      const response = await apiFetch(`${BACKEND_URL}/update-profile/`, {
        method: "POST",
        body: JSON.stringify({ username: tempUsername }),
      });
      const data = await response.json();

      // The third strike bans the account: apiFetch has already reported the 403 and the ban
      // screen takes over, so there is nothing to revert or alert here.
      if (response.status === 403 && isBanPayload(data)) {
        setSaveState("idle");
        return;
      }

      if (data.error) {
        dispatch(updateUsername(previousUsername));
        setTempUsername(previousUsername);
        setSaveState("idle");
        // The name never changed — reopen the editor on the original value,
        // focused, once the error alert is dismissed.
        setIsEditing(true);
        await showErrorAlert(data.error, "Username change failed");
        usernameInputRef.current?.focus();
      } else {
        setSaveState("saved");
        if (savedTimer.current) window.clearTimeout(savedTimer.current);
        savedTimer.current = window.setTimeout(() => setSaveState("idle"), 1600);
      }
    } catch {
      dispatch(updateUsername(previousUsername));
      setTempUsername(previousUsername);
      setSaveState("idle");
      setIsEditing(true);
      await showErrorAlert("Could not reach the server. Please try again.", "Username change failed");
      usernameInputRef.current?.focus();
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingPhoto(true);
    try {
      let photo: Blob;
      try {
        photo = await prepareProfilePhoto(file);
      } catch (err) {
        showErrorAlert(err instanceof PhotoPrepError ? err.message : "Photo upload failed", "Upload Error");
        return;
      }
      const formData = new FormData();
      formData.append("profile_photo", photo, "photo.jpg");

      const response = await apiFetch(`${BACKEND_URL}/update-profile/`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => null);
      if (response.ok && typeof data?.user?.profile_photo === "string") {
        // The server's normalized photo, not a local preview — what /me/ will return after reload.
        dispatch(updateProfilePhoto(data.user.profile_photo));
      } else if (response.status === 403 && isBanPayload(data)) {
        // apiFetch already reported the ban (same as the username path).
        return;
      } else if (data?.code === "photo_rejected") {
        showErrorAlert(data.error, "Photo not allowed");
      } else if (data?.code === "moderation_unavailable") {
        showErrorAlert(data.error, "Try again later");
      } else {
        showErrorAlert(data?.error || "Photo upload failed", "Upload Error");
      }
    } finally {
      setUploadingPhoto(false);
      e.target.value = "";
    }
  };

  // ---- Your data: download everything we hold, or delete the account (GDPR export / erasure) ----
  const [showDelete, setShowDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteWord, setDeleteWord] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const handleExport = async () => {
    try {
      const res = await apiFetch(`${BACKEND_URL}/account/export/`);
      if (!res.ok) throw new Error(`export ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "swish-quest-my-data.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Data export failed:", err);
      showErrorAlert("We couldn't prepare your data. Please try again in a moment.", "Download failed");
    }
  };

  const handleDelete = async () => {
    if (deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      const res = await apiFetch(`${BACKEND_URL}/account/delete/`, {
        method: "POST",
        body: JSON.stringify({ password: deletePassword, confirm: deleteWord }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(data.error || "We couldn't delete your account. Please try again.");
        return;
      }
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      dispatch(logout());
    } catch (err) {
      console.error("Account deletion failed:", err);
      setDeleteError("Unable to contact the server. Please try again later.");
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleRemovePhoto = async () => {
    try {
      const res = await apiFetch(`${BACKEND_URL}/account/remove-photo/`, { method: "POST" });
      if (!res.ok) throw new Error(`remove-photo ${res.status}`);
      dispatch(updateProfilePhoto(null));
    } catch (err) {
      console.error("Photo removal failed:", err);
      showErrorAlert("We couldn't remove your photo. Please try again.", "Something went wrong");
    }
  };

  const handleLogout = async () => {
    const refreshToken = localStorage.getItem("refreshToken");
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");

    const res = await fetch(`${BACKEND_URL}/logout/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: refreshToken }),
    });
    const data = await res.json();

    if (data.error) {
      showErrorAlert(data.error, "Unable to Log Out!");
    } else {
      setIsLoading(true);
      setTimeout(() => {
        dispatch(logout());
        setIsLoading(false);
      }, 1200);
    }
  };

  if (isLoading) {
    return (
      <div className="profile-wrap" style={{ minHeight: 280, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="loader" />
      </div>
    );
  }

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

      {view === "friends" ? (
        <div className="profile-view-body">
          <FriendsPanel />
        </div>
      ) : (
        <div className="profile-view-body">
          {/* Header: avatar + welcome */}
          <div className="profile-head">
            <div className="profile-avatar">
              <AnimatePresence mode="wait">
                <motion.img
                  key={user?.profile_photo || "default"}
                  src={user?.profile_photo || defaultAvatar.src}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = defaultAvatar.src; }}
                  alt="Profile"
                  initial={{ opacity: 0, scale: 1.06 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  style={{ imageOrientation: "from-image" as any }}
                />
              </AnimatePresence>

              <AnimatePresence>
                {uploadingPhoto && (
                  <motion.div
                    className="profile-avatar-loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <span className="loader" style={{ width: 26, height: 26, borderWidth: 3 }} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <h2 className="font-display profile-welcome">
              Welcome, {user?.username}
              {user?.id && <span className="tnum" style={{ display: "block", fontSize: 13, fontWeight: 400, color: "var(--muted)" }}>#{user.id}</span>}
            </h2>

            <label htmlFor="photo-upload" className="profile-photo-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
              Change photo
            </label>
            <input id="photo-upload" type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoUpload} />
            {user?.profile_photo && (
              <button type="button" className="profile-data-btn" onClick={handleRemovePhoto}>Remove photo</button>
            )}
          </div>

          {/* Username + email */}
          <div className="profile-fields">
            <div className="profile-field">
              <div className="profile-field-label">
                <span>Username</span>
                <button
                  className="profile-edit-btn"
                  disabled={saveState === "saving"}
                  onClick={() => {
                    if (isEditing) handleSave();
                    else {
                      setTempUsername(user?.username || "");
                      setIsEditing(true);
                      usernameInputRef.current?.focus();
                    }
                  }}
                >
                  <SwapText swapKey={isEditing ? "confirm" : saveState}>
                    {isEditing ? "Confirm" : saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Change"}
                  </SwapText>
                </button>
              </div>
              <input
                ref={usernameInputRef}
                type="text"
                maxLength={20}
                readOnly={!isEditing}
                value={isEditing ? tempUsername : user?.username || ""}
                onChange={(e) => setTempUsername(e.target.value)}
                className={`profile-input profile-username${
                  (isEditing && tempUsername !== (user?.username || "")) || saveState !== "idle" ? " is-active" : ""
                }`}
              />
              <div className="profile-name-note-slot" role="status" aria-live="polite">
                <AnimatePresence initial={false}>
                  {nameNote && (
                    <motion.div
                      key="profile-name-note"
                      style={{ overflow: "hidden" }}
                      variants={nameNoteSlot}
                      initial="hidden"
                      animate="visible"
                      exit="hidden"
                    >
                      <p className="profile-name-note"><SwapText>{nameNote}</SwapText></p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="profile-field">
              <div className="profile-field-label">
                <span>Player ID</span>
                <button className="profile-edit-btn" onClick={copyPlayerId}>
                  <SwapText>{idCopied ? "Copied!" : "Copy"}</SwapText>
                </button>
              </div>
              <div className="profile-value profile-value--muted tnum" title="Your permanent ID.">
                #{user?.id}
              </div>
            </div>

            <div className="profile-field">
              <div className="profile-field-label"><span>Email</span></div>
              <div className="profile-value profile-value--muted">{user?.email}</div>
            </div>
          </div>

          {/* Points & rank — a single compact pill instead of two stacked cards */}
          <div className="profile-stats">
            <div className="profile-stat">
              <span className="profile-stat-lbl">Points</span>
              <span className="font-display tnum profile-stat-num">{user?.points}</span>
            </div>
            <span className="profile-stat-divider" aria-hidden="true" />
            <div className="profile-stat">
              <span className="profile-stat-lbl">Rank</span>
              <span className="font-display tnum profile-stat-num">{user?.rank}</span>
            </div>
          </div>

          {/* Logout — centered, same style as the Share feedback button */}
          <div className="profile-logout">
            <button className="feedback-band-btn" onClick={handleLogout}>Log out</button>
          </div>

          <div className="profile-data">
            <button type="button" className="profile-data-btn" onClick={handleExport}>Download my data</button>
            <span aria-hidden="true">·</span>
            <button type="button" className="profile-data-btn profile-data-btn--danger" onClick={() => setShowDelete((v) => !v)}>
              Delete account
            </button>
          </div>
          {showDelete && (
            <div className="profile-delete">
              <p>This permanently deletes your account, points, friends and game history. It can&apos;t be undone.</p>
              <input
                type="password"
                className="modal-input"
                aria-label="Password"
                placeholder="Password (leave empty if you signed up with Google)"
                autoComplete="current-password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
              />
              <input
                className="modal-input"
                aria-label="Type DELETE to confirm"
                placeholder="Type DELETE to confirm"
                autoComplete="off"
                value={deleteWord}
                onChange={(e) => setDeleteWord(e.target.value)}
              />
              {deleteError && <p className="auth-error" role="alert">{deleteError}</p>}
              <button
                type="button"
                className="feedback-band-btn"
                disabled={deleteWord !== "DELETE" || deleteBusy}
                onClick={handleDelete}
              >
                {deleteBusy ? "Deleting…" : "Delete my account"}
              </button>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

export default UserProfile;
