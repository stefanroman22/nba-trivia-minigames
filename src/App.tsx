import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './App.css';
import Landpage from './pages/Landpage';
import SeriesWinner from './pages/Trivia/SeriesWinner';

function App() {

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landpage />} />
        <Route path="/series-winner" element={<SeriesWinner />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
