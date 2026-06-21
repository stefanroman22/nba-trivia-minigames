// The Django backend base URL. Set API_BASE_URL in production (the deployed backend);
// defaults to local dev. Without this, deployed multiplayer can't reach the API.
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:8000";

module.exports = {
  "series-winner": `${API_BASE_URL}/trivia/playoff-series/`,
  "name-logo": `${API_BASE_URL}/trivia/name-logo/`,
  "guess-mvps": `${API_BASE_URL}/trivia/guess-mvps/`,
  "starting-five": `${API_BASE_URL}/trivia/starting-five/`,
  "wordle": `${API_BASE_URL}/trivia/wordle/`,
};