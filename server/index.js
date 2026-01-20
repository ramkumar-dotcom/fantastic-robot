require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  cookie: false,
  // Disable connection state recovery to prevent session id unknown errors
  connectionStateRecovery: {
    maxDisconnectionDuration: 0,
    skipMiddlewares: true
  }
});

app.use(cors());
app.use(express.json());

// Store active rooms
// { roomId: { hostSocketId, files: [], clients: [], activeDownloads: Map<fileId, Set<clientId>> } }
const rooms = new Map();

// Helper to get download counts per file
function getFileDownloadCounts(room) {
  const counts = {};
  if (room && room.activeDownloads) {
    for (const [fileId, clients] of room.activeDownloads) {
      counts[fileId] = clients.size;
    }
  }
  return counts;
}

// Helper to notify host about peer counts
function notifyHostPeerCounts(roomId) {
  const room = rooms.get(roomId);
  if (room && room.hostSocketId) {
    const counts = getFileDownloadCounts(room);
    io.to(room.hostSocketId).emit('peer-counts-updated', { counts });
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

// Create a new room
app.post('/api/rooms', (req, res) => {
  const roomId = uuidv4().substring(0, 8);
  res.json({ roomId });
});

// Check if room exists and has a host
app.get('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  
  if (room && room.hostSocketId) {
    res.json({ 
      exists: true, 
      hasHost: true,
      fileCount: room.files.length 
    });
  } else {
    res.json({ exists: false, hasHost: false });
  }
});

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Host creates/joins a room
  socket.on('host-room', ({ roomId }) => {
    console.log(`Host joining room: ${roomId}`);
    
    // Leave any previous rooms
    socket.rooms.forEach(room => {
      if (room !== socket.id) {
        socket.leave(room);
      }
    });

    socket.join(roomId);
    
    rooms.set(roomId, {
      hostSocketId: socket.id,
      files: [],
      clients: [],
      activeDownloads: new Map() // fileId -> Set of clientIds
    });

    socket.roomId = roomId;
    socket.isHost = true;

    socket.emit('room-created', { roomId });
    console.log(`Room ${roomId} created by host ${socket.id}`);
  });

  // Host updates file list
  socket.on('update-files', ({ roomId, files }) => {
    const room = rooms.get(roomId);
    if (room && room.hostSocketId === socket.id) {
      room.files = files;
      // Notify all clients in the room about new file list
      socket.to(roomId).emit('files-updated', { files });
      console.log(`Files updated in room ${roomId}:`, files.length, 'files');
    }
  });

  // Client joins a room
  socket.on('join-room', ({ roomId }) => {
    console.log(`Client ${socket.id} attempting to join room: ${roomId}`);
    
    const room = rooms.get(roomId);
    if (!room || !room.hostSocketId) {
      socket.emit('room-error', { message: 'Room does not exist or host is offline' });
      return;
    }

    socket.join(roomId);
    socket.roomId = roomId;
    socket.isHost = false;
    socket.downloadingFiles = new Set(); // Track which files this client is downloading
    room.clients.push(socket.id);

    // Send current file list to the client
    socket.emit('room-joined', { 
      roomId, 
      files: room.files 
    });

    // Notify host about new client
    io.to(room.hostSocketId).emit('client-joined', { 
      clientId: socket.id 
    });

    console.log(`Client ${socket.id} joined room ${roomId}`);
  });

  // WebRTC Signaling: Offer
  socket.on('webrtc-offer', ({ targetId, offer, fileId }) => {
    io.to(targetId).emit('webrtc-offer', {
      senderId: socket.id,
      offer,
      fileId
    });
  });

  // WebRTC Signaling: Answer
  socket.on('webrtc-answer', ({ targetId, answer, fileId }) => {
    io.to(targetId).emit('webrtc-answer', {
      senderId: socket.id,
      answer,
      fileId
    });
  });

  // WebRTC Signaling: ICE Candidate
  socket.on('webrtc-ice-candidate', ({ targetId, candidate, fileId }) => {
    io.to(targetId).emit('webrtc-ice-candidate', {
      senderId: socket.id,
      candidate,
      fileId
    });
  });

  // Client requests file download - track as active download
  socket.on('request-file', ({ roomId, fileId }) => {
    const room = rooms.get(roomId);
    if (room && room.hostSocketId) {
      console.log(`File request from ${socket.id} for file ${fileId}`);
      
      // Track this download
      if (!room.activeDownloads.has(fileId)) {
        room.activeDownloads.set(fileId, new Set());
      }
      room.activeDownloads.get(fileId).add(socket.id);
      
      // Track on socket for cleanup
      if (!socket.downloadingFiles) {
        socket.downloadingFiles = new Set();
      }
      socket.downloadingFiles.add(fileId);
      
      // Notify host about updated peer counts
      notifyHostPeerCounts(roomId);
      
      // Forward request to host
      io.to(room.hostSocketId).emit('file-requested', {
        clientId: socket.id,
        fileId
      });
    }
  });

  // Client finished downloading a file
  socket.on('download-complete', ({ roomId, fileId }) => {
    const room = rooms.get(roomId);
    if (room) {
      // Remove from active downloads
      const clients = room.activeDownloads.get(fileId);
      if (clients) {
        clients.delete(socket.id);
        if (clients.size === 0) {
          room.activeDownloads.delete(fileId);
        }
      }
      
      // Remove from socket tracking
      if (socket.downloadingFiles) {
        socket.downloadingFiles.delete(fileId);
      }
      
      // Notify host
      notifyHostPeerCounts(roomId);
      
      console.log(`Download complete: ${socket.id} finished ${fileId}`);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    
    if (socket.isHost && socket.roomId) {
      const room = rooms.get(socket.roomId);
      if (room) {
        socket.to(socket.roomId).emit('host-disconnected');
        rooms.delete(socket.roomId);
        console.log(`Room ${socket.roomId} deleted - host disconnected`);
      }
    } else if (socket.roomId) {
      const room = rooms.get(socket.roomId);
      if (room) {
        room.clients = room.clients.filter(id => id !== socket.id);
        
        // Clean up any active downloads for this client
        if (socket.downloadingFiles) {
          for (const fileId of socket.downloadingFiles) {
            const clients = room.activeDownloads.get(fileId);
            if (clients) {
              clients.delete(socket.id);
              if (clients.size === 0) {
                room.activeDownloads.delete(fileId);
              }
            }
          }
          // Notify host about updated counts
          notifyHostPeerCounts(socket.roomId);
        }
        
        // Notify host about client leaving
        io.to(room.hostSocketId).emit('client-left', {
          clientId: socket.id
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 P2P Share signaling server running on port ${PORT}`);
});
