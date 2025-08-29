import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
export const GameCard = ({ game, customStyle = {} }) => {
  const navigate = useNavigate();
  const handleClick = () => {
    if (game.urlPath) {
    navigate(game.urlPath, { state: { id: game.id } });
    } else {
      console.warn("No urlPath provided for this game");
    }
  };

  return (
    <div
      style={{
    width: "100%",             // fill available space
    maxWidth: "285px",         // optional max width
    aspectRatio: "3 / 1",      // width:height ratio (2:1 here)
    backgroundImage: `linear-gradient(rgba(0,0,0,0.8), rgba(0,0,0,0.8)), ${game.backgroundImage}`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    borderRadius: "12px",
    boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
    cursor: "pointer",
    transition: "transform 0.2s ease",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end", 
    ...customStyle,
  }}
      onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.03)"}
      onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
      onClick={() => handleClick()}
    >
      <div 
  style={{ 
    textAlign: 'center',       // Horizontal centering
    display: 'flex',           // Flexbox for vertical centering
    flexDirection: 'column',   // Stack children vertically
    justifyContent: 'center',  // Vertical centering
    alignItems: 'center',      // Horizontal centering (redundant with textAlign)
    height: '100%',            // Take full height of parent
    padding: '20px',           // Add breathing room
  }}
>
  <h3 style={{ margin: '0 0 10px 0' }}>{game.name}</h3>
  <p style={{ 
    fontSize: "0.8rem", 
    color: "#ba620fff", 
    fontWeight: 'bold', 
    margin: 0,                 // Remove default margins
  }}>
    {game.description}
  </p>
</div>
    </div>
  );
};

export const handleErrorDefault = (error) => {
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

export const fetchGameData = async (endpoint) => {
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
  } catch (err) {
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

export const games = [
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
    fetchData: () => fetchGameData("http://127.0.0.1:8000/trivia/playoff-series/"),
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



/*
export const games = [
  {
    name: "Guess the Series Winner",
    description: "Pick the winner between two teams from a real NBA playoff series.",
    backgroundImage: "url('/src/assets/Games Backrounds/playoff_series.jpg')",
    urlPath: "/series-winner",
  },
  {
    name: "Name the MVP",
    description: "Guess the MVP of a particular NBA season.",
    backgroundImage: "url('/src/assets/Games Backrounds/mvp.jpg')",
  },
  {
    name: "Who Scored More?",
    description: "Choose which player had the higher scoring average in a given season.",
    backgroundImage: "url('/src/assets/Games Backrounds/highest_scoring.jpg')",
  },
  {
    name: "Who's the Fifth?",
    description: "Guess the missing NBA starter from real lineups.",
    backgroundImage: "url('/src/assets/Games Backrounds/starting_five.jpg')",
    urlPath: "/",
  },
  {
    name: "Baskteball Wordle",
    description: "Guess the NBA player.",
    backgroundImage: "url('/src/assets/Games Backrounds/wordle.jpg')",
    urlPath: "?",
  },
  {
    name: "Guess the NBA organization",
    description: "Name the NBA organization based on logo.",
    backgroundImage: "url('/src/assets/Games Backrounds/guess_the_logo.jpg')",
    urlPath: "/",
  }, 
  {
    name: "Career path finder",
    description: "Find the player based on the carrer path.",
    backgroundImage: "url('/src/assets/Games Backrounds/guess_player.jpg')",
    urlPath: "/",
  },
  {
    name: "NBA connections",
    description: "Find the 3 links between the players.",
    backgroundImage: "url('/src/assets/Games Backrounds/find_connections.jpg')",
    urlPath: "/series-winner",
  },
];
*/
