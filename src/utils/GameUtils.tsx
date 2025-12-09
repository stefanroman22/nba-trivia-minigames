
import type { Game } from "../types/types";
import Swal from "sweetalert2";

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
    description: "Pick the winner between two teams from a real NBA playoff series.",
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
    backgroundImage: "url('/src/assets/Games Backrounds/playoff_series.jpg')",
    urlPath: "/series-winner",
    pointsPerCorrect: 10,
    maxPoints: 50,
    fetchData: () => fetchGameData("http://localhost:8000/trivia/playoff-series/"),
    handleError: handleErrorDefault,
  },
  {
    id: "name-logo",
    name: "Name the NBA Club",
    description: "Based on the logo, name the NBA team.",
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
    backgroundImage: "url('/src/assets/Games Backrounds/guess_the_logo.jpg')",
    urlPath: "/name-logo",
    pointsPerCorrect: 10,
    maxPoints: 50,
    fetchData: () => fetchGameData("http://127.0.0.1:8000/trivia/name-logo/"),
    handleError: handleErrorDefault,
  },
  {
    id: "guess-mvps",
    name: "Guess the MVP",
    description: "Name the MVP for a specific NBA season.",
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
    backgroundImage: "url('/src/assets/Games Backrounds/mvp.jpg')",
    urlPath: "/guess-mvps",
    pointsPerCorrect: 10,
    maxPoints: 50,
    fetchData: () => fetchGameData("http://127.0.0.1:8000/trivia/guess-mvps/"),
    handleError: handleErrorDefault,
  },
  {
    id: "starting-five",
    name: "Fill in the Starting 5",
    description: "Name the starting lineup of the winning team from a random NBA game.",
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
    backgroundImage: "url('/src/assets/Games Backrounds/starting_five.jpg')",
    urlPath: "/starting-five",
    pointsPerCorrect: 10,
    maxPoints: 100,
    fetchData: () => fetchGameData("http://127.0.0.1:8000/trivia/starting-five/"),
    handleError: handleErrorDefault,
  },
  {
    id: "wordle",
    name: "NBA Wordle",
    description: "Guess the NBA player using Wordle rules.",
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
    backgroundImage: "url('/src/assets/Games Backrounds/wordle.jpg')",
    urlPath: "/wordle",
    pointsPerCorrect: 10,
    maxPoints: 500,
    fetchData: () => fetchGameData("http://127.0.0.1:8000/trivia/wordle/"),
    handleError: handleErrorDefault,
  },
  {
    id: "coming-soon",
    name: "Coming Soon",
    description: "A new game is currently in development.",
    instruction: `
      <div class="text-center italic">
        <p>Stay tuned! Our developers are warming up on the sidelines to bring you new challenges.</p>
      </div>
    `,
    loadingMessage: "Fetching NBA game...",
    backgroundImage: "url('/src/assets/Games Backrounds/coming_soon.jpg')",
    urlPath: "/coming-soon",
    pointsPerCorrect: 0,
    maxPoints: 0,
    fetchData: () => fetchGameData(""),
    handleError: handleErrorDefault,
  },
];