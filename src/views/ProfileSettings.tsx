"use client";
import { useRef, useState } from "react";
import copy from "copy-to-clipboard";
import { useDispatch, useSelector } from "react-redux";
import { AnimatePresence, motion } from "framer-motion";
import type { AppDispatch, RootState } from "../store";
import { logout, updateUsername } from "../store/userSlice";
import { apiFetch } from "../utils/Api";
import { isBanPayload } from "../utils/ban";
import { showErrorAlert } from "../utils/Alerts";
import { USERNAME_FORMAT, nameNoteSlot, useNameCheck } from "../utils/nameCheck";
import { BACKEND_URL } from "../configurations/backend";
import { useModal } from "../context/ModalContext";
import { useProfilePhoto } from "../hooks/useProfilePhoto";
import { useLogout } from "../hooks/useLogout";
import Navigation from "../components/Navigation";
import SwapText from "../components/motion/SwapText";
import { Button } from "../components/ui";
import defaultAvatar from "../assets/default.png";
import "../styles/ProfileSettings.css";

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

/**
 * Profile settings (/profile): everything about the account that doesn't belong on the landing
 * card — username, photo, email, the GDPR export and erasure, and log out. Reached from the
 * header's profile menu. The landing card keeps only the at-a-glance identity and stats.
 */
export default function ProfileSettings() {
  const dispatch = useDispatch<AppDispatch>();
  const { user, authChecked } = useSelector((state: RootState) => state.user);
  const { open } = useModal();
  const { uploadingPhoto, handlePhotoUpload, handleRemovePhoto } = useProfilePhoto();
  const { loggingOut, logOut } = useLogout();

  // ---- Username ----
  const [isEditing, setIsEditing] = useState(false);
  const [tempUsername, setTempUsername] = useState(user?.username || "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const savedTimer = useRef<number | null>(null);
  const usernameInputRef = useRef<HTMLInputElement | null>(null);
  const nameNote = useNameCheck(tempUsername, isEditing && tempUsername !== (user?.username || ""));

  const handleSave = async () => {
    if (!USERNAME_FORMAT.test(tempUsername)) {
      showErrorAlert("Username must be 3-20 characters using letters, numbers or underscores.", "Invalid Username");
      return;
    }
    if (user?.username === tempUsername) {
      setIsEditing(false);
      return;
    }
    // Optimistic: reflect the new name instantly, revert if the backend rejects it.
    const previousUsername = user?.username || "";
    dispatch(updateUsername(tempUsername));
    setIsEditing(false);
    setSaveState("saving");
    const revert = async (message: string) => {
      dispatch(updateUsername(previousUsername));
      setTempUsername(previousUsername);
      setSaveState("idle");
      setIsEditing(true);
      await showErrorAlert(message, "Username change failed");
      usernameInputRef.current?.focus();
    };
    try {
      const response = await apiFetch(`${BACKEND_URL}/update-profile/`, {
        method: "POST",
        body: JSON.stringify({ username: tempUsername }),
      });
      const data = await response.json();
      // The third strike bans the account: the ban screen takes over, nothing to revert.
      if (response.status === 403 && isBanPayload(data)) {
        setSaveState("idle");
        return;
      }
      if (data.error) {
        await revert(data.error);
      } else {
        setSaveState("saved");
        if (savedTimer.current) window.clearTimeout(savedTimer.current);
        savedTimer.current = window.setTimeout(() => setSaveState("idle"), 1600);
      }
    } catch {
      await revert("Could not reach the server. Please try again.");
    }
  };

  // ---- Player ID ----
  const [idCopied, setIdCopied] = useState(false);
  const idCopyTimer = useRef<number | null>(null);
  const copyPlayerId = () => {
    if (!user?.id) return;
    copy(String(user.id));
    setIdCopied(true);
    if (idCopyTimer.current) window.clearTimeout(idCopyTimer.current);
    idCopyTimer.current = window.setTimeout(() => setIdCopied(false), 1600);
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

  const body = () => {
    if (!user && !authChecked) {
      return <div className="ps-loading"><span className="loader" /></div>;
    }
    if (!user) {
      return (
        <section className="ps-card ps-empty">
          <h1 className="font-display ps-title">Profile settings</h1>
          <p className="ps-muted">Log in to see and manage your profile.</p>
          <Button onClick={() => open("login")}>Log in / Sign up</Button>
        </section>
      );
    }
    return (
      <motion.div
        className="ps-stack"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
      >
        {/* Identity + stats at a glance */}
        <section className="ps-card ps-hero">
          <div className="ps-avatar">
            <img
              src={user.profile_photo || defaultAvatar.src}
              onError={(e) => { (e.currentTarget as HTMLImageElement).src = defaultAvatar.src; }}
              alt=""
            />
            {uploadingPhoto && <span className="ps-avatar-busy"><span className="loader" style={{ width: 22, height: 22, borderWidth: 3 }} /></span>}
          </div>
          <div className="ps-hero-meta">
            <h1 className="font-display ps-title">{user.username}</h1>
            <span className="ps-muted tnum">#{user.id}</span>
          </div>
          <div className="ps-hero-stats">
            <span className="ps-stat"><span className="ps-stat-lbl">Points</span><span className="font-display tnum ps-stat-num is-brand">{user.points}</span></span>
            <span className="ps-stat"><span className="ps-stat-lbl">Rank</span><span className="font-display ps-stat-num">{user.rank}</span></span>
          </div>
        </section>

        {/* Account */}
        <section className="ps-card">
          <h2 className="ps-h2">Account</h2>
          <div className="ps-row">
            <div className="ps-row-main">
              <label className="ps-label" htmlFor="ps-username">Username</label>
              <input
                id="ps-username"
                ref={usernameInputRef}
                type="text"
                maxLength={20}
                readOnly={!isEditing}
                value={isEditing ? tempUsername : user.username || ""}
                onChange={(e) => setTempUsername(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && isEditing) void handleSave(); }}
                className={`ps-input${isEditing ? " is-editing" : ""}`}
              />
            </div>
            <button
              className="ps-link-btn"
              disabled={saveState === "saving"}
              onClick={() => {
                if (isEditing) void handleSave();
                else {
                  setTempUsername(user.username || "");
                  setIsEditing(true);
                  requestAnimationFrame(() => usernameInputRef.current?.focus());
                }
              }}
            >
              <SwapText swapKey={isEditing ? "confirm" : saveState}>
                {isEditing ? "Save" : saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Change"}
              </SwapText>
            </button>
          </div>
          <div className="ps-note-slot" role="status" aria-live="polite">
            <AnimatePresence initial={false}>
              {nameNote && (
                <motion.div key="ps-name-note" style={{ overflow: "hidden" }} variants={nameNoteSlot} initial="hidden" animate="visible" exit="hidden">
                  <p className="ps-note"><SwapText>{nameNote}</SwapText></p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="ps-row">
            <div className="ps-row-main">
              <span className="ps-label">Player ID</span>
              <span className="ps-value tnum">#{user.id}</span>
            </div>
            <button className="ps-link-btn" onClick={copyPlayerId}><SwapText>{idCopied ? "Copied!" : "Copy"}</SwapText></button>
          </div>

          <div className="ps-row">
            <div className="ps-row-main">
              <span className="ps-label">Email</span>
              <span className="ps-value ps-muted">{user.email}</span>
            </div>
          </div>

          <div className="ps-row">
            <div className="ps-row-main">
              <span className="ps-label">Profile photo</span>
              <span className="ps-value ps-muted">{user.profile_photo ? "Shown to other players" : "No photo"}</span>
            </div>
            <div className="ps-row-actions">
              <label htmlFor="ps-photo" className="ps-link-btn">Change</label>
              <input id="ps-photo" type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoUpload} />
              {user.profile_photo && <button className="ps-link-btn ps-link-btn--muted" onClick={handleRemovePhoto}>Remove</button>}
            </div>
          </div>
        </section>

        {/* Your data */}
        <section className="ps-card">
          <h2 className="ps-h2">Your data</h2>
          <div className="ps-row">
            <div className="ps-row-main">
              <span className="ps-value">Download my data</span>
              <span className="ps-muted ps-small">A copy of everything we hold about your account (JSON).</span>
            </div>
            <button className="ps-link-btn" onClick={handleExport}>Download</button>
          </div>
          <div className="ps-row">
            <div className="ps-row-main">
              <span className="ps-value">Delete account</span>
              <span className="ps-muted ps-small">Permanently removes your account, points, friends and game history.</span>
            </div>
            <button className="ps-link-btn ps-link-btn--danger" onClick={() => setShowDelete((v) => !v)} aria-expanded={showDelete}>
              <SwapText>{showDelete ? "Cancel" : "Delete"}</SwapText>
            </button>
          </div>
          <AnimatePresence initial={false}>
            {showDelete && (
              <motion.div
                key="ps-delete"
                className="ps-delete"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.28, ease: EASE }}
              >
                <div className="ps-delete-inner">
                  <p className="ps-muted ps-small">This can&apos;t be undone.</p>
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
                  <Button variant="danger" disabled={deleteWord !== "DELETE" || deleteBusy} onClick={handleDelete}>
                    {deleteBusy ? "Deleting…" : "Delete my account"}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <div className="ps-logout">
          <Button variant="secondary" disabled={loggingOut} onClick={logOut}>{loggingOut ? "Logging out…" : "Log out"}</Button>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="app-shell">
      <Navigation type="back" />
      <main className="page ps-page">{body()}</main>
    </div>
  );
}
