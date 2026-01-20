import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Home.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://192.168.1.6:3001';

function Home() {
  const [roomCode, setRoomCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const createRoom = async () => {
    setIsCreating(true);
    setError('');
    
    try {
      const response = await fetch(`${API_URL}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      const data = await response.json();
      navigate(`/host/${data.roomId}`);
    } catch (error) {
      console.error('Error creating room:', error);
      setError('Failed to create room. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const joinRoom = async (e) => {
    e.preventDefault();
    
    if (!roomCode.trim()) {
      setError('Please enter a room code');
      return;
    }

    setIsJoining(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/rooms/${roomCode.trim()}`);
      const data = await response.json();

      if (data.exists && data.hasHost) {
        navigate(`/room/${roomCode.trim()}`);
      } else {
        setError('Room does not exist or host is offline');
      }
    } catch (error) {
      console.error('Error checking room:', error);
      setError('Failed to join room. Please try again.');
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="home">
      <div className="home-container">
        <div className="hero">
          <div className="logo">
            <span className="logo-icon">📁</span>
            <h1>P2P Share</h1>
          </div>
          <p className="tagline">
            Secure peer-to-peer file sharing without uploads.
            <br />
            Your files never leave your device until someone downloads them.
          </p>
        </div>

        <div className="cards-container">
          <div className="action-card">
            <div className="card-icon">🚀</div>
            <h2>Share Files</h2>
            <p>Create a private room and share the link with others to share your files securely.</p>
            <button 
              className="btn btn-primary btn-large"
              onClick={createRoom}
              disabled={isCreating}
            >
              {isCreating ? (
                <>
                  <span className="spinner"></span>
                  Creating...
                </>
              ) : (
                <>Create Room</>
              )}
            </button>
          </div>

          <div className="divider">
            <span>or</span>
          </div>

          <div className="action-card">
            <div className="card-icon">🔗</div>
            <h2>Join Room</h2>
            <p>Enter a room code to download files shared by someone.</p>
            <form onSubmit={joinRoom}>
              <input
                type="text"
                placeholder="Enter room code"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                className="room-input"
                maxLength={8}
              />
              <button 
                type="submit"
                className="btn btn-primary btn-large"
                disabled={isJoining}
              >
                {isJoining ? (
                  <>
                    <span className="spinner"></span>
                    Joining...
                  </>
                ) : (
                  <>Join Room</>
                )}
              </button>
            </form>
          </div>
        </div>

        {error && (
          <div className="error-message">
            <span>⚠️</span> {error}
          </div>
        )}

        <div className="features">
          <div className="feature">
            <span className="feature-icon">🔒</span>
            <h3>Encrypted</h3>
            <p>WebRTC provides built-in DTLS encryption for secure transfers</p>
          </div>
          <div className="feature">
            <span className="feature-icon">🌐</span>
            <h3>P2P Transfer</h3>
            <p>Files transfer directly between devices, no server storage</p>
          </div>
          <div className="feature">
            <span className="feature-icon">⚡</span>
            <h3>Real-time</h3>
            <p>Fast transfers using modern WebRTC data channels</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Home;
