
import PlayOffSeries from "../Game Renderers/PlayOffSeries"
import NameLogo from "../Game Renderers/NameLogo"
import GuessMvps from "../Game Renderers/GuessMvps"
import StartingFive from "../Game Renderers/StartingFive";
import Wordle from "../Game Renderers/Wordle";
import FanFavorites from "../Game Renderers/FanFavorites";
import HeatmapGame from "../Game Renderers/HeatmapGame";
import ConnectionsGame from "../Game Renderers/ConnectionsGame";
import CareerPath from "../Game Renderers/CareerPath";
import NbaGrid from "../Game Renderers/NbaGrid";
import WhoAreYa from "../Game Renderers/WhoAreYa";
import TicTacToe from "../Game Renderers/TicTacToe";
import BingoGame from "../Game Renderers/BingoGame";
import Contexto from "../Game Renderers/Contexto";
import PackFive from "../Game Renderers/PackFive";
import SuperDraft from "../Game Renderers/SuperDraft";
import ImposterGame from "../Game Renderers/ImposterGame";
import NoPageFound from "../pages/NoPageFound";
import { nbaTeamColors, getContrastColor } from "../constants/nbaTeamColors";
import { buttonTeamStyle } from "../constants/styles";
import { nbaTeams } from "../constants/nbaTeams";
import type {
  GameData,
  OnGameEnd,
  PlayoffSeries,
  NbaTeamLogo,
  MvpSeason,
  StartingFiveGame,
  FanFavoritesQuestion,
  HeatmapBoard,
  ConnectionsBoard,
  GridConfig,
  BingoCard,
  PlayerIndexEntry,
} from "../types/types";

interface RenderGameArgs {
  gameId?: string;
  gameData: GameData[];
  pointsPerCorrect?: number;
  onGameEnd: OnGameEnd;
  /** Single-player only: Starting Five's loss screen uses these for its
   *  in-place "play again" / "exit" choices. */
  onExit?: () => void;
  onPlayAgain?: () => void;
  /** Closes the game and returns to idle — the in-place end panels' "Close game". */
  onClose?: () => void;
  /** Turn-engine games only (tictactoe/imposter/connections, contract #6):
   *  authoritative server state + action sender, wired by OnlineMatch. */
  turn?: unknown;
  onTurnAction?: (a: unknown) => void;
  multiplayer?: boolean;
}

export const renderGame = ({
  gameId,
  gameData,
  pointsPerCorrect = 0,
  onGameEnd,
  onExit,
  onPlayAgain,
  onClose,
  turn,
  onTurnAction,
  multiplayer,
}: RenderGameArgs) => {
  switch (gameId) {
    case "series-winner":
      return (
        <PlayOffSeries
          seriesList={gameData as PlayoffSeries[]}
          pointsPerCorrect={pointsPerCorrect}
          buttonTeamStyle={buttonTeamStyle}
          nbaTeamColors={nbaTeamColors}
          getContrastColor={getContrastColor}
          onGameEnd={onGameEnd}
        />
      );

    case "name-logo":
      return (
        <NameLogo
          seriesList={gameData as NbaTeamLogo[]}
          pointsPerCorrect={pointsPerCorrect}
          onGameEnd={onGameEnd}
          allTeams={nbaTeams}
        />
      );

    case "guess-mvps":
      return (
        <GuessMvps
          seasonsList={gameData as MvpSeason[]}
          pointsPerCorrect={pointsPerCorrect}
          onGameEnd={onGameEnd}
        />
      );

    case "starting-five":
      return (
        <StartingFive
          gameInfo={gameData as StartingFiveGame[]}
          pointsPerCorrect={pointsPerCorrect}
          onGameEnd={onGameEnd}
          onExit={onExit}
          onPlayAgain={onPlayAgain}
          onClose={onClose}
        />
      );

    case "wordle":
      return (
        <Wordle
          gameInfo={gameData as string[]}
          onGameEnd={onGameEnd}
        />
      );

    case "fan-favorites":
      return (
        <FanFavorites
          gameInfo={gameData as FanFavoritesQuestion[]}
          onGameEnd={onGameEnd}
          onPlayAgain={onPlayAgain}
          onClose={onClose}
        />
      );

    case "heatmap":
      return (
        <HeatmapGame
          gameInfo={gameData as HeatmapBoard[]}
          onGameEnd={onGameEnd}
          onPlayAgain={onPlayAgain}
          onClose={onClose}
        />
      );

    case "connections":
      return (
        <ConnectionsGame
          gameInfo={gameData as ConnectionsBoard[]}
          onGameEnd={onGameEnd}
          turn={turn}
          onTurnAction={onTurnAction}
          multiplayer={multiplayer}
        />
      );

    case "career-path":
      return (
        <CareerPath
          gameInfo={gameData as PlayerIndexEntry[]}
          onGameEnd={onGameEnd}
          onPlayAgain={onPlayAgain}
          onClose={onClose}
        />
      );

    case "nba-grid":
      return (
        <NbaGrid
          gameInfo={gameData as GridConfig[]}
          onGameEnd={onGameEnd}
          onPlayAgain={onPlayAgain}
          onClose={onClose}
        />
      );

    case "who-are-ya":
      return (
        <WhoAreYa
          gameInfo={gameData as PlayerIndexEntry[]}
          onGameEnd={onGameEnd}
          onPlayAgain={onPlayAgain}
          onClose={onClose}
        />
      );

    case "tictactoe":
      return (
        <TicTacToe
          gameInfo={gameData as GridConfig[]}
          onGameEnd={onGameEnd}
          turn={turn}
          onTurnAction={onTurnAction}
          multiplayer={multiplayer}
        />
      );

    case "bingo":
      return (
        <BingoGame
          gameInfo={gameData as BingoCard[]}
          onGameEnd={onGameEnd}
        />
      );

    case "contexto":
      return (
        <Contexto
          gameInfo={gameData as PlayerIndexEntry[]}
          onGameEnd={onGameEnd}
        />
      );


    case "pack-five":
      return (
        <PackFive
          gameInfo={gameData as PlayerIndexEntry[]}
          onGameEnd={onGameEnd}
        />
      );

    case "superdraft":
      return (
        <SuperDraft
          gameInfo={gameData as PlayerIndexEntry[]}
          onGameEnd={onGameEnd}
          onPlayAgain={onPlayAgain}
          onClose={onClose}
        />
      );

    case "imposter":
      return (
        <ImposterGame
          gameInfo={gameData as PlayerIndexEntry[]}
          onGameEnd={onGameEnd}
          turn={turn}
          onTurnAction={onTurnAction}
          multiplayer={multiplayer}
        />
      );

    case "coming-soon":
      return <NoPageFound />;

    default:
      return <p style={{ color: "white" }}>Game mode not supported yet.</p>;
  }
};
