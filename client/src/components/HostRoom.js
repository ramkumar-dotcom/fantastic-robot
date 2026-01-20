import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiService from '../services/socket';
import { WebRTCHost } from '../services/webrtc';
import { formatFileSize, getFileIcon, processFiles, copyToClipboard } from '../utils/fileUtils';
import './HostRoom.css';

function HostRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [isConnected, setIsConnected] = useState(false);
  const [files, setFiles] = useState([]);
  const [filesMap, setFilesMap] = useState(new Map());
  const [clientCount, setClientCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [transferLog, setTransferLog] = useState([]);
  const [peerCounts, setPeerCounts] = useState({}); // { fileId: count }
  
  const webrtcRef = useRef(null);
  const fileInputRef = useRef(null);

  const shareUrl = `${window.location.origin}/room/${roomId}`;

  const addToLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setTransferLog(prev => [...prev.slice(-49), { message, type, timestamp }]);
  }, []);

  useEffect(() => {
    // Setup event listeners
    apiService.on('connect', () => {
      setIsConnected(true);
      addToLog('Connected to server', 'success');
    });

    apiService.on('room-created', ({ roomId: createdRoomId }) => {
      addToLog(`Room ${createdRoomId} created successfully`, 'success');
    });

    apiService.on('client-count', ({ count }) => {
      setClientCount(count);
    });

    apiService.on('peer-counts-updated', ({ counts }) => {
      setPeerCounts(counts);
    });

    apiService.on('connect_error', (error) => {
      setIsConnected(false);
      addToLog('Connection error', 'error');
    });

    // Host the room
    apiService.hostRoom(roomId);

    return () => {
      if (webrtcRef.current) {
        webrtcRef.current.cleanup();
      }
      apiService.disconnect();
    };
  }, [roomId, addToLog]);

  useEffect(() => {
    if (isConnected && filesMap.size > 0) {
      if (!webrtcRef.current) {
        webrtcRef.current = new WebRTCHost(apiService, filesMap);
      } else {
        webrtcRef.current.updateFiles(filesMap);
      }
    }
  }, [isConnected, filesMap]);

  const handleFileSelect = (selectedFiles) => {
    const { filesMap: newFilesMap, filesArray } = processFiles(selectedFiles);
    
    setFilesMap(prev => {
      const merged = new Map(prev);
      newFilesMap.forEach((file, id) => merged.set(id, file));
      return merged;
    });
    
    setFiles(prev => [...prev, ...filesArray]);

    // Update server with new file list
    const allFiles = [...files, ...filesArray].map(f => ({
      id: f.id,
      name: f.name,
      size: f.size,
      type: f.type
    }));
    
    apiService.updateFiles(allFiles);
    addToLog(`Added ${filesArray.length} file(s) for sharing`, 'success');
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles.length > 0) {
      handleFileSelect(droppedFiles);
    }
  };

  const handleFileInput = (e) => {
    if (e.target.files.length > 0) {
      handleFileSelect(e.target.files);
    }
  };

  const removeFile = (fileId) => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
    setFilesMap(prev => {
      const newMap = new Map(prev);
      newMap.delete(fileId);
      return newMap;
    });

    // Update server
    const updatedFiles = files.filter(f => f.id !== fileId).map(f => ({
      id: f.id,
      name: f.name,
      size: f.size,
      type: f.type
    }));
    
    apiService.updateFiles(updatedFiles);
    addToLog('File removed from sharing', 'info');
  };

  const handleCopyLink = async () => {
    const success = await copyToClipboard(shareUrl);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleLeaveRoom = () => {
    if (webrtcRef.current) {
      webrtcRef.current.cleanup();
    }
    apiService.disconnect();
    navigate('/');
  };

  // Get total active downloads
  const totalActiveDownloads = Object.values(peerCounts).reduce((sum, count) => sum + count, 0);

  return (
    <div className="host-room">
      <div className="host-container">
        <header className="host-header">
          <div className="header-left">
            <button className="btn btn-secondary" onClick={handleLeaveRoom}>
              ← Leave Room
            </button>
          </div>
          <div className="header-center">
            <h1>📁 P2P Share</h1>
          </div>
          <div className="header-right">
            <span className={`status-indicator ${isConnected ? 'online' : 'offline'}`}>
              {isConnected ? '🟢 Online' : '🔴 Offline'}
            </span>
          </div>
        </header>

        <div className="room-info-bar">
          <div className="room-code-section">
            <span className="label">Room Code:</span>
            <span className="room-code">{roomId}</span>
          </div>
          <div className="share-section">
            <input 
              type="text" 
              value={shareUrl} 
              readOnly 
              className="share-url-input"
            />
            <button 
              className={`btn ${copied ? 'btn-success' : 'btn-primary'}`}
              onClick={handleCopyLink}
            >
              {copied ? '✓ Copied!' : '📋 Copy Link'}
            </button>
          </div>
          <div className="stats-section">
            <div className="stat-item">
              <span className="label">Users:</span>
              <span className="count">{clientCount}</span>
            </div>
            <div className="stat-item">
              <span className="label">Downloads:</span>
              <span className="count active">{totalActiveDownloads}</span>
            </div>
          </div>
        </div>

        <div className="main-content">
          <div className="files-section">
            <div 
              className={`drop-zone ${isDragging ? 'dragging' : ''} ${files.length > 0 ? 'has-files' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileInput}
                style={{ display: 'none' }}
              />
              <div className="drop-zone-content">
                <span className="drop-icon">📂</span>
                <p className="drop-text">
                  {isDragging 
                    ? 'Drop files here!' 
                    : 'Drag & drop files here or click to browse'}
                </p>
                <p className="drop-hint">Files are shared directly from your device</p>
              </div>
            </div>

            {files.length > 0 && (
              <div className="files-list">
                <h3>📋 Shared Files ({files.length})</h3>
                <div className="files-grid">
                  {files.map(file => {
                    const activePeers = peerCounts[file.id] || 0;
                    return (
                      <div key={file.id} className={`file-card ${activePeers > 0 ? 'transferring' : ''}`}>
                        {/* Peer indicator badge */}
                        {activePeers > 0 && (
                          <div className="peer-badge" title={`${activePeers} peer(s) downloading`}>
                            <span className="peer-icon">👥</span>
                            <span className="peer-count">{activePeers}</span>
                          </div>
                        )}
                        <div className="file-icon">{getFileIcon(file.type)}</div>
                        <div className="file-info">
                          <span className="file-name" title={file.name}>{file.name}</span>
                          <span className="file-size">{formatFileSize(file.size)}</span>
                          {activePeers > 0 && (
                            <span className="transfer-status">
                              ↑ Uploading to {activePeers} peer{activePeers > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        <button 
                          className="remove-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFile(file.id);
                          }}
                          title="Remove file"
                          disabled={activePeers > 0}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="activity-section">
            <h3>📊 Activity Log</h3>
            <div className="activity-log">
              {transferLog.length === 0 ? (
                <p className="no-activity">No activity yet...</p>
              ) : (
                transferLog.map((log, index) => (
                  <div key={index} className={`log-entry ${log.type}`}>
                    <span className="log-time">{log.timestamp}</span>
                    <span className="log-message">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="warning-banner">
          ⚠️ Keep this tab open to allow file transfers. Files are shared directly from your device.
        </div>
      </div>
    </div>
  );
}

export default HostRoom;
