
import type { Game } from "../types/types";
import Swal from "sweetalert2";
import { fetchGamePool } from "./pool";
import playoffSeriesBg from "../assets/Games Backrounds/playoff_series.jpg";
import guessLogoBg from "../assets/Games Backrounds/guess_the_logo.jpg";
import mvpBg from "../assets/Games Backrounds/mvp.jpg";
import startingFiveBg from "../assets/Games Backrounds/starting_five.jpg";
import wordleBg from "../assets/Games Backrounds/wordle.jpg";
import comingSoonBg from "../assets/Games Backrounds/coming_soon.jpg";

export const handleErrorDefault = (error: { title: string; message: string }) => {
  Swal.fire({
    icon: "error",
    title: error.title,
    text: error.message,
    background: "#1f1f1f",
    color: "#ffffff",
    confirmButtonText: "Retry",
    confirmButtonColor: "#EA750E",
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