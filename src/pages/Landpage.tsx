
import "../styles/LandPage.css";
import { GameCard } from "../components/GameCard";
import { games } from "../utils/GameUtils";
import Navigation from "../components/Navigation";
import UserProfile from "../components/UserProfile";
import "../styles/GlobalStyles.css";
import Leaderboard from "../components/Leaderboard";
import Footer from "../components/Footer";
import { navItemsLeft } from "../constants/navigation";
import { navItemsRight } from "../constants/navigation";
import RevealText from "../components/RevealText";
import LogInSignUp from "../components/LogInSignUp";
import { useSelector } from "react-redux";
import type { RootState } from "../store";


const Landpage = () => {

  const { user } = useSelector((state: RootState) => state.user);

  return (
    <div id="main-container" className="main-container">

      {/* Navigation */}
      <Navigation type="full" navItemsLeft={navItemsLeft} navItemsRight={navItemsRight} />

      {/* Play Section */}
      <div id="play" className="play-section">
        <RevealText
          text="NBA Trivia Minigames"
          // 1. Layout stuff goes here (margins, centering)
          className="mb-8"

          // 2. Gradient, Font, Size stuff goes here
          textClassName="
            text-3xl font-extrabold 
            bg-clip-text text-transparent 
            bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-400
            drop-shadow-sm
          "
        />

        <div className="games-grid">

          {games.map((game, index) => (
            <GameCard key={index} game={game} index={index} />
          ))}
        </div>
      </div>

      {/* Login Section */}
      <div
        id="login"
        className="login-section"
      > 
        
        {user ? <UserProfile /> : <LogInSignUp />}
      </div>

      {/* Leaderboard Section */}
      <div id="leaderboard" className="leaderboard-section">
        <Leaderboard />
      </div>

      {/* Contact Section */}
      <section id="contact">
        <Footer />
      </section>

    </div>
  );
};




export default Landpage;
