
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
    description:
      "Pick the winner between two teams from a real NBA playoff series.",
    instruction:
      "For Singleplayer use simply press the start button below. Each round consists of 5 playoff series for which you need to guess the winner. Each correct answer will give you 10 points.",
    loadingMessage: "Fetching playoff series...",
    backgroundImage:
      "url('/src/assets/Games Backrounds/playoff_series.jpg')",
    urlPath: "/series-winner",
    pointsPerCorrect: 10,
    maxPoints: 50,
    fetchData: () => fetchGameData("http://localhost:8000/trivia/playoff-series/"),
    handleError: handleErrorDefault,
  },
  {
    id: "name-logo",
    name: "Name the NBA club",
    description: "Based on the logo name the NBA team.",
    instruction:
      "For Singleplayer use simply press the start button below. Each round consists of 5 logos for which you need to guess the NBA team. Each correct answer will give you 10 points.",
    loadingMessage: "Fetching logos...",
    backgroundImage:
      "url('/src/assets/Games Backrounds/guess_the_logo.jpg')",
    urlPath: "/name-logo",
    pointsPerCorrect: 10,
    maxPoints: 50,
    fetchData: () => fetchGameData("http://127.0.0.1:8000/trivia/name-logo/"),
    handleError: handleErrorDefault,
  },
  {
    id: "guess-mvps",
    name: "Guess the MVP",
    description: "Name the MVP for a specific NBA season",
    instruction:
      "For Singleplayer use simply press the start button below. Each round consists of 5 seasons for which you need to guess the MVP. Each correct answer will give you 10 points.",
    loadingMessage: "Fetching seasons...",
    backgroundImage:
      "url('/src/assets/Games Backrounds/mvp.jpg')",
    urlPath: "/guess-mvps",
    pointsPerCorrect: 10,
    maxPoints: 50,
    fetchData: () => fetchGameData("http://127.0.0.1:8000/trivia/guess-mvps/"),
    handleError: handleErrorDefault,
  },
  {
    id: "starting-five",
    name: "Fill in the starting 5",
    description: "Name the staring lineup of the winning team from a random NBA game.",
    instruction:
      "For Singleplayer use simply press the start button below. Each round consists of 1 NBA game for which you need to guess the starting 5. You have 3 lifes and each mistake costs you 1 life. For completing a round you get 100 points.",
    loadingMessage: "Fetching NBA game...",
    backgroundImage:
      "url('/src/assets/Games Backrounds/starting_five.jpg')",
    urlPath: "/starting-five",
    pointsPerCorrect: 10,
    maxPoints: 100,
    fetchData: () => fetchGameData("http://127.0.0.1:8000/trivia/starting-five/"),
    handleError: handleErrorDefault,
  },
  {
    id: "wordle",
    name: "NBA Wordle",
    description: "Guess the NBA player using wordle rules.",
    instruction:
      "For Singleplayer use simply press the start button below. Each round consists of 1 NBA player for which you need to guess their last name. You have 5 attempts and the sonner you get it right the more points you get!",
    loadingMessage: "Fetching NBA game...",
    backgroundImage:
      "url('/src/assets/Games Backrounds/wordle.jpg')",
    urlPath: "/wordle",
    pointsPerCorrect: 10,
    maxPoints: 600,
    fetchData: () => fetchGameData("http://127.0.0.1:8000/trivia/wordle/"),
    handleError: handleErrorDefault,
  },
  {
    id: "coming-soon",
    name: "Mistery Game",
    description: "Coming Soon",
    instruction:
      "Coming Soon",
    loadingMessage: "Fetching...",
    backgroundImage:
      "url('/src/assets/Games Backrounds/coming_soon.jpg')",
    urlPath: "/coming-soon",
    pointsPerCorrect: 10,
    maxPoints: 100,
    fetchData: () => fetchGameData(""),
    handleError: handleErrorDefault,
  },
];