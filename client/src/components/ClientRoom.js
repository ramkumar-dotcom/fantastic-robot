import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiService from '../services/socket';
import { WebRTCClient } from '../services/webrtc';
import { formatFileSize, getFileIcon } from '../utils/fileUtils';
import './ClientRoom.css';

function ClientRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [isConnected, setIsConnected] = useState(false);
  const [files, setFiles] = useState([]);
  const [downloadProgress, setDownloadProgress] = useState({});
  const [downloadingFiles, setDownloadingFiles] = useState(new Set());
  const [completedFiles, setCompletedFiles] = useState(new Set());
  const [error, setError] = useState('');
  const [hostOnline, setHostOnline] = useState(true);

  const webrtcRef = useRef(null);

  const handleProgress = useCallback((fileId, progress) => {
    setDownloadProgress(prev => ({
      ...prev,
      [fileId]: Math.min(progress, 100)
    }));
  }, []);

  const handleComplete = useCallback((fileId, fileName) => {
    setDownloadingFiles(prev => {
      const newSet = new Set(prev);
      newSet.delete(fileId);
      return newSet;
    });
    setCompletedFiles(prev => new Set([...prev, fileId]));
    setDownloadProgress(prev => ({
      ...prev,
      [fileId]: 100
    }));
    console.log(`Download complete: ${fileName}`);
  }, []);

  const handleError = useCallback((fileId, error) => {
    setDownloadingFiles(prev => {
      const newSet = new Set(prev);
      newSet.delete(fileId);
      return newSet;
    });
    setDownloadProgress(prev => {
      const newProgress = { ...prev };
      delete newProgress[fileId];
      return newProgress;
    });
    console.error(`Download error for ${fileId}:`, error);
  }, []);

  useEffect(() => {
    // Setup event listeners
    apiService.on('connect', () => {
      setIsConnected(true);
    });

    apiService.on('room-joined', ({ files: roomFiles }) => {
      setFiles(roomFiles || []);
      setHostOnline(true);
    });

    apiService.on('room-error', ({ message }) => {
      setError(message);
      setHostOnline(false);
    });

    apiService.on('files-updated', ({ files: updatedFiles }) => {
      setFiles(updatedFiles || []);
    });

    apiService.on('host-disconnected', () => {
      setHostOnline(false);
      setError('Host has disconnected. Files are no longer available.');
    });

    // Initialize WebRTC client
    webrtcRef.current = new WebRTCClient(
      apiService,
      handleProgress,
      handleComplete,
      handleError
    );

    // Join the room
    apiService.joinRoom(roomId);

    return () => {
      if (webrtcRef.current) {
        webrtcRef.current.cleanup();
      }
      apiService.disconnect();
    };
  }, [roomId, handleProgress, handleComplete, handleError]);

  const handleDownload = (fileId) => {
    if (downloadingFiles.has(fileId) || completedFiles.has(fileId)) {
      return;
    }

    setDownloadingFiles(prev => new Set([...prev, fileId]));
    setDownloadProgress(prev => ({ ...prev, [fileId]: 0 }));
    
    if (webrtcRef.current) {
      webrtcRef.current.requestFile(fileId);
    }
  };

  const handleLeaveRoom = () => {
    if (webrtcRef.current) {
      webrtcRef.current.cleanup();
    }
    apiService.disconnect();
    navigate('/');
  };

  const getFileStatus = (fileId) => {
    if (completedFiles.has(fileId)) {
      return 'completed';
    }
    if (downloadingFiles.has(fileId)) {
      return 'downloading';
    }
    return 'ready';
  };

  if (error && !hostOnline) {
    return (
      <div className="client-room">
        <div className="client-container">
          <div className="error-card">
            <span className="error-icon">😕</span>
            <h2>Room Unavailable</h2>
            <p>{error}</p>
            <button className="btn btn-primary" onClick={() => navigate('/')}>
              Go Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="client-room">
      <div className="client-container">
        <header className="client-header">
          <div className="header-left">
            <button className="btn btn-secondary" onClick={handleLeaveRoom}>
              ← Leave Room
            </button>
          </div>
          <div className="header-center">
            <h1>📁 P2P Share</h1>
          </div>
          <div className="header-right">
            <span className={`status-indicator ${isConnected && hostOnline ? 'online' : 'offline'}`}>
              {isConnected && hostOnline ? '🟢 Connected' : '🔴 Disconnected'}
            </span>
          </div>
        </header>

        <div className="room-info-bar">
          <div className="room-code-section">
            <span className="label">Room Code:</span>
            <span className="room-code">{roomId}</span>
          </div>
          <div className="host-status">
            <span className={`host-badge ${hostOnline ? 'online' : 'offline'}`}>
              {hostOnline ? '✓ Host Online' : '✕ Host Offline'}
            </span>
          </div>
        </div>

        <div className="files-container">
          <div className="files-header">
            <h2>📋 Available Files</h2>
            <span className="file-count">{files.length} file(s)</span>
          </div>

          {files.length === 0 ? (
            <div className="no-files">
              <span className="no-files-icon">📭</span>
              <p>No files shared yet</p>
              <p className="hint">Wait for the host to add files...</p>
            </div>
          ) : (
            <div className="files-grid">
              {files.map(file => {
                const status = getFileStatus(file.id);
                const progress = downloadProgress[file.id] || 0;

                return (
                  <div key={file.id} className={`file-card ${status}`}>
                    <div className="file-icon">{getFileIcon(file.type)}</div>
                    <div className="file-details">
                      <span className="file-name" title={file.name}>{file.name}</span>
                      <span className="file-size">{formatFileSize(file.size)}</span>
                      
                      {status === 'downloading' && (
                        <div className="progress-container">
                          <div className="progress-bar">
                            <div 
                              className="progress-fill"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="progress-text">{Math.round(progress)}%</span>
                        </div>
                      )}
                    </div>
                    <button
                      className={`download-btn ${status}`}
                      onClick={() => handleDownload(file.id)}
                      disabled={status !== 'ready' || !hostOnline}
                    >
                      {status === 'completed' && '✓ Downloaded'}
                      {status === 'downloading' && '⏳ Downloading...'}
                      {status === 'ready' && '⬇️ Download'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="info-banner">
          <span className="info-icon">ℹ️</span>
          <p>Files are transferred directly from the host's device using secure peer-to-peer connection.</p>
        </div>
      </div>
    </div>
  );
}

export default ClientRoom;
