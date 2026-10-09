// Points a guest has scored in this browser tab. Display only: guests have no account to credit,
// so the total lives in sessionStorage (gone with the tab, empty in a fresh or private window) and
// is never sent anywhere. GuestPanel shows it; MiniGame adds to it when a guest finishes a game.
const KEY = "sq:guest-points";

export function readGuestPoints(): number {
  try {
    return Math.max(0, Math.floor(Number(sessionStorage.getItem(KEY)) || 0));
  } catch {
    return 0; // storage blocked (private mode, previews): just no total
  }
}

export function addGuestPoints(points: number): void {
  if (!(points > 0)) return;
  try {
    sessionStorage.setItem(KEY, String(readGuestPoints() + Math.floor(points)));
  } catch {
    // storage blocked: the panel simply shows no total
  }
}
