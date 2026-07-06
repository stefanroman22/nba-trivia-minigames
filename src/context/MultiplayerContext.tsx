/**
 * Global multiplayer state, mounted once above the routes so a dropped
 * player can reconnect from anywhere and be dropped straight back into their
 * match. All socket wiring lives here; screens consume `useMultiplayer()`.
 *
 * Covers both flavours of online play:
 *   • random 1v1 matchmaking ("Play online")
 *   • private friend rooms — the host generates a 6-digit code, friends join
 *     with it, and the match starts the moment the room is full.
 *
 * The reducer is a small state machine whose `phase` drives the UI:
 *   idle → searching → intro → playing → waiting → results        (matchmaking)
 *   idle → lobby → intro → playing → waiting → results            (friend room)
 * with `ended` (someone left) and per-stage notices/proposals layered on top.
 *
 * Mirrors the event contract in multiplayer_server/src/index.js.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef,
  type ReactNode,
} from "react";
import { useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import socket from "../socket";
import type { RootState } from "../store";
import type { Game, GameData, PlayerInfo } from "../types/types";

type Phase = "idle" | "searching" | "lobby" | "intro" | "playing" | "waiting" | "results" | "ended";
type Outcome = "win" | "loss" | "tie";
type NoticeKind = "info" | "warn" | "error";
type RoomType = "match" | "friend";

export interface Notice { kind: NoticeKind; text: string }
export interface Proposal {
  role: "mine" | "theirs";
  type: "again" | "switch";
  gameId?: string;
  gameName?: string;
  fromName?: string;
}

/** Live per-opponent presence/progress, keyed by public id (username fallback). */
export interface OppStatus {
  online: boolean;
  done: boolean;
  progress: { round: number; total: number } | null;
}

/** Stable key for a player: public id when present, else display name. */
// eslint-disable-next-line react-refresh/only-export-components
export const playerKey = (p?: { id?: string | null; username?: string } | null): string =>
  p?.id || p?.username || "?";

export interface LobbyMember extends PlayerInfo {
  id: string;
  username: string;
  isHost: boolean;
  online: boolean;
}

export interface FriendLobby {
  code: number;
  game: Game;
  capacity: number;
  hostUid: string;
  members: LobbyMember[];
}

/** One row of the final scoreboard (any room size), best score first. */
export interface Standing extends PlayerInfo {
  score: number;
  /** Play time in ms — breaks equal-score ties (fastest wins); null if unknown. */
  elapsedMs?: number | null;
  outcome: Outcome;
}

export interface MpState {
  phase: Phase;
  code: number | null;
  game: Game | null;
  roomType: RoomType | null;
  roomSize: number;
  role: "host" | "guest" | null;
  /** Where you stand in the matchmaking queue while searching. */
  queueInfo: { inQueue: number; position: number } | null;
  opponents: PlayerInfo[];
  oppStatus: Record<string, OppStatus>;
  lobby: FriendLobby | null;
  /** Pending friend-room request, so buttons can show progress. */
  friendPending: "create" | "join" | null;
  /** Inline error for the code-entry UI (kept out of the global notice bar). */
  friendJoinError: string | null;
  gameData: GameData[] | null;
  /** Authoritative turn-engine state broadcast by the server (contract #6);
   *  shape is game-specific — renderers cast it. Null outside turn games. */
  turnState: unknown;
  introElapsed: boolean;
  yourScore: number | null;
  opponentScore: number | null;
  standings: Standing[] | null;
  outcome: Outcome | null;
  proposal: Proposal | null;
  ended: { reason: string; message: string } | null;
  notice: Notice | null;
  error: string | null;
}

const initial: MpState = {
  phase: "idle", code: null, game: null, roomType: null, roomSize: 2, role: null,
  queueInfo: null, opponents: [], oppStatus: {}, lobby: null, friendPending: null,
  friendJoinError: null, gameData: null, turnState: null, introElapsed: false, yourScore: null,
  opponentScore: null, standings: null, outcome: null, proposal: null, ended: null,
  notice: null, error: null,
};

interface LobbySnapshot {
  code: number;
  game: Game;
  capacity: number;
  hostUid: string;
  members: LobbyMember[];
}

type Action =
  | { t: "FIND"; game: Game }
  | { t: "SEARCHING"; inQueue?: number; position?: number }
  | { t: "NO_OPPONENT" }
  | { t: "MATCH_FOUND"; code: number; role: "host" | "guest"; opponents: PlayerInfo[]; game: Game; roomType: RoomType; roomSize: number }
  | { t: "ROUND_DATA"; gameData: GameData[]; game?: Game }
  | { t: "TURN_STATE"; state: unknown }
  | { t: "ROUND_ERROR"; message: string }
  | { t: "INTRO_ELAPSED" }
  | { t: "SUBMITTED"; score: number }
  | { t: "MATCH_RESULT"; yourScore: number; opponentScore: number; outcome: Outcome; standings: Standing[] | null }
  | { t: "MATCH_RESTART"; game?: Game }
  | { t: "FRIEND_CREATE" }
  | { t: "FRIEND_JOIN" }
  | { t: "FRIEND_LOBBY"; lobby: LobbySnapshot }
  | { t: "FRIEND_CANCELLED"; message: string }
  | { t: "FRIEND_ERROR"; message: string }
  | { t: "FRIEND_JOIN_ERROR"; message: string }
  | { t: "FRIEND_JOIN_RESET" }
  | { t: "OPP_PROGRESS"; id?: string; username?: string; round: number; total: number }
  | { t: "OPP_FINISHED"; id?: string; username?: string }
  | { t: "OPP_DISCONNECTED"; id?: string; username?: string }
  | { t: "OPP_RECONNECTED"; id?: string; username?: string }
  | { t: "OPP_LEFT"; message: string }
  | { t: "PROPOSAL_PENDING"; ptype: "again" | "switch"; gameId?: string; gameName?: string }
  | { t: "PROPOSAL_RECEIVED"; ptype: "again" | "switch"; gameId?: string; gameName?: string; fromName?: string }
  | { t: "PROPOSAL_PROGRESS"; username?: string }
  | { t: "PROPOSAL_DECLINED"; username?: string }
  | { t: "PROPOSAL_CANCELLED" }
  | { t: "PROPOSAL_TIMEOUT" }
  | { t: "RESUME"; snapshot: ResumeSnapshot }
  | { t: "NOTICE"; notice: Notice }
  | { t: "CLEAR_NOTICE" }
  | { t: "RESET" };

interface ResumeSnapshot {
  code: number;
  game: Game;
  phase: "lobby" | "intro" | "playing" | "waiting" | "results";
  roomType: RoomType;
  roomSize: number;
  role: "host" | "guest";
  opponents: (PlayerInfo & { online?: boolean; finished?: boolean })[];
  gameData: GameData[] | null;
  yourScore: number | null;
  opponentScore: number | null;
  standings: Standing[] | null;
  lobby: LobbySnapshot | null;
  proposal: null | {
    role: "mine" | "theirs"; type: "again" | "switch"; gameId?: string; gameName?: string; fromName?: string;
  };
}

const firstOppName = (s: MpState) => s.opponents[0]?.username || "Opponent";

/** Fresh presence map for a set of opponents (everyone online, nobody done). */
function freshStatus(opponents: PlayerInfo[]): Record<string, OppStatus> {
  return Object.fromEntries(
    opponents.map((o) => [playerKey(o), { online: true, done: false, progress: null }])
  );
}

function patchStatus(
  state: MpState, who: { id?: string; username?: string }, patch: Partial<OppStatus>
): Record<string, OppStatus> {
  // Older servers may omit the id — fall back to name, then the single opponent.
  const key = who.id || who.username || playerKey(state.opponents[0]);
  if (key === "?") return state.oppStatus;
  const prev = state.oppStatus[key] || { online: true, done: false, progress: null };
  return { ...state.oppStatus, [key]: { ...prev, ...patch } };
}

function reducer(state: MpState, a: Action): MpState {
  switch (a.t) {
    case "FIND":
      return { ...initial, phase: "searching", game: a.game };
    case "SEARCHING": {
      const queueInfo = a.inQueue != null && a.position != null ? { inQueue: a.inQueue, position: a.position } : state.queueInfo;
      if (state.phase === "searching" && queueInfo === state.queueInfo) return state;
      return { ...state, phase: "searching", queueInfo };
    }
    case "NO_OPPONENT":
      return { ...initial, notice: { kind: "warn", text: "No opponent found. Please try again." } };
    case "MATCH_FOUND":
      return {
        ...initial, phase: "intro", code: a.code, role: a.role, opponents: a.opponents,
        oppStatus: freshStatus(a.opponents), game: a.game, roomType: a.roomType,
        roomSize: a.roomSize, introElapsed: false,
      };
    case "ROUND_DATA": {
      const play = state.phase === "intro" && state.introElapsed;
      return { ...state, gameData: a.gameData, game: a.game ?? state.game, error: null, phase: play ? "playing" : state.phase };
    }
    case "TURN_STATE":
      return { ...state, turnState: a.state };
    case "ROUND_ERROR":
      return { ...state, error: a.message };
    case "INTRO_ELAPSED":
      if (state.phase !== "intro") return state;
      return state.gameData ? { ...state, phase: "playing" } : { ...state, introElapsed: true };
    case "SUBMITTED":
      // Only a live game can move to waiting — a stale onGameEnd (e.g. a
      // renderer's delayed end firing after leave/opponent-left) is ignored.
      if (state.phase !== "playing") return state;
      return { ...state, phase: "waiting", yourScore: a.score };
    case "MATCH_RESULT":
      return { ...state, phase: "results", yourScore: a.yourScore, opponentScore: a.opponentScore, outcome: a.outcome, standings: a.standings };
    case "MATCH_RESTART":
      return {
        ...state, phase: "intro", introElapsed: false, gameData: null, turnState: null,
        game: a.game ?? state.game,
        yourScore: null, opponentScore: null, outcome: null, standings: null, proposal: null,
        ended: null, oppStatus: freshStatus(state.opponents), error: null,
      };
    case "FRIEND_CREATE":
      return { ...state, friendPending: "create", friendJoinError: null };
    case "FRIEND_JOIN":
      return { ...state, friendPending: "join", friendJoinError: null };
    case "FRIEND_LOBBY": {
      // Covers created / joined / lobby-changed — the snapshot is authoritative.
      // Screens derive "am I the host?" by comparing hostUid to their own user.
      const l = a.lobby;
      return {
        ...initial, phase: "lobby", code: l.code, game: l.game,
        roomType: "friend", roomSize: l.members.length,
        lobby: { code: l.code, game: l.game, capacity: l.capacity, hostUid: l.hostUid, members: l.members },
        notice: state.notice,
      };
    }
    case "FRIEND_CANCELLED":
      return { ...initial, notice: { kind: "warn", text: a.message } };
    case "FRIEND_ERROR":
      return { ...state, friendPending: null, notice: { kind: "error", text: a.message } };
    case "FRIEND_JOIN_ERROR":
      return { ...state, friendPending: null, friendJoinError: a.message };
    case "FRIEND_JOIN_RESET":
      return state.friendJoinError ? { ...state, friendJoinError: null } : state;
    case "OPP_PROGRESS":
      return { ...state, oppStatus: patchStatus(state, a, { progress: { round: a.round, total: a.total } }) };
    case "OPP_FINISHED":
      return { ...state, oppStatus: patchStatus(state, a, { done: true }) };
    case "OPP_DISCONNECTED": {
      const name = a.username || firstOppName(state);
      return {
        ...state,
        oppStatus: patchStatus(state, a, { online: false }),
        notice: { kind: "warn", text: `${name} disconnected. Trying to reconnect...` },
      };
    }
    case "OPP_RECONNECTED": {
      const name = a.username || firstOppName(state);
      return {
        ...state,
        oppStatus: patchStatus(state, a, { online: true }),
        notice: { kind: "info", text: `${name} reconnected.` },
      };
    }
    case "OPP_LEFT":
      return { ...state, phase: "ended", proposal: null, ended: { reason: "left", message: a.message } };
    case "PROPOSAL_PENDING":
      return { ...state, proposal: { role: "mine", type: a.ptype, gameId: a.gameId, gameName: a.gameName } };
    case "PROPOSAL_RECEIVED":
      return { ...state, proposal: { role: "theirs", type: a.ptype, gameId: a.gameId, gameName: a.gameName, fromName: a.fromName } };
    case "PROPOSAL_PROGRESS":
      return { ...state, notice: { kind: "info", text: `${a.username || "A player"} is in — waiting for the rest...` } };
    case "PROPOSAL_DECLINED":
      return { ...state, proposal: null, notice: { kind: "warn", text: `${a.username || firstOppName(state)} declined.` } };
    case "PROPOSAL_CANCELLED":
      return { ...state, proposal: null, notice: { kind: "info", text: "The request was withdrawn." } };
    case "PROPOSAL_TIMEOUT":
      return { ...state, proposal: null, notice: { kind: "warn", text: "No response in time." } };
    case "NOTICE":
      return { ...state, notice: a.notice };
    case "CLEAR_NOTICE":
      return { ...state, notice: null };
    case "RESUME": {
      const s = a.snapshot;
      const phase: Phase = s.phase;
      if (phase === "lobby" && s.lobby) {
        return {
          ...initial, phase: "lobby", code: s.code, game: s.game, roomType: "friend",
          roomSize: s.lobby.members.length, role: s.role, lobby: s.lobby,
        };
      }
      const outcome: Outcome | null =
        phase === "results" && s.yourScore != null && s.opponentScore != null
          ? (s.yourScore > s.opponentScore ? "win" : s.yourScore < s.opponentScore ? "loss" : "tie")
          : null;
      const anyOffline = s.opponents.some((o) => o.online === false);
      return {
        ...initial, phase, code: s.code, game: s.game, roomType: s.roomType ?? "match",
        roomSize: s.roomSize ?? 2, role: s.role,
        opponents: s.opponents.map((o) => ({
          id: o.id, username: o.username, profile_photo: o.profile_photo, rank: o.rank, points: o.points,
        })),
        oppStatus: Object.fromEntries(s.opponents.map((o) => [
          playerKey(o),
          { online: o.online !== false, done: !!o.finished, progress: null },
        ])),
        gameData: s.gameData, introElapsed: false,
        yourScore: s.yourScore, opponentScore: s.opponentScore,
        standings: s.standings ?? null, outcome,
        proposal: s.proposal ? { ...s.proposal } : null,
        notice: anyOffline ? { kind: "warn", text: "A player disconnected. Trying to reconnect..." } : null,
      };
    }
    case "RESET":
      return initial;
    default:
      return state;
  }
}

/** Strip non-serializable fields (functions) before sending a game over the socket. */
function serializeGame(g: Game) {
  return {
    id: g.id, name: g.name, tag: g.tag, urlPath: g.urlPath,
    pointsPerCorrect: g.pointsPerCorrect, maxPoints: g.maxPoints, backgroundImage: g.backgroundImage,
  };
}

interface MultiplayerContextValue {
  mp: MpState;
  findMatch: (game: Game) => void;
  cancelFind: () => void;
  createFriendRoom: (game: Game) => void;
  joinFriendRoom: (code: string) => void;
  changeFriendGame: (game: Game) => void;
  resetFriendJoinError: () => void;
  submitScore: (score: number, elapsedMs?: number) => void;
  /** Turn-engine games: send a player action to the authoritative server. */
  sendTurnAction: (action: unknown) => void;
  proposeAgain: () => void;
  proposeSwitch: (game: Game) => void;
  respondProposal: (accept: boolean) => void;
  cancelProposal: () => void;
  leaveMatch: () => void;
  reportProgress: (round: number, total: number) => void;
  clearNotice: () => void;
}

const Ctx = createContext<MultiplayerContextValue | null>(null);

export function MultiplayerProvider({ children }: { children: ReactNode }) {
  const [mp, dispatch] = useReducer(reducer, initial);
  const { user } = useSelector((state: RootState) => state.user);
  const navigate = useNavigate();
  const location = useLocation();

  // Keep the latest values reachable from socket handlers without re-binding them.
  const codeRef = useRef<number | null>(null);
  const userRef = useRef(user);
  codeRef.current = mp.code;
  userRef.current = user;

  // ---- Identity: (re)announce ourselves on every connect so the server can
  //      resume an in-flight match. ----
  useEffect(() => {
    const identify = () => {
      if (userRef.current) socket.emit("identify", { user: userRef.current });
    };
    identify();
    socket.on("connect", identify);
    return () => { socket.off("connect", identify); };
  }, [user]);

  // ---- Socket event wiring ----
  useEffect(() => {
    const on = {
      searching: (d: { inQueue?: number; position?: number } = {}) =>
        dispatch({ t: "SEARCHING", inQueue: d?.inQueue, position: d?.position }),
      noOpponent: () => dispatch({ t: "NO_OPPONENT" }),
      matchFound: (d: { code: number; role: "host" | "guest"; opponent: PlayerInfo; opponents?: PlayerInfo[]; game: Game; roomType?: RoomType; roomSize?: number }) =>
        dispatch({
          t: "MATCH_FOUND", code: d.code, role: d.role, game: d.game,
          opponents: d.opponents ?? [d.opponent],
          roomType: d.roomType ?? "match", roomSize: d.roomSize ?? 2,
        }),
      roundData: (d: { gameData: GameData[]; game?: Game }) =>
        dispatch({ t: "ROUND_DATA", gameData: d.gameData, game: d.game }),
      turnState: (d: { code: number; game?: string; state: unknown }) =>
        dispatch({ t: "TURN_STATE", state: d?.state ?? null }),
      roundDataError: (d: { message: string }) => dispatch({ t: "ROUND_ERROR", message: d.message }),
      waitingForOpponent: () => {/* local SUBMITTED already moved us to waiting */},
      matchResult: (d: { yourScore: number; opponentScore: number; outcome: Outcome; standings?: Standing[] }) =>
        dispatch({ t: "MATCH_RESULT", yourScore: d.yourScore, opponentScore: d.opponentScore, outcome: d.outcome, standings: d.standings ?? null }),
      matchRestart: (d: { game?: Game }) => dispatch({ t: "MATCH_RESTART", game: d.game }),
      friendRoomCreated: (d: LobbySnapshot) => dispatch({ t: "FRIEND_LOBBY", lobby: d }),
      friendRoomJoined: (d: LobbySnapshot) => dispatch({ t: "FRIEND_LOBBY", lobby: d }),
      friendLobbyUpdate: (d: LobbySnapshot) => dispatch({ t: "FRIEND_LOBBY", lobby: d }),
      friendRoomCancelled: (d: { message: string }) =>
        dispatch({ t: "FRIEND_CANCELLED", message: d?.message || "The room was closed." }),
      friendError: (d: { message: string }) =>
        dispatch({ t: "FRIEND_ERROR", message: d?.message || "Something went wrong. Please try again." }),
      friendJoinError: (d: { message: string }) =>
        dispatch({ t: "FRIEND_JOIN_ERROR", message: d?.message || "Couldn't join that room." }),
      opponentProgress: (d: { id?: string; username?: string; round: number; total: number }) =>
        dispatch({ t: "OPP_PROGRESS", id: d.id, username: d.username, round: d.round, total: d.total }),
      opponentFinished: (d: { id?: string; username?: string } = {}) => dispatch({ t: "OPP_FINISHED", id: d?.id, username: d?.username }),
      opponentDisconnected: (d: { id?: string; username?: string } = {}) => dispatch({ t: "OPP_DISCONNECTED", id: d?.id, username: d?.username }),
      opponentReconnected: (d: { id?: string; username?: string } = {}) => dispatch({ t: "OPP_RECONNECTED", id: d?.id, username: d?.username }),
      opponentLeft: (d: { message: string }) => dispatch({ t: "OPP_LEFT", message: d?.message || "Your opponent left." }),
      proposalPending: (d: { type: "again" | "switch"; gameId?: string; gameName?: string }) =>
        dispatch({ t: "PROPOSAL_PENDING", ptype: d.type, gameId: d.gameId, gameName: d.gameName }),
      proposalReceived: (d: { type: "again" | "switch"; gameId?: string; gameName?: string; fromName?: string }) =>
        dispatch({ t: "PROPOSAL_RECEIVED", ptype: d.type, gameId: d.gameId, gameName: d.gameName, fromName: d.fromName }),
      proposalProgress: (d: { username?: string } = {}) => dispatch({ t: "PROPOSAL_PROGRESS", username: d?.username }),
      proposalDeclined: (d: { username?: string } = {}) => dispatch({ t: "PROPOSAL_DECLINED", username: d?.username }),
      proposalCancelled: () => dispatch({ t: "PROPOSAL_CANCELLED" }),
      proposalTimeout: () => dispatch({ t: "PROPOSAL_TIMEOUT" }),
      resumeMatch: (snapshot: ResumeSnapshot) => dispatch({ t: "RESUME", snapshot }),
      matchError: (d: { message: string }) => dispatch({ t: "NOTICE", notice: { kind: "error", text: d.message } }),
    };
    (Object.entries(on)).forEach(([evt, fn]) => socket.on(evt, fn as (...args: unknown[]) => void));
    return () => { Object.entries(on).forEach(([evt, fn]) => socket.off(evt, fn as (...args: unknown[]) => void)); };
  }, []);

  // ---- VS intro timer: hold the matchup card briefly, then start once data is in. ----
  useEffect(() => {
    if (mp.phase !== "intro" || mp.introElapsed) return;
    const id = setTimeout(() => dispatch({ t: "INTRO_ELAPSED" }), 2600);
    return () => clearTimeout(id);
  }, [mp.phase, mp.introElapsed, mp.code]);

  // ---- Auto-clear transient info/warn notices. ----
  useEffect(() => {
    if (!mp.notice || mp.notice.kind === "error") return;
    const id = setTimeout(() => dispatch({ t: "CLEAR_NOTICE" }), 3200);
    return () => clearTimeout(id);
  }, [mp.notice]);

  // ---- Make sure the right game page is mounted once a room is live (also
  //      moves everyone when the host changes the lobby's game). ----
  useEffect(() => {
    if (mp.phase === "idle" || !mp.game?.urlPath) return;
    if (location.pathname !== mp.game.urlPath) {
      navigate(mp.game.urlPath, { state: { id: mp.game.id } });
    }
  }, [mp.code, mp.phase, mp.game, location.pathname, navigate]);

  const guardOnline = useCallback((): boolean => {
    if (!userRef.current) {
      dispatch({ t: "NOTICE", notice: { kind: "error", text: "You need to be signed in to play online." } });
      return false;
    }
    if (!socket.connected) {
      dispatch({ t: "NOTICE", notice: { kind: "error", text: "Can't reach the game server. Please try again." } });
      return false;
    }
    return true;
  }, []);

  const findMatch = useCallback((game: Game) => {
    if (!guardOnline()) return;
    dispatch({ t: "FIND", game });
    socket.emit("identify", { user: userRef.current });
    socket.emit("findMatch", { game: serializeGame(game) });
  }, [guardOnline]);

  const createFriendRoom = useCallback((game: Game) => {
    if (!guardOnline()) return;
    dispatch({ t: "FRIEND_CREATE" });
    socket.emit("identify", { user: userRef.current });
    socket.emit("createFriendRoom", { game: serializeGame(game) });
  }, [guardOnline]);

  const joinFriendRoom = useCallback((code: string) => {
    if (!guardOnline()) return;
    dispatch({ t: "FRIEND_JOIN" });
    socket.emit("identify", { user: userRef.current });
    socket.emit("joinFriendRoom", { code });
  }, [guardOnline]);

  const changeFriendGame = useCallback((game: Game) => {
    socket.emit("changeFriendGame", { code: codeRef.current, game: serializeGame(game) });
  }, []);

  const resetFriendJoinError = useCallback(() => dispatch({ t: "FRIEND_JOIN_RESET" }), []);
  const cancelFind = useCallback(() => { socket.emit("cancelFind"); dispatch({ t: "RESET" }); }, []);
  const submitScore = useCallback((score: number, elapsedMs?: number) => {
    if (codeRef.current == null) return; // no live room — stale end-call, drop it
    dispatch({ t: "SUBMITTED", score });
    socket.emit("submitScore", { code: codeRef.current, score, elapsedMs });
  }, []);
  const sendTurnAction = useCallback((action: unknown) => {
    if (codeRef.current == null) return; // no live room — drop the action
    socket.emit("turnAction", { code: codeRef.current, action });
  }, []);
  const proposeAgain = useCallback(() => socket.emit("proposeAgain", { code: codeRef.current }), []);
  const proposeSwitch = useCallback((game: Game) => socket.emit("proposeSwitch", { code: codeRef.current, game: serializeGame(game) }), []);
  const respondProposal = useCallback((accept: boolean) => socket.emit("respondProposal", { code: codeRef.current, accept }), []);
  const cancelProposal = useCallback(() => socket.emit("cancelProposal", { code: codeRef.current }), []);
  const reportProgress = useCallback((round: number, total: number) => socket.emit("reportProgress", { code: codeRef.current, round, total }), []);
  const leaveMatch = useCallback(() => {
    socket.emit("leaveMatch", { code: codeRef.current });
    dispatch({ t: "RESET" });
  }, []);
  const clearNotice = useCallback(() => dispatch({ t: "CLEAR_NOTICE" }), []);

  const value = useMemo<MultiplayerContextValue>(() => ({
    mp, findMatch, cancelFind, createFriendRoom, joinFriendRoom, changeFriendGame,
    resetFriendJoinError, submitScore, sendTurnAction, proposeAgain, proposeSwitch,
    respondProposal, cancelProposal, leaveMatch, reportProgress, clearNotice,
  }), [mp, findMatch, cancelFind, createFriendRoom, joinFriendRoom, changeFriendGame, resetFriendJoinError, submitScore, sendTurnAction, proposeAgain, proposeSwitch, respondProposal, cancelProposal, leaveMatch, reportProgress, clearNotice]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMultiplayer(): MultiplayerContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMultiplayer must be used within MultiplayerProvider");
  return ctx;
}
