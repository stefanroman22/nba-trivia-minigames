
import PlayOffSeries from "../Game Renderers/PlayOffSeries"
import NameLogo from "../Game Renderers/NameLogo"
import GuessMvps from "../Game Renderers/GuessMvps"
import StartingFive from "../Game Renderers/StartingFive";
import Wordle from "../Game Renderers/Wordle";
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
} from "../types/types";

interface RenderGameArgs {
  gameId?: string;
  gameData: GameData[];
  pointsPerCorrect?: number;
  onGameEnd: OnGameEnd;
}

export const renderGame = ({
  gameId,
  gameData,
  pointsPerCorrect = 0,
  onGameEnd,
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
        />
      );

    case "wordle":
      return (
        <Wordle
          gameInfo={gameData as string[]}
          onGameEnd={onGameEnd}
        />
      );

    case "coming-soon":
      return <NoPageFound />;

    default:
      return <p style={{ color: "white" }}>Game mode not supported yet.</p>;
  }
};
