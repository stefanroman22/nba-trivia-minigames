
import type { Game } from "../types/types";
import Swal from "sweetalert2";
import { fetchGamePool, fetchWholePool } from "./pool";
import playoffSeriesBg from "../assets/Games Backrounds/playoff_series.jpg";
import guessLogoBg from "../assets/Games Backrounds/guess_the_logo.jpg";
import mvpBg from "../assets/Games Backrounds/mvp.jpg";
import startingFiveBg from "../assets/Games Backrounds/starting_five.jpg";
import wordleBg from "../assets/Games Backrounds/wordle.jpg";
import comingSoonBg from "../assets/Games Backrounds/coming_soon.jpg";
// Asset debt: the 12 scaffolded games reuse existing backgrounds until each
// gets its own art (find_connections/guess_player/basketball_positions were
// pre-assigned; the rest are spread across the remaining jpgs).
import thumb_fan_favorites from "../assets/Games Backrounds/thumb_fan_favorites.jpg";
import thumb_heatmap from "../assets/Games Backrounds/thumb_heatmap.jpg";
import thumb_connections from "../assets/Games Backrounds/thumb_connections.jpg";
import thumb_career_path from "../assets/Games Backrounds/thumb_career_path.jpg";
import thumb_nba_grid from "../assets/Games Backrounds/thumb_nba_grid.jpg";
import thumb_who_are_ya from "../assets/Games Backrounds/thumb_who_are_ya.jpg";
import thumb_tictactoe from "../assets/Games Backrounds/thumb_tictactoe.jpg";
import thumb_bingo from "../assets/Games Backrounds/thumb_bingo.jpg";
import thumb_contexto from "../assets/Games Backrounds/thumb_contexto.jpg";
import thumb_pack_five from "../assets/Games Backrounds/thumb_pack_five.jpg";
import thumb_superdraft from "../assets/Games Backrounds/thumb_superdraft.jpg";
import thumb_imposter from "../assets/Games Backrounds/thumb_imposter.jpg";

export const handleErrorDefault = (error: { title: string; message: string }) => {
  Swal.fire({
    icon: "error",
    title: error.title,
    html: `<p style="font-size: 0.95rem; margin-top: 0.5rem;">${error.message}</p>`,
    background: "#1c1c1e",
    color: "#f5f3ef",
    confirmButtonText: "Retry",
    customClass: {
      popup: "swal2-custom-popup",
      confirmButton: "swal2-custom-button",
    },
    buttonsStyling: false,
    allowOutsideClick: false,
    allowEscapeKey: true,
    iconColor: "#ff4d4d",
  });
};

export const fetchGameData = async (endpoint : string) => {
  try {
    const res = await fetch(endpoint, {
      method: "GET",
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    const data = await res.json();
    return { success: true, data: data.series || [] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    let error = {
      title: "Unable to connect to the server",
      message: "Please check your internet connection or try again later.",
    };

    if (err.message.includes("timed out")) {
      error = {
        title: "Server Timeout",
        message:
          "The NBA stats service is taking too long to respond. Please try again later.",
      };
    }

    return { success: false, error };
  }
};

export const games: Game[] = [
  {
    id: "series-winner",
    name: "Guess the Series Winner",
    tag: "PREDICT",
    description: "Pick the winner between two teams from a real NBA playoff series.",
    intro: "Travel back through historic NBA Finals and prove your memory of who lifted the trophy.",
    rules: [
      { n: "1", t: "Two teams from a real playoff series are shown each round." },
      { n: "2", t: "Tap the team you think won that series." },
      { n: "3", t: "5 rounds per game — 10 points for every correct call." },
    ],
    instruction: `
      <div class="space-y-2">
        <p>Travel back in time and test your knowledge of historic NBA playoff matchups.</p>
        <ul class="list-disc pl-5 text-sm text-left">
          <li><strong>Goal:</strong> Select the team that won the specific playoff series displayed.</li>
          <li><strong>Format:</strong> 5 rounds per game.</li>
          <li><strong>Reward:</strong> 10 points for every correct prediction.</li>
        </ul>
        <p class="text-xs italic mt-2">Press 'Play' to begin the challenge!</p>
      </div>
    `,
    loadingMessage: "Fetching playoff series...",
    backgroundImage: `url('${playoffSeriesBg}')`,
    urlPath: "/series-winner",
    pointsPerCorrect: 10,
    maxPoints: 50,
    fetchData: () => fetchGamePool("playoff", 5),
    handleError: handleErrorDefault,
  },
  {
    id: "name-logo",
    name: "Name the NBA Club",
    tag: "LOGOS",
    description: "Based on the logo, name the NBA team.",
    intro: "How sharp is your eye for NBA branding? Name the team behind the badge.",
    rules: [
      { n: "1", t: "A team logo appears each round." },
      { n: "2", t: "Type or pick the matching franchise." },
      { n: "3", t: "5 rounds — 10 points per correct answer." },
    ],
    instruction: `
      <div class="space-y-2">
        <p>How well do you know NBA branding? Identify the franchise belonging to the logo shown.</p>
        <ul class="list-disc pl-5 text-sm text-left">
          <li><strong>Goal:</strong> Correctly identify the team name associated with the logo.</li>
          <li><strong>Format:</strong> 5 rounds per game.</li>
          <li><strong>Reward:</strong> 10 points per correct answer.</li>
        </ul>
        <p class="text-xs italic mt-2">Press 'Play' to begin the challenge!</p>
      </div>
    `,
    loadingMessage: "Fetching logos...",
    backgroundImage: `url('${guessLogoBg}')`,
    urlPath: "/name-logo",
    pointsPerCorrect: 10,
    maxPoints: 50,
    fetchData: () => fetchGamePool("name-logo", 5),
    handleError: handleErrorDefault,
  },
  {
    id: "guess-mvps",
    name: "Guess the MVP",
    tag: "LEGENDS",
    description: "Name the MVP for a specific NBA season.",
    intro: "Legends are made in the regular season. Recall who dominated each year.",
    rules: [
      { n: "1", t: "A specific season is shown." },
      { n: "2", t: "Choose the player who won MVP that year." },
      { n: "3", t: "5 seasons — 10 points per correct answer." },
    ],
    instruction: `
      <div class="space-y-2">
        <p>Legends are made in the regular season. Can you recall who dominated the league?</p>
        <ul class="list-disc pl-5 text-sm text-left">
          <li><strong>Goal:</strong> Select the player who won the MVP award for the specific year displayed.</li>
          <li><strong>Format:</strong> 5 seasons per game.</li>
          <li><strong>Reward:</strong> 10 points per correct answer.</li>
        </ul>
        <p class="text-xs italic mt-2">Press 'Play' to begin the challenge!</p>
      </div>
    `,
    loadingMessage: "Fetching seasons...",
    backgroundImage: `url('${mvpBg}')`,
    urlPath: "/guess-mvps",
    pointsPerCorrect: 10,
    maxPoints: 50,
    fetchData: () => fetchGamePool("mvps", 5),
    handleError: handleErrorDefault,
  },
  {
    id: "starting-five",
    name: "Fill in the Starting 5",
    tag: "LINEUPS",
    description: "Name the starting lineup of the winning team from a random NBA game.",
    intro: "Be the coach's memory — name the full starting five of the winning team.",
    rules: [
      { n: "1", t: "A real game and its winner are shown." },
      { n: "2", t: "Fill all 5 positions (PG, SG, SF, PF, C)." },
      { n: "3", t: "3 lives. Complete the lineup for 100 points." },
    ],
    instruction: `
      <div class="space-y-2">
        <p>You are the coach's memory. Recall the full starting lineup for the winning team of a specific match.</p>
        <ul class="list-disc pl-5 text-sm text-left">
          <li><strong>Goal:</strong> Fill in all 5 positions (PG, SG, SF, PF, C).</li>
          <li><strong>Lives:</strong> You have 3 lives. Each wrong guess costs 1 life.</li>
          <li><strong>High Stakes:</strong> Complete the full lineup to win the round.</li>
          <li><strong>Reward:</strong> 100 points for a perfect completion.</li>
        </ul>
        <p class="text-xs italic mt-2">Press 'Play' to begin the challenge!</p>
      </div>
    `,
    loadingMessage: "Fetching NBA game...",
    backgroundImage: `url('${startingFiveBg}')`,
    urlPath: "/starting-five",
    pointsPerCorrect: 10,
    maxPoints: 100,
    fetchData: () => fetchGamePool("starting-five", 1),
    handleError: handleErrorDefault,
  },
  {
    id: "wordle",
    name: "NBA Wordle",
    tag: "DAILY",
    description: "Guess the NBA player using Wordle rules.",
    intro: "The classic word game for hoops fans — guess the player's last name.",
    rules: [
      { n: "1", t: "Green = right letter & spot, yellow = wrong spot, gray = not in name." },
      { n: "2", t: "You have 5 attempts to solve it." },
      { n: "3", t: "First-try solve scores a 500-point jackpot." },
    ],
    instruction: `
      <div class="space-y-2">
        <p>The classic word game for NBA fanatics. Guess the mystery player's <strong>Last Name</strong>.</p>
        <ul class="list-disc pl-5 text-sm text-left">
          <li><strong>Color Clues:</strong> Green (correct spot), Yellow (wrong spot), Gray (wrong letter).</li>
          <li><strong>Challenge:</strong> You have <strong>5 attempts</strong> to solve the puzzle.</li>
          <li><strong>Jackpot:</strong> Guess correctly on the first try to win <strong>500 points</strong>!</li>
          <li> For each wrong attempt you get a 100 points deduction.</li>
        </ul>
         <p class="text-xs italic mt-2">Press 'Play' to begin the challenge!</p>
      </div>
    `,
    loadingMessage: "Fetching NBA game...",
    backgroundImage: `url('${wordleBg}')`,
    urlPath: "/wordle",
    pointsPerCorrect: 10,
    maxPoints: 500,
    fetchData: () => fetchGamePool("wordle", 1),
    handleError: handleErrorDefault,
  },
  {
    id: "fan-favorites",
    name: "Fan Favorites",
    tag: "SURVEY",
    description: "Guess what 100 NBA fans answered — find every answer on the board.",
    intro: "Think like the crowd. The most popular answers score the board.",
    rules: [
      { n: "1", t: "We asked 100 NBA fans a question — their top answers are hidden on the board." },
      { n: "2", t: "Type answers to reveal them. 3 hearts — a miss costs one." },
      { n: "3", t: "Clear the whole board for 300 points." },
    ],
    instruction: `
      <div class="space-y-2">
        <p>Think like the crowd. We asked 100 NBA fans a question — can you find every answer they gave?</p>
        <ul class="list-disc pl-5 text-sm text-left">
          <li><strong>Goal:</strong> Reveal every hidden answer on the survey board.</li>
          <li><strong>Lives:</strong> You have 3 hearts. A guess that's not on the board costs 1.</li>
          <li><strong>Reward:</strong> Clear the whole board for 300 points.</li>
        </ul>
        <p class="text-xs italic mt-2">Press 'Play' to begin the challenge!</p>
      </div>
    `,
    loadingMessage: "Surveying the fans...",
    backgroundImage: `url('${thumb_fan_favorites}')`,
    urlPath: "/fan-favorites",
    pointsPerCorrect: 50,
    maxPoints: 300,
    fetchData: () => fetchGamePool("fan-favorites", 1),
    handleError: handleErrorDefault,
  },
  {
    id: "heatmap",
    name: "The Heatmap",
    tag: "HEX",
    description: "Claim hexes by naming players who fit a criterion and all its neighbours.",
    intro: "A board of NBA criteria — every claimed hex turns orange. How deep can you push?",
    rules: [
      { n: "1", t: "Tap a hex — each one is an NBA criterion (team, award, stat, draft…)." },
      { n: "2", t: "Name a player who fits that hex AND every neighbouring hex." },
      { n: "3", t: "+50 per claimed hex — profile points cap at 300 per session." },
    ],
    instruction: `
      <div class="space-y-2">
        <p>A hex board of NBA criteria. Claim territory by naming the right players.</p>
        <ul class="list-disc pl-5 text-sm text-left">
          <li><strong>Goal:</strong> Claim hexes — a valid player must match the hex <strong>and all its neighbours</strong>.</li>
          <li><strong>Scoring:</strong> +50 points per claimed hex (profile contribution capped at 300).</li>
          <li><strong>Tip:</strong> Corner hexes have fewer neighbours — start there.</li>
        </ul>
        <p class="text-xs italic mt-2">Press 'Play' to begin the challenge!</p>
      </div>
    `,
    loadingMessage: "Heating up the hexes...",
    backgroundImage: `url('${thumb_heatmap}')`,
    urlPath: "/heatmap",
    pointsPerCorrect: 50,
    maxPoints: 300,
    fetchData: () => fetchGamePool("heatmap", 1),
    handleError: handleErrorDefault,
  },
  {
    id: "connections",
    name: "NBA Connections",
    tag: "GROUPS",
    description: "16 players hide 4 secret groups of 4 — find every link.",
    intro: "Four hidden connections tie the board together. Spot the traps.",
    rules: [
      { n: "1", t: "Select exactly 4 players you think share a link, then submit." },
      { n: "2", t: "5 hearts — a wrong group costs one. 'One away!' means 3 of 4." },
      { n: "3", t: "+50 per solved group — clear the board for 200." },
    ],
    instruction: `
      <div class="space-y-2">
        <p>Sixteen NBA players, four secret groups. Find what connects them.</p>
        <ul class="list-disc pl-5 text-sm text-left">
          <li><strong>Goal:</strong> Submit groups of 4 players sharing a hidden link.</li>
          <li><strong>Lives:</strong> 5 hearts — each wrong submission costs 1.</li>
          <li><strong>Reward:</strong> 50 points per group, 200 for a clean board.</li>
        </ul>
        <p class="text-xs italic mt-2">Press 'Play' to begin the challenge!</p>
      </div>
    `,
    loadingMessage: "Shuffling the board...",
    backgroundImage: `url('${thumb_connections}')`,
    urlPath: "/connections",
    pointsPerCorrect: 50,
    maxPoints: 200,
    fetchData: () => fetchGamePool("connections", 1),
    handleError: handleErrorDefault,
  },
  {
    id: "career-path",
    name: "Career Path Challenge",
    tag: "JOURNEY",
    description: "Guess the mystery player from his team-by-team career path.",
    intro: "One career, card by card. Name the player before the trail runs out.",
    rules: [
      { n: "1", t: "The first team stint is revealed — years, team, GP, PPG." },
      { n: "2", t: "Each wrong guess flips the next card. Guesses = number of teams." },
      { n: "3", t: "Score = unused cards × 100. Run out and it's 0." },
    ],
    instruction: `
      <div class="space-y-2">
        <p>Follow the journey. A mystery player's career unfolds one team card at a time.</p>
        <ul class="list-disc pl-5 text-sm text-left">
          <li><strong>Goal:</strong> Name the player from as few revealed stints as possible.</li>
          <li><strong>Guesses:</strong> One per team on his path — each miss flips a card.</li>
          <li><strong>Reward:</strong> 100 points per card you didn't need.</li>
        </ul>
        <p class="text-xs italic mt-2">Press 'Play' to begin the challenge!</p>
      </div>
    `,
    loadingMessage: "Tracing the career path...",
    backgroundImage: `url('${thumb_career_path}')`,
    urlPath: "/career-path",
    pointsPerCorrect: 100,
    maxPoints: 700,
    fetchData: () => fetchWholePool("players-index"),
    handleError: handleErrorDefault,
  },
  {
    id: "nba-grid",
    name: "NBA Grid",
    tag: "GRID",
    description: "Fill the 3×3 grid with players matching both their row and column.",
    intro: "Nine cells, nine guesses. Rare answers earn the bragging rights.",
    rules: [
      { n: "1", t: "Each cell crosses two criteria (franchise, award, stat, draft…)." },
      { n: "2", t: "9 guesses total — a wrong answer burns one." },
      { n: "3", t: "+30 per cell (270 perfect) + a rarity score for your share card." },
    ],
    instruction: `
      <div class="space-y-2">
        <p>The classic criteria grid. Every cell needs a player who fits its row AND column.</p>
        <ul class="list-disc pl-5 text-sm text-left">
          <li><strong>Goal:</strong> Fill all 9 cells with valid players.</li>
          <li><strong>Guesses:</strong> 9 total — wrong answers burn one.</li>
          <li><strong>Reward:</strong> 30 points per cell; rare picks lower your rarity score.</li>
        </ul>
        <p class="text-xs italic mt-2">Press 'Play' to begin the challenge!</p>
      </div>
    `,
    loadingMessage: "Drawing the grid...",
    backgroundImage: `url('${thumb_nba_grid}')`,
    urlPath: "/nba-grid",
    pointsPerCorrect: 30,
    maxPoints: 270,
    fetchData: () => fetchGamePool("nba-grid", 1),
    handleError: handleErrorDefault,
  },
  {
    id: "who-are-ya",
    name: "Who Are Ya?",
    tag: "MYSTERY",
    description: "A blurred mystery player — every miss sharpens the photo and adds clues.",
    intro: "Blur, clues, deduction. Unmask the mystery player in as few guesses as you can.",
    rules: [
      { n: "1", t: "Guess any player — attributes come back green (exact) or yellow (close)." },
      { n: "2", t: "Every miss sharpens the photo. 8 guesses max." },
      { n: "3", t: "Solve early: 240 points minus 30 per wrong guess." },
    ],
    instruction: `
      <div class="space-y-2">
        <p>Unmask the mystery player. The photo starts heavily blurred and sharpens with every miss.</p>
        <ul class="list-disc pl-5 text-sm text-left">
          <li><strong>Clues:</strong> Team, position, age, jersey, draft — green exact, yellow close, arrows for direction.</li>
          <li><strong>Guesses:</strong> 8 attempts.</li>
          <li><strong>Reward:</strong> 240 points, −30 per wrong guess.</li>
        </ul>
        <p class="text-xs italic mt-2">Press 'Play' to begin the challenge!</p>
      </div>
    `,
    loadingMessage: "Blurring the mystery player...",
    backgroundImage: `url('${thumb_who_are_ya}')`,
    urlPath: "/who-are-ya",
    pointsPerCorrect: 30,
    maxPoints: 240,
    fetchData: () => fetchWholePool("players-index"),
    handleError: handleErrorDefault,
  },
  {
    id: "tictactoe",
    name: "NBA Tic-Tac-Toe",
    tag: "DUEL",
    description: "Head-to-head 3×3: claim cells by naming valid players, three in a row wins.",
    intro: "The PvP flagship. Out-think your opponent cell by cell.",
    rules: [
      { n: "1", t: "On your turn, claim a cell by naming a player who fits its row + column." },
      { n: "2", t: "25 seconds per turn; 3 steals each to retake an occupied cell." },
      { n: "3", t: "Three in a row wins the duel." },
    ],
    instruction: `
      <div class="space-y-2">
        <p>Tic-tac-toe where every cell is an NBA riddle. Beat the clock and your opponent.</p>
        <ul class="list-disc pl-5 text-sm text-left">
          <li><strong>Goal:</strong> Claim three cells in a row by naming valid players.</li>
          <li><strong>Turns:</strong> 25s each; time out and the turn passes.</li>
          <li><strong>Steals:</strong> 3 per player — retake a cell with a different valid answer.</li>
        </ul>
        <p class="text-xs italic mt-2">Press 'Play' to begin the challenge!</p>
      </div>
    `,
    loadingMessage: "Chalking the duel board...",
    backgroundImage: `url('${thumb_tictactoe}')`,
    urlPath: "/tictactoe",
    pointsPerCorrect: 25,
    maxPoints: 225,
    fetchData: () => fetchGamePool("tictactoe", 1),
    handleError: handleErrorDefault,
  },
  {
    id: "bingo",
    name: "NBA Bingo",
    tag: "DAB",
    description: "Dealt player cards, a 16-category board — dab each player on the right cell.",
    intro: "Allocation is the tension: a superstar fits six cells but can only dab one.",
    rules: [
      { n: "1", t: "Players are dealt one at a time — dab each onto exactly one matching cell." },
      { n: "2", t: "A wrong dab skips your next deal." },
      { n: "3", t: "Complete the card before the deck runs out — up to 200 points." },
    ],
    instruction: `
      <div class="space-y-2">
        <p>A 16-category bingo card and a deck of player cards. Spend your stars wisely.</p>
        <ul class="list-disc pl-5 text-sm text-left">
          <li><strong>Goal:</strong> Fill the card — each dealt player dabs exactly one matching cell.</li>
          <li><strong>Penalty:</strong> A wrong dab skips your next deal.</li>
          <li><strong>Reward:</strong> Up to 200 points, scaled by turns used.</li>
        </ul>
        <p class="text-xs italic mt-2">Press 'Play' to begin the challenge!</p>
      </div>
    `,
    loadingMessage: "Dealing the bingo card...",
    backgroundImage: `url('${thumb_bingo}')`,
    urlPath: "/bingo",
    pointsPerCorrect: 10,
    maxPoints: 200,
    fetchData: () => fetchGamePool("bingo", 1),
    handleError: handleErrorDefault,
  },
  {
    id: "contexto",
    name: "LeContexto",
    tag: "RADAR",
    description: "Unlimited guesses — every player you name shows how close you are to the secret one.",
    intro: "No fail state, just a similarity radar. Home in on the secret player.",
    rules: [
      { n: "1", t: "Guess any player — you get a similarity rank (#1 is the answer)." },
      { n: "2", t: "Franchise, era, position, draft and stats drive the similarity." },
      { n: "3", t: "200 points, −5 per guess past your tenth." },
    ],
    instruction: `
      <div class="space-y-2">
        <p>A secret player is hiding. Every guess tells you how warm you are.</p>
        <ul class="list-disc pl-5 text-sm text-left">
          <li><strong>Goal:</strong> Reach rank #1 — the secret player.</li>
          <li><strong>Guesses:</strong> Unlimited; the rank guides you closer.</li>
          <li><strong>Reward:</strong> 200 points, −5 per guess after the tenth.</li>
        </ul>
        <p class="text-xs italic mt-2">Press 'Play' to begin the challenge!</p>
      </div>
    `,
    loadingMessage: "Calibrating the radar...",
    backgroundImage: `url('${thumb_contexto}')`,
    urlPath: "/contexto",
    pointsPerCorrect: 5,
    maxPoints: 200,
    fetchData: () => fetchWholePool("players-index"),
    handleError: handleErrorDefault,
  },
  {
    id: "pack-five",
    name: "Pack 5",
    tag: "CARDS",
    description: "Flip through a pack of player cards — pick the stat that beats the hidden next card.",
    intro: "Premium card-pack feel, poker nerves. Choose the stat that survives.",
    rules: [
      { n: "1", t: "On each card, pick one of 5 stats (PPG, RPG, APG, rings, All-Stars)." },
      { n: "2", t: "It must beat or tie the hidden next card. First miss warns, second ends the run." },
      { n: "3", t: "+20 per card cleared — 220 for the full pack." },
    ],
    instruction: `
      <div class="space-y-2">
        <p>Eleven player cards, one hidden at a time. Back the right stat to keep the streak alive.</p>
        <ul class="list-disc pl-5 text-sm text-left">
          <li><strong>Goal:</strong> Pick a stat on each card that beats-or-ties the next card.</li>
          <li><strong>Lives:</strong> First miss is a warning, the second ends the run.</li>
          <li><strong>Reward:</strong> 20 points per card cleared (220 max).</li>
        </ul>
        <p class="text-xs italic mt-2">Press 'Play' to begin the challenge!</p>
      </div>
    `,
    loadingMessage: "Shuffling the pack...",
    backgroundImage: `url('${thumb_pack_five}')`,
    urlPath: "/pack-five",
    pointsPerCorrect: 20,
    maxPoints: 220,
    fetchData: () => fetchWholePool("players-index"),
    handleError: handleErrorDefault,
  },
  {
    id: "superdraft",
    name: "SuperDraft Five",
    tag: "DRAFT",
    description: "Draft a starting five from randomized pools under today's objective.",
    intro: "Five slots, five random pools, one objective. Build the lineup that maxes the metric.",
    rules: [
      { n: "1", t: "Each slot offers a randomized pool (a franchise, a country, a draft class…)." },
      { n: "2", t: "Draft toward the daily objective: Tallest Five, Most Rings, Most Points…" },
      { n: "3", t: "Your metric ranks on the leaderboard — top percentile earns up to 100." },
    ],
    instruction: `
      <div class="space-y-2">
        <p>Build a starting five under today's objective — every slot draws from a different pool.</p>
        <ul class="list-disc pl-5 text-sm text-left">
          <li><strong>Goal:</strong> Maximize the daily metric (rings, height, career points…).</li>
          <li><strong>Draft:</strong> One pick per slot from its randomized pool.</li>
          <li><strong>Reward:</strong> Leaderboard percentile decides your points (top 10% = 100).</li>
        </ul>
        <p class="text-xs italic mt-2">Press 'Play' to begin the challenge!</p>
      </div>
    `,
    loadingMessage: "Opening the draft room...",
    backgroundImage: `url('${thumb_superdraft}')`,
    urlPath: "/superdraft",
    pointsPerCorrect: 20,
    maxPoints: 100,
    fetchData: () => fetchWholePool("players-index"),
    handleError: handleErrorDefault,
  },
  {
    id: "imposter",
    name: "NBA Imposter",
    tag: "PARTY",
    description: "Party game for friend rooms: find who's bluffing about the mystery player.",
    intro: "Everyone sees the mystery player — except the Imposter. Clue, vote, unmask.",
    rules: [
      { n: "1", t: "All but the Imposter see the mystery player. Take turns giving one-word clues." },
      { n: "2", t: "After two rounds of clues, everyone votes on who's bluffing." },
      { n: "3", t: "Imposter survives = points per wrong voter; caught = a final guess for the steal." },
    ],
    instruction: `
      <div class="space-y-2">
        <p>A social deduction party game for 3+ friends in a room.</p>
        <ul class="list-disc pl-5 text-sm text-left">
          <li><strong>Setup:</strong> Everyone sees the mystery player — except the Imposter.</li>
          <li><strong>Play:</strong> One-word clues in turn order, then a vote.</li>
          <li><strong>Scoring:</strong> Survive as Imposter to score per wrong voter; if caught, one final guess can steal it.</li>
        </ul>
        <p class="text-xs italic mt-2">Gather at least 3 players in a friend room to start!</p>
      </div>
    `,
    loadingMessage: "Gathering the party...",
    backgroundImage: `url('${thumb_imposter}')`,
    urlPath: "/imposter",
    pointsPerCorrect: 0,
    maxPoints: 0,
    fetchData: () => fetchWholePool("players-index"),
    handleError: handleErrorDefault,
  },
  {
    id: "coming-soon",
    name: "Coming Soon",
    tag: "NEW",
    description: "A new game is currently in development.",
    intro: "Something new is in the works.",
    rules: [
      { n: "1", t: "New games drop regularly." },
      { n: "2", t: "Log in to be notified first." },
    ],
    instruction: `
      <div class="text-center italic">
        <p>Stay tuned! Our developers are warming up on the sidelines to bring you new challenges.</p>
      </div>
    `,
    loadingMessage: "Fetching NBA game...",
    backgroundImage: `url('${comingSoonBg}')`,
    urlPath: "/coming-soon",
    pointsPerCorrect: 0,
    maxPoints: 0,
    fetchData: () => fetchGameData(""),
    handleError: handleErrorDefault,
  },
];