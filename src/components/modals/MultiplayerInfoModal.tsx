import type { MultiplayerInfoContext } from "../../context/ModalContext";

/** One way to play, explained in at most three plain points. */
interface InfoSection { title: string; points: readonly [string, string?, string?] }

const SECTIONS = {
  oneVsOne: {
    title: "Play 1v1",
    points: [
      "You play a random opponent who is online now: someone within one rank of you if one is waiting, otherwise anyone.",
      "You both get the same questions. The higher score wins; on a tie, the faster time wins.",
      "Your points are added to your profile. A rematch or a game switch needs your opponent to accept.",
    ],
  },
  friends: {
    title: "Play with a friend",
    points: [
      "Open a private room for 2 to 4 players and share its 6-digit code, or enter a friend's code.",
      "The host picks the game, starts it once everyone is in, and can switch games at any time.",
      "Just for fun: private rooms never add points to profiles.",
    ],
  },
  generate: {
    title: "Generate a code",
    points: [
      "You're the host. Pick how many players the room is for (2 to 4, within what the game allows).",
      "Share the 6-digit code with your friends; each of them enters it to take a seat.",
      "You start the game once everyone is in. Private rooms don't add points to profiles.",
    ],
  },
  enter: {
    title: "Enter a code",
    points: [
      "Type the 6-digit code a friend shared to join their room.",
      "Wait in the lobby until the host starts the game.",
      "You can leave the room at any time.",
    ],
  },
  hostLobby: {
    title: "You're the host",
    points: [
      "Share the code; seats fill as friends join. You can change the game or the number of players here.",
      "Start the game when enough players are seated and everyone is online.",
      "Close room ends it for everyone. Private rooms don't add points to profiles.",
    ],
  },
  guestLobby: {
    title: "You're a guest",
    points: [
      "The host picks the game and the number of players, and starts when everyone is in.",
      "You can leave at any time; your seat opens up for someone else.",
      "Private rooms don't add points to profiles.",
    ],
  },
  hostMatch: {
    title: "You're the host",
    points: [
      "Change game switches everyone to a new game right away, even in the middle of a round.",
      "Stop match takes everyone back to the lobby. After a round you can play again, change game or close the room.",
      "The scoreboard is just for the room: private matches add no points to profiles.",
    ],
  },
  guestMatch: {
    title: "You're a guest",
    points: [
      "Everyone plays the same questions. The best score wins; on equal scores, the faster time wins.",
      "The host runs the room: they can switch the game at any time, even mid-round, or stop the match.",
      "You can leave at any time. Private matches add no points to profiles.",
    ],
  },
} satisfies Record<string, InfoSection>;

type SectionId = keyof typeof SECTIONS;

/** What the Multiplayer card's (i) explains, per screen it was pressed on. */
const CONTEXTS: Record<MultiplayerInfoContext, { title: string; sections: SectionId[] }> = {
  choice: { title: "Multiplayer", sections: ["oneVsOne", "friends"] },
  friendMenu: { title: "Play with a friend", sections: ["generate", "enter"] },
  friendEnter: { title: "Join a friend's room", sections: ["enter"] },
  hostLobby: { title: "Your room", sections: ["hostLobby"] },
  guestLobby: { title: "Your friend's room", sections: ["guestLobby"] },
  match: { title: "Play 1v1", sections: ["oneVsOne"] },
  hostMatch: { title: "Private match", sections: ["hostMatch"] },
  guestMatch: { title: "Private match", sections: ["guestMatch"] },
};

// eslint-disable-next-line react-refresh/only-export-components
export const multiplayerInfoTitle = (context: MultiplayerInfoContext = "choice") => CONTEXTS[context].title;

/** "How multiplayer works", tailored to where the player is: numbered points per way to play
 *  (a heading above each one only when the screen offers more than one). Mirrors InstructionsModal. */
export default function MultiplayerInfoModal({ context = "choice", onClose }: { context?: MultiplayerInfoContext; onClose: () => void }) {
  const { sections } = CONTEXTS[context];
  const many = sections.length > 1;

  return (
    <div className="instr-stack">
      {sections.map((id) => {
        const s: InfoSection = SECTIONS[id];
        return (
          <section key={id} className="instr-section" aria-label={s.title}>
            {many && <h4 className="instr-head">{s.title}</h4>}
            <div className="instr-rules">
              {s.points.map((t, i) => t && (
                <div key={i} className="instr-rule">
                  <span className="instr-rule-n">{i + 1}</span>
                  <p className="instr-rule-t">{t}</p>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <button className="modal-primary-btn" style={{ height: 46 }} onClick={onClose}>
        Got it
      </button>
    </div>
  );
}
