"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LEGAL } from "../configurations/legal";
import { nameNoteSlot } from "../utils/nameCheck";
import { Button } from "./ui";
import SwapText from "./motion/SwapText";
import "../styles/PhotoAgePrompt.css";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Inline birth month + year form in the photo flow (landing card, Profile settings), shown when an
 *  account of unknown age tries to add its first photo (hooks/useProfilePhoto `agePrompt`). Only
 *  whether the player is 16+ is kept, never the date. Glides open and closed (shared slot motion). */
export default function PhotoAgePrompt({
  open,
  saving,
  error,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  saving: boolean;
  error: string;
  onSubmit: (month: string, year: string) => void;
  onCancel: () => void;
}) {
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 101 }, (_, i) => thisYear - i);

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div key="photo-age" style={{ overflow: "hidden" }} variants={nameNoteSlot} initial="hidden" animate="visible" exit="hidden">
          <form
            className="photo-age"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit(month, year);
            }}
          >
            <p className="photo-age-title">How old are you?</p>
            <p className="photo-age-copy">
              Profile photos are for players aged {LEGAL.photoMinimumAge} and over. Pick your birth month and year; we
              keep only whether you&apos;re {LEGAL.photoMinimumAge}+, never the date, and you can set it once.
            </p>
            <div className="auth-consent-row">
              <select className="modal-input" aria-label="Birth month" value={month} disabled={saving} onChange={(e) => setMonth(e.target.value)}>
                <option value="" disabled>Birth month</option>
                {MONTHS.map((name, i) => <option key={name} value={String(i + 1)}>{name}</option>)}
              </select>
              <select className="modal-input" aria-label="Birth year" value={year} disabled={saving} onChange={(e) => setYear(e.target.value)}>
                <option value="" disabled>Birth year</option>
                {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
              </select>
            </div>
            <AnimatePresence initial={false}>
              {error && (
                <motion.div key="photo-age-error" style={{ overflow: "hidden" }} variants={nameNoteSlot} initial="hidden" animate="visible" exit="hidden">
                  <p className="auth-error photo-age-error" role="alert"><SwapText>{error}</SwapText></p>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="photo-age-actions">
              <button type="button" className="photo-age-cancel" onClick={onCancel} disabled={saving}>Cancel</button>
              <Button type="submit" size="sm" disabled={saving}>
                <SwapText reserveWidth={["Continue", "Saving…"]}>{saving ? "Saving…" : "Continue"}</SwapText>
              </Button>
            </div>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
