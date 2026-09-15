// multiplayer_server/src/answerMatch.js
//
// Shared free-text answer normaliser for the turn-based games (tictactoe steals/
// claims, imposter mystery-guess matching) and the questions loader's name
// lookup. Mirrors src/utils/answerMatch.ts exactly so the server accepts what
// the client would. Pulled out of turnGames.js so questions.js can use it
// without requiring turnGames.js (which itself requires questions.js).

/** Lowercase, strip accents + punctuation, collapse whitespace. Mirrors answerMatch.ts. */
function normalizeAnswer(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’.,-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = { normalizeAnswer };
