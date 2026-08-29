// src/store/userSlice.ts
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

type User = {
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
};

const initialState: UserState = {
  isLoggedIn: false,
  user: null,
  authChecked: false,
};

const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {
    login: (state, action: PayloadAction<User>) => {
      state.isLoggedIn = true;
      state.user = action.payload;
      state.authChecked = true;
    },
    logout: (state) => {
      state.isLoggedIn = false;
      state.user = null;
      state.authChecked = true;
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

export const { login, logout, updatePoints, updateRank, updateUsername, updateProfilePhoto } = userSlice.actions;
export default userSlice.reducer;
