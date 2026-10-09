import type { Game } from "../types/types";

/** Server-rendered "How to play" for a game page, from the same intro and rules as the in-game modal, so
 *  search engines and AI assistants can read what the game is without opening it. */
export default function GameGuide({ game }: { game: Game }) {
  if (!game.rules?.length) return null;
  return (
    <section className="game-guide" aria-labelledby="game-guide-title">
      <h2 id="game-guide-title" className="font-display">How to play {game.name}</h2>
      {game.intro && <p className="game-guide-intro">{game.intro}</p>}
      <ol className="game-guide-rules">
        {game.rules.map((rule) => <li key={rule.n}>{rule.t}</li>)}
      </ol>
    </section>
  );
}
