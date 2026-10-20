// src/store/userSlice.ts
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { BanInfo } from "../utils/ban";
import { applyReceipt, type AwardReceipt, type PendingRankUp, type RankProgress } from "./award";

export type { AwardReceipt, PendingRankUp, RankProgress } from "./award";

export type User = {
  /** Permanent public player id (#K7F3QD) — usernames may repeat. */
  id: string;
  username: string;
  email: string;
  rank: string;
  points: number;
  profile_photo: string | null; // match backend
  /** UI hint only — admin API endpoints re-check is_staff server-side. */
  is_admin?: boolean;
  /** Progression (users.ranks / trivia.awarding); absent on a cached /me/ from before it existed. */
  rank_progress?: RankProgress;
  streak_days?: number;
  streak_best?: number;
  streak_freezes?: number;
  active_days?: number;
  founding_member?: boolean;
  /** "adult" (16+), "teen" or "" (not told yet); absent on a cached /me/ from before it was sent. */
  age_group?: string;
  /** The birth month and year the player gave (null until given); how many times they can still change it. */
  birth_month?: number | null;
  birth_year?: number | null;
  age_sets_left?: number;
};

type UserState = {
  isLoggedIn: boolean;
  user: User | null;
  /** True once the initial /me/ session check has resolved (either way). */
  authChecked: boolean;
  /** Set when the backend answered 403 `account_banned` (utils/ban.ts); BanNotice renders it.
   *  A ban is a session state, not a form state — the auth modal never owns it. */
  banned: BanInfo | null;
  /** A rank-up the player hasn't been shown yet; ModalHost opens the rank-up modal and clears it. */
  pendingRankUp: PendingRankUp | null;
};

const initialState: UserState = {
  isLoggedIn: false,
  user: null,
  authChecked: false,
  banned: null,
  pendingRankUp: null,
};

const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {
    login: (state, action: PayloadAction<User>) => {
      state.isLoggedIn = true;
      state.user = action.payload;
      state.authChecked = true;
      state.banned = null;
    },
    logout: (state) => {
      state.isLoggedIn = false;
      state.user = null;
      state.authChecked = true;
      state.banned = null;
      state.pendingRankUp = null;
    },
    /** The account is banned: drop the signed-in user and show the ban screen. Tokens and the
     *  cached user are cleared by the handler in app/providers.tsx before this runs. */
    accountBanned: (state, action: PayloadAction<BanInfo>) => {
      state.isLoggedIn = false;
      state.user = null;
      state.authChecked = true;
      state.banned = action.payload;
      state.pendingRankUp = null;
    },
    /** Optimistic restore from the cached /me/ payload (utils/session.ts) while the real
     *  check runs. Leaves `authChecked` false: only the server's answer settles it, and a
     *  check that has already resolved is never overwritten with cached data. */
    hydrateSession: (state, action: PayloadAction<User>) => {
      if (state.authChecked) return;
      state.isLoggedIn = true;
      state.user = action.payload;
    },
    updatePoints: (state, action: PayloadAction<number>) => {
      if (state.user) {
        state.user.points += action.payload;
      }
    },
    updateRank: (state, action: PayloadAction<string>) => {
      if (state.user) {
        state.user.rank = action.payload;
      }
    },
    /** Apply a credited play's receipt (store/award.ts): totals, rank, progress, streak, pending rank-up. */
    applyAward: (state, action: PayloadAction<AwardReceipt>) => {
      if (!state.user) return;
      const { user, rankUp } = applyReceipt(state.user, action.payload);
      state.user = user;
      if (rankUp) state.pendingRankUp = rankUp;
    },
    clearRankUp: (state) => {
      state.pendingRankUp = null;
    },
    updateUsername: (state, action: PayloadAction<string>) => {
      if (state.user) {
        state.user.username = action.payload;
      }
    },
    updateProfilePhoto: (state, action: PayloadAction<string | null>) => {
      if (state.user) {
        state.user.profile_photo = action.payload;
      }
    },
    /** The server's answer after a birth-date change: the age group, and the photo (gone when the new age is under 16). */
    updateAge: (state, action: PayloadAction<{ age_group: string; profile_photo: string | null; birth_month: number | null; birth_year: number | null; age_sets_left: number }>) => {
      if (state.user) {
        state.user.age_group = action.payload.age_group;
        state.user.profile_photo = action.payload.profile_photo;
        state.user.birth_month = action.payload.birth_month;
        state.user.birth_year = action.payload.birth_year;
        state.user.age_sets_left = action.payload.age_sets_left;
      }
    },
  },
});

export const { login, logout, accountBanned, hydrateSession, updatePoints, updateRank, applyAward, clearRankUp, updateUsername, updateProfilePhoto, updateAge } = userSlice.actions;
export default userSlice.reducer;
