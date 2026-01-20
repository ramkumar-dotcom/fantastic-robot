import { io } from 'socket.io-client';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://192.168.1.6:3001';

class SocketService {
  constructor() {
    this.socket = null;
  }

  connect() {
    // If socket exists but not connected, destroy it completely
    if (this.socket && !this.socket.connected) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    // Return existing connected socket
    if (this.socket?.connected) {
      return this.socket;
    }

    // Create fresh socket with unique timestamp to prevent session reuse
    this.socket = io(SOCKET_URL, {
      transports: ['polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      query: { t: Date.now() }, // Unique query param prevents session caching
    });

    this.socket.on('connect', () => {
      console.log('Socket connected:', this.socket.id);
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
    });

    this.socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      
      // Handle "session id unknown" error by creating completely new socket
      if (error.message && error.message.includes('session')) {
        console.log('Session error detected, creating fresh connection...');
        this.socket.removeAllListeners();
        this.socket.disconnect();
        this.socket = null;
        // Reconnect after small delay
        setTimeout(() => this.connect(), 500);
      }
    });

    this.socket.on('reconnect_error', (error) => {
      console.error('Socket reconnection error:', error);
      // Force fresh connection on reconnect errors
      if (error.message && error.message.includes('session')) {
        this.socket.io.opts.query = { t: Date.now() };
      }
    });

    this.socket.on('reconnect_failed', () => {
      console.error('Socket reconnection failed, will create fresh connection');
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  emit(event, data) {
    if (this.socket?.connected) {
      this.socket.emit(event, data);
    }
  }

  on(event, callback) {
    if (this.socket) {
      this.socket.on(event, callback);
    }
  }

  off(event, callback) {
    if (this.socket) {
      this.socket.off(event, callback);
    }
  }

  getSocket() {
    return this.socket;
  }
}

const socketService = new SocketService();
export default socketService;
