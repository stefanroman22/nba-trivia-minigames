import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './App.css';
import Landpage from './pages/Landpage';
import MiniGame from './pages/Trivia/MiniGame';
import NoPageFound from './pages/NoPageFound';
import Wordle from './Game Renderers/Wordle';
import PlayWithFriend from './components/MultiPlayer/PlayWithFriend';

function App() {

  return (
      <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landpage />} />
        <Route path="/series-winner" element={<MiniGame />} />
        <Route path="/name-logo" element={<MiniGame />} />
        <Route path="/guess-mvps" element={<MiniGame />} />
        <Route path="/starting-five" element={<MiniGame />} />
        <Route path="/wordle" element={<MiniGame />} />
        <Route path="/coming-soon" element={<NoPageFound />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;


/*


    <div style={{ padding: "2rem" }}>
      <h1>Socket.IO Test</h1>
      <PlayWithFriend />
    </div>
*/