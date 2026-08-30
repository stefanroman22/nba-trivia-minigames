import { useRef, useState } from "react";
import copy from "copy-to-clipboard";
import { showErrorAlert } from "../utils/Alerts";
import { useSelector, useDispatch } from "react-redux";
import type { RootState, AppDispatch } from "../store";
import { logout, updateProfilePhoto, updateUsername } from "../store/userSlice";
import { apiFetch } from "../utils/Api";
import socket from "../socket";
import { AnimatePresence, motion } from "framer-motion";
import { BACKEND_URL } from "../configurations/backend";
import defaultAvatar from "../assets/default.png";

function UserProfile() {
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useSelector((state: RootState) => state.user);

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
  // distinct — so the only rule is the format.
  const validateUsername = (username: string) => /^[A-Za-z0-9_]{3,20}$/.test(username);

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

      if (data.error) {
        dispatch(updateUsername(previousUsername));
        setTempUsername(previousUsername);
        setSaveState("idle");
        showErrorAlert(data.error, "Username change failed");
      } else {
        setSaveState("saved");
        if (savedTimer.current) window.clearTimeout(savedTimer.current);
        savedTimer.current = window.setTimeout(() => setSaveState("idle"), 1600);
      }
    } catch {
      dispatch(updateUsername(previousUsername));
      setTempUsername(previousUsername);
      setSaveState("idle");
      showErrorAlert("Could not reach the server. Please try again.", "Username change failed");
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingPhoto(true);
    const formData = new FormData();
    formData.append("profile_photo", file);

    try {
      const response = await apiFetch(`${BACKEND_URL}/update-profile/`, {
        method: "POST",
        body: formData,
      });
      if (response.ok) {
        const previewURL = URL.createObjectURL(file);
        dispatch(updateProfilePhoto(previewURL));
      } else {
        const errorData = await response.json();
        showErrorAlert(errorData.error || "Photo upload failed", "Upload Error");
      }
    } finally {
      setUploadingPhoto(false);
      e.target.value = "";
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
      if (socket.connected) socket.emit("setUserInfo", null);
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
      {/* Header: avatar + welcome */}
      <div className="profile-head">
        <div className="profile-avatar">
          <AnimatePresence mode="wait">
            <motion.img
              key={user?.profile_photo || "default"}
              src={user?.profile_photo || defaultAvatar}
              onError={(e) => { (e.currentTarget as HTMLImageElement).src = defaultAvatar; }}
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
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={isEditing ? "confirm" : saveState}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  style={{ display: "inline-block" }}
                >
                  {isEditing ? "Confirm" : saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Change"}
                </motion.span>
              </AnimatePresence>
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
            }${saveState === "saved" ? " is-saved" : ""}`}
          />
        </div>

        <div className="profile-field">
          <div className="profile-field-label">
            <span>Player ID</span>
            <button className="profile-edit-btn" onClick={copyPlayerId}>
              {idCopied ? "Copied!" : "Copy"}
            </button>
          </div>
          <div className="profile-value profile-value--muted tnum" title="Your permanent ID — share it so friends can tell you apart from same-named players.">
            #{user?.id}
          </div>
        </div>

        <div className="profile-field">
          <div className="profile-field-label"><span>Email</span></div>
          <div className="profile-value profile-value--muted">{user?.email}</div>
        </div>
      </div>

      {/* Points & rank */}
      <div className="profile-stats">
        <div className="profile-stat">
          <span className="profile-stat-lbl">Points</span>
          <span className="font-display tnum profile-stat-num">{user?.points}</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-lbl">Rank</span>
          <span className="font-display tnum profile-stat-num">{user?.rank}</span>
        </div>
      </div>

      {/* Logout — centered, same style as the Share feedback button */}
      <div className="profile-logout">
        <button className="feedback-band-btn" onClick={handleLogout}>Log out</button>
      </div>
    </motion.div>
  );
}

export default UserProfile;
