# multiplayer.md — archived notes (retain.mjs)

## archived 2026-11-15

- (20261014-1153) MP-GAME-wordle timed out (420 s, shot stays on the lobby): not judged, no repro; check whether the wordle online start stalls before filing.
- (20261014-1153) The tictactoe duel-banner hold (1800 ms in TicTacToe.tsx) is cut short by the context's MATCH_RESULT, which fires the moment the relay settles the board; draws on pairB-D show 0 ms.
