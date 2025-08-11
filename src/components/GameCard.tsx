// GameCard.jsx
import React from 'react';

export const GameCard = ({ name, description, backgroundImage, urlPath }) => {

  return (
    <div
      style={{
        backgroundImage: `linear-gradient(rgba(0,0,0,0.8), rgba(0,0,0,0.8)), ${backgroundImage}`,
        backgroundSize: "cover",
        padding: "2rem",
        borderRadius: "12px",
        boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
        cursor: "pointer",
        transition: "transform 0.2s ease",
      }}
      onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.03)"}
      onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
      onClick={() => window.open(urlPath, '_blank')}
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
  <h3 style={{ margin: '0 0 10px 0' }}>{name}</h3>
  <p style={{ 
    fontSize: "0.8rem", 
    color: "#ba620fff", 
    fontWeight: 'bold', 
    margin: 0,                 // Remove default margins
  }}>
    {description}
  </p>
</div>
    </div>
  );
};

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
    urlPath: "/",
  },
];

