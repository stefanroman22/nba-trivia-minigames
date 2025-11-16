// src/store/userSlice.ts
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

type User = {
  username: string;
  email: string;
  rank: string;
  points: number;
  profile_photo: string | null; // match backend
};

type UserState = {
  isLoggedIn: boolean;
  user: User | null;
};

const initialState: UserState = {
  isLoggedIn: false,
  user: null,
};

const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {
    login: (state, action: PayloadAction<User>) => {
      state.isLoggedIn = true;
      state.user = action.payload;
    },
    logout: (state) => {
      state.isLoggedIn = false;
      state.user = null;
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
