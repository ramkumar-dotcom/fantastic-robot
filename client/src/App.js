import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './components/Home';
import HostRoom from './components/HostRoom';
import ClientRoom from './components/ClientRoom';
import './App.css';

function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/host/:roomId" element={<HostRoom />} />
        <Route path="/room/:roomId" element={<ClientRoom />} />
      </Routes>
    </div>
  );
}

export default App;
