require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();

app.use(cors());
app.use(express.json());

// Store active rooms
// { roomId: { hostId, hostLastSeen, files: [], clients: Map<clientId, {lastSeen, signals: []}>, signals: [], activeDownloads: Map<fileId, Set<clientId>> } }
const rooms = new Map();

// Cleanup stale rooms and clients (older than 30 seconds)
const STALE_TIMEOUT = 30000;
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    // Check if host is stale
    if (now - room.hostLastSeen > STALE_TIMEOUT) {
      console.log(`Room ${roomId} deleted - host timeout`);
      rooms.delete(roomId);
      continue;
    }
    // Check for stale clients
    for (const [clientId, client] of room.clients) {
      if (now - client.lastSeen > STALE_TIMEOUT) {
        console.log(`Client ${clientId} removed - timeout`);
        room.clients.delete(clientId);
        // Clean up active downloads
        for (const [fileId, downloaders] of room.activeDownloads) {
          downloaders.delete(clientId);
          if (downloaders.size === 0) {
            room.activeDownloads.delete(fileId);
          }
        }
      }
    }
  }
}, 10000);

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
  
  if (room && room.hostId) {
    res.json({ 
      exists: true, 
      hasHost: true,
      fileCount: room.files.length 
    });
  } else {
    res.json({ exists: false, hasHost: false });
  }
});

// Host registers/heartbeat
app.post('/api/rooms/:roomId/host', (req, res) => {
  const { roomId } = req.params;
  const { hostId } = req.body;
  
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      hostId,
      hostLastSeen: Date.now(),
      files: [],
      clients: new Map(),
      hostSignals: [], // Signals for the host to receive
      activeDownloads: new Map()
    };
    rooms.set(roomId, room);
    console.log(`Room ${roomId} created by host ${hostId}`);
  } else {
    room.hostId = hostId;
    room.hostLastSeen = Date.now();
  }
  
  res.json({ success: true, roomId });
});

// Host polls for updates
app.get('/api/rooms/:roomId/host/poll', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  room.hostLastSeen = Date.now();
  
  // Get signals for host and clear them
  const signals = room.hostSignals || [];
  room.hostSignals = [];
  
  // Get client count
  const clientCount = room.clients.size;
  
  // Get peer counts
  const peerCounts = getFileDownloadCounts(room);
  
  res.json({ 
    signals, 
    clientCount,
    peerCounts,
    clients: Array.from(room.clients.keys())
  });
});

// Host updates file list
app.post('/api/rooms/:roomId/files', (req, res) => {
  const { roomId } = req.params;
  const { files } = req.body;
  
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  room.files = files;
  room.filesUpdatedAt = Date.now();
  console.log(`Files updated in room ${roomId}:`, files.length, 'files');
  
  res.json({ success: true });
});

// Client joins room
app.post('/api/rooms/:roomId/join', (req, res) => {
  const { roomId } = req.params;
  const { clientId } = req.body;
  
  const room = rooms.get(roomId);
  if (!room || !room.hostId) {
    return res.status(404).json({ error: 'Room not found or host offline' });
  }
  
  if (!room.clients.has(clientId)) {
    room.clients.set(clientId, {
      lastSeen: Date.now(),
      signals: [],
      filesVersion: 0
    });
    console.log(`Client ${clientId} joined room ${roomId}`);
  } else {
    room.clients.get(clientId).lastSeen = Date.now();
  }
  
  res.json({ 
    success: true, 
    files: room.files,
    hostId: room.hostId,
    hostOnline: true
  });
});

// Client polls for updates
app.get('/api/rooms/:roomId/client/:clientId/poll', (req, res) => {
  const { roomId, clientId } = req.params;
  
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found', hostOnline: false });
  }
  
  let client = room.clients.get(clientId);
  if (!client) {
    // Re-register client
    client = {
      lastSeen: Date.now(),
      signals: [],
      filesVersion: 0
    };
    room.clients.set(clientId, client);
    console.log(`Client ${clientId} re-registered in room ${roomId}`);
  } else {
    client.lastSeen = Date.now();
  }
  
  // Check if host is still online
  const hostOnline = (Date.now() - room.hostLastSeen) < STALE_TIMEOUT;
  
  // Get signals for this client and clear them
  const signals = client.signals || [];
  client.signals = [];
  
  res.json({ 
    signals, 
    files: room.files,
    hostOnline,
    hostId: room.hostId, // Send hostId so client knows who to send signals to
    filesUpdatedAt: room.filesUpdatedAt || 0
  });
});

// Send WebRTC signal (works for both host and client)
app.post('/api/rooms/:roomId/signal', (req, res) => {
  const { roomId } = req.params;
  const { fromId, toId, type, data, fileId } = req.body;
  
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const signal = { fromId, type, data, fileId, timestamp: Date.now() };
  
  // If sending to host
  if (toId === room.hostId || toId === 'host') {
    room.hostSignals = room.hostSignals || [];
    room.hostSignals.push(signal);
  } else {
    // Sending to a client
    const client = room.clients.get(toId);
    if (client) {
      client.signals = client.signals || [];
      client.signals.push(signal);
    }
  }
  
  res.json({ success: true });
});

// Client requests file download
app.post('/api/rooms/:roomId/request-file', (req, res) => {
  const { roomId } = req.params;
  const { clientId, fileId } = req.body;
  
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  // Track this download
  if (!room.activeDownloads.has(fileId)) {
    room.activeDownloads.set(fileId, new Set());
  }
  room.activeDownloads.get(fileId).add(clientId);
  
  // Add signal to host
  room.hostSignals = room.hostSignals || [];
  room.hostSignals.push({
    type: 'file-request',
    fromId: clientId,
    fileId,
    timestamp: Date.now()
  });
  
  console.log(`File request from ${clientId} for file ${fileId}`);
  res.json({ success: true });
});

// Client finished downloading
app.post('/api/rooms/:roomId/download-complete', (req, res) => {
  const { roomId } = req.params;
  const { clientId, fileId } = req.body;
  
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  // Remove from active downloads
  const downloaders = room.activeDownloads.get(fileId);
  if (downloaders) {
    downloaders.delete(clientId);
    if (downloaders.size === 0) {
      room.activeDownloads.delete(fileId);
    }
  }
  
  console.log(`Download complete: ${clientId} finished ${fileId}`);
  res.json({ success: true });
});

// Client leaves room
app.post('/api/rooms/:roomId/leave', (req, res) => {
  const { roomId } = req.params;
  const { clientId } = req.body;
  
  const room = rooms.get(roomId);
  if (room) {
    room.clients.delete(clientId);
    // Clean up active downloads
    for (const [fileId, downloaders] of room.activeDownloads) {
      downloaders.delete(clientId);
      if (downloaders.size === 0) {
        room.activeDownloads.delete(fileId);
      }
    }
  }
  
  res.json({ success: true });
});

// Host leaves/closes room
app.post('/api/rooms/:roomId/close', (req, res) => {
  const { roomId } = req.params;
  rooms.delete(roomId);
  console.log(`Room ${roomId} closed`);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 P2P Share API server running on port ${PORT}`);
});
