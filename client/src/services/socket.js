const API_URL = process.env.REACT_APP_API_URL || 'http://192.168.1.6:3001';
const POLL_INTERVAL = 2000; // 2 seconds for faster signaling

// Generate unique client ID
function generateId() {
  return 'id_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

class ApiService {
  constructor() {
    this.clientId = generateId();
    this.hostId = null;
    this.roomId = null;
    this.isHost = false;
    this.pollTimer = null;
    this.listeners = new Map();
    this.connected = false;
    this.pollFn = null; // Store poll function for manual triggering
  }

  // Event emitter pattern
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => cb(data));
    }
  }

  async fetch(endpoint, options = {}) {
    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      });
      return await response.json();
    } catch (error) {
      console.error('API error:', error);
      throw error;
    }
  }

  // Host: Register and start polling
  async hostRoom(roomId) {
    this.roomId = roomId;
    this.isHost = true;
    
    try {
      await this.fetch(`/api/rooms/${roomId}/host`, {
        method: 'POST',
        body: JSON.stringify({ hostId: this.clientId })
      });
      
      this.connected = true;
      this.emit('connect', { id: this.clientId });
      this.emit('room-created', { roomId });
      this.startHostPolling();
      
      return true;
    } catch (error) {
      this.emit('connect_error', error);
      return false;
    }
  }

  // Client: Join room and start polling
  async joinRoom(roomId) {
    this.roomId = roomId;
    this.isHost = false;
    
    try {
      const result = await this.fetch(`/api/rooms/${roomId}/join`, {
        method: 'POST',
        body: JSON.stringify({ clientId: this.clientId })
      });
      
      if (result.error) {
        this.emit('room-error', { message: result.error });
        return false;
      }
      
      this.hostId = result.hostId; // Store host ID for signaling
      this.connected = true;
      this.emit('connect', { id: this.clientId });
      this.emit('room-joined', { roomId, files: result.files });
      this.startClientPolling();
      
      return true;
    } catch (error) {
      this.emit('room-error', { message: 'Failed to join room' });
      return false;
    }
  }

  // Host polling loop
  startHostPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    
    const poll = async () => {
      if (!this.roomId || !this.isHost) return;
      
      try {
        // Heartbeat
        await this.fetch(`/api/rooms/${this.roomId}/host`, {
          method: 'POST',
          body: JSON.stringify({ hostId: this.clientId })
        });
        
        // Get updates
        const data = await this.fetch(`/api/rooms/${this.roomId}/host/poll`);
        
        // Process signals
        if (data.signals && data.signals.length > 0) {
          for (const signal of data.signals) {
            this.handleSignal(signal);
          }
        }
        
        // Emit peer counts
        if (data.peerCounts) {
          this.emit('peer-counts-updated', { counts: data.peerCounts });
        }
        
        // Emit client count changes
        this.emit('client-count', { count: data.clientCount || 0 });
        
      } catch (error) {
        console.error('Host poll error:', error);
      }
    };
    
    this.pollFn = poll; // Store for manual triggering
    poll(); // Initial poll
    this.pollTimer = setInterval(poll, POLL_INTERVAL);
  }

  // Client polling loop
  startClientPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    
    let lastFilesUpdatedAt = 0;
    
    const poll = async () => {
      if (!this.roomId || this.isHost) return;
      
      try {
        const data = await this.fetch(`/api/rooms/${this.roomId}/client/${this.clientId}/poll`);
        
        if (data.error || !data.hostOnline) {
          this.emit('host-disconnected', {});
          this.stopPolling();
          return;
        }
        
        // Update hostId if provided
        if (data.hostId) {
          this.hostId = data.hostId;
        }
        
        // Process signals
        if (data.signals && data.signals.length > 0) {
          for (const signal of data.signals) {
            this.handleSignal(signal);
          }
        }
        
        // Check for file updates
        if (data.filesUpdatedAt && data.filesUpdatedAt > lastFilesUpdatedAt) {
          lastFilesUpdatedAt = data.filesUpdatedAt;
          this.emit('files-updated', { files: data.files });
        }
        
      } catch (error) {
        console.error('Client poll error:', error);
      }
    };
    
    this.pollFn = poll; // Store for manual triggering
    poll(); // Initial poll
    this.pollTimer = setInterval(poll, POLL_INTERVAL);
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  handleSignal(signal) {
    switch (signal.type) {
      case 'file-request':
        this.emit('file-requested', { clientId: signal.fromId, fileId: signal.fileId });
        break;
      case 'offer':
        this.emit('webrtc-offer', { senderId: signal.fromId, offer: signal.data, fileId: signal.fileId });
        break;
      case 'answer':
        this.emit('webrtc-answer', { senderId: signal.fromId, answer: signal.data, fileId: signal.fileId });
        break;
      case 'ice-candidate':
        this.emit('webrtc-ice-candidate', { senderId: signal.fromId, candidate: signal.data, fileId: signal.fileId });
        break;
      default:
        console.log('Unknown signal type:', signal.type);
    }
  }

  // Send WebRTC signal
  async sendSignal(toId, type, data, fileId) {
    if (!this.roomId) return;
    
    try {
      await this.fetch(`/api/rooms/${this.roomId}/signal`, {
        method: 'POST',
        body: JSON.stringify({
          fromId: this.clientId,
          toId,
          type,
          data,
          fileId
        })
      });
    } catch (error) {
      console.error('Error sending signal:', error);
    }
  }

  // Update files (host only)
  async updateFiles(files) {
    if (!this.roomId) return;
    
    await this.fetch(`/api/rooms/${this.roomId}/files`, {
      method: 'POST',
      body: JSON.stringify({ files })
    });
  }

  // Request file download (client only)
  async requestFile(fileId) {
    if (!this.roomId) return;
    
    await this.fetch(`/api/rooms/${this.roomId}/request-file`, {
      method: 'POST',
      body: JSON.stringify({ clientId: this.clientId, fileId })
    });
    
    // Trigger immediate poll to get the offer faster
    if (this.pollFn) {
      setTimeout(() => this.pollFn(), 500);
    }
  }
  
  // Trigger an immediate poll
  triggerPoll() {
    if (this.pollFn) {
      this.pollFn();
    }
  }

  // Notify download complete
  async downloadComplete(fileId) {
    if (!this.roomId) return;
    
    await this.fetch(`/api/rooms/${this.roomId}/download-complete`, {
      method: 'POST',
      body: JSON.stringify({ clientId: this.clientId, fileId })
    });
  }

  // Disconnect
  async disconnect() {
    this.stopPolling();
    
    if (this.roomId) {
      try {
        if (this.isHost) {
          await this.fetch(`/api/rooms/${this.roomId}/close`, { method: 'POST' });
        } else {
          await this.fetch(`/api/rooms/${this.roomId}/leave`, {
            method: 'POST',
            body: JSON.stringify({ clientId: this.clientId })
          });
        }
      } catch (e) {
        // Ignore errors on disconnect
      }
    }
    
    this.roomId = null;
    this.hostId = null;
    this.isHost = false;
    this.connected = false;
    this.pollFn = null;
    this.listeners.clear();
  }

  getId() {
    return this.clientId;
  }

  getHostId() {
    return this.hostId;
  }

  isConnected() {
    return this.connected;
  }
}

const apiService = new ApiService();
export default apiService;
