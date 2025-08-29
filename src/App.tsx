import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './App.css';
import Landpage from './pages/Landpage';
import MiniGame from './pages/Trivia/MiniGame';
import NoPageFound from './pages/NoPageFound';

function App() {

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landpage />} />
        <Route path="/series-winner" element={<MiniGame />} />
        <Route path="/name-logo" element={<MiniGame />} />
        <Route path="/guess-mvps" element={<MiniGame />} />
        <Route path="/starting-five" element={<MiniGame />} />
        <Route path="/coming-soon" element={<NoPageFound />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
