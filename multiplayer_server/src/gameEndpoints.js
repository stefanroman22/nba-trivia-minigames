// The Django backend base URL. Set API_BASE_URL in production (the deployed backend);
// defaults to local dev. Without this, deployed multiplayer can't reach the API.
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:8000";

module.exports = {
  "series-winner": `${API_BASE_URL}/trivia/playoff-series/`,
  "name-logo": `${API_BASE_URL}/trivia/name-logo/`,
  "guess-mvps": `${API_BASE_URL}/trivia/guess-mvps/`,
  "starting-five": `${API_BASE_URL}/trivia/starting-five/`,
  "wordle": `${API_BASE_URL}/trivia/wordle/`,
  "fan-favorites": `${API_BASE_URL}/trivia/fan-favorites/`,
  "heatmap": `${API_BASE_URL}/trivia/heatmap/`,
  "connections": `${API_BASE_URL}/trivia/connections/`,
  "nba-grid": `${API_BASE_URL}/trivia/nba-grid/`,
  "bingo": `${API_BASE_URL}/trivia/bingo/`,
  "who-would-win": `${API_BASE_URL}/trivia/who-would-win/`,
  "pack-five": `${API_BASE_URL}/trivia/pack-five/`,
};