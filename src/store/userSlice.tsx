// src/store/userSlice.ts
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { BanInfo } from "../utils/ban";

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
};

type UserState = {
  isLoggedIn: boolean;
  user: User | null;
  /** True once the initial /me/ session check has resolved (either way). */
  authChecked: boolean;
  /** Set when the backend answered 403 `account_banned` (utils/ban.ts); BanNotice renders it.
   *  A ban is a session state, not a form state — the auth modal never owns it. */
  banned: BanInfo | null;
};

const initialState: UserState = {
  isLoggedIn: false,
  user: null,
  authChecked: false,
  banned: null,
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
    },
    /** The account is banned: drop the signed-in user and show the ban screen. Tokens and the
     *  cached user are cleared by the handler in app/providers.tsx before this runs. */
    accountBanned: (state, action: PayloadAction<BanInfo>) => {
      state.isLoggedIn = false;
      state.user = null;
      state.authChecked = true;
      state.banned = action.payload;
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
    updateUsername: (state, action: PayloadAction<string>) => {
      if (state.user) {
        state.user.username = action.payload;
      }
    },
    updateProfilePhoto: (state, action: PayloadAction<string>) => {
      if (state.user) {
        state.user.profile_photo = action.payload;
      }
    },
  },
});

export const { login, logout, accountBanned, hydrateSession, updatePoints, updateRank, updateUsername, updateProfilePhoto } = userSlice.actions;
export default userSlice.reducer;
