# P2P Share - Secure Peer-to-Peer File Sharing

A real-time peer-to-peer file sharing platform where files are transferred directly between users without being uploaded to any server. Built with React, Node.js, Socket.io, and WebRTC.

## 🌟 Features

- **No Server Storage**: Files are never uploaded to a server - they transfer directly from the host's device
- **Secure Transfer**: WebRTC provides built-in DTLS encryption for all data transfers
- **Private Rooms**: Create unique room codes to share with specific people
- **Real-time Updates**: See connected users and file availability in real-time
- **Progress Tracking**: Monitor download progress for each file
- **Drag & Drop**: Easy file selection with drag-and-drop support
- **Cross-Platform**: Works on any modern browser with WebRTC support

## 🏗️ Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   Host Browser  │         │  Client Browser │
│                 │         │                 │
│  ┌───────────┐  │         │  ┌───────────┐  │
│  │   Files   │  │◄───────►│  │ Downloads │  │
│  └───────────┘  │  WebRTC │  └───────────┘  │
│                 │  (P2P)  │                 │
└────────┬────────┘         └────────┬────────┘
         │                           │
         │    Socket.io Signaling    │
         │         (WebSocket)       │
         │                           │
         └───────────┬───────────────┘
                     │
              ┌──────▼──────┐
              │   Server    │
              │ (Signaling  │
              │    Only)    │
              └─────────────┘
```

## 📁 Project Structure

```
p2p-share/
├── server/                 # Node.js signaling server
│   ├── index.js           # Express + Socket.io server
│   ├── package.json
│   └── .env               # Environment variables
│
├── client/                # React frontend
│   ├── public/
│   │   └── index.html
│   └── src/
│       ├── App.js         # Main app with routing
│       ├── components/
│       │   ├── Home.js    # Landing page
│       │   ├── HostRoom.js # File sharing view
│       │   └── ClientRoom.js # File downloading view
│       ├── services/
│       │   ├── socket.js  # Socket.io client
│       │   └── webrtc.js  # WebRTC peer connections
│       └── utils/
│           └── fileUtils.js
│
└── README.md
```

## 🚀 Getting Started

### Prerequisites

- Node.js 16+ installed
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   cd /path/to/project
   ```

2. **Install server dependencies**
   ```bash
   cd server
   npm install
   ```

3. **Install client dependencies**
   ```bash
   cd ../client
   npm install
   ```

### Running the Application

1. **Start the signaling server** (Terminal 1)
   ```bash
   cd server
   npm start
   ```
   Server runs on http://localhost:3001

2. **Start the React client** (Terminal 2)
   ```bash
   cd client
   npm start
   ```
   Client runs on http://localhost:3000

## 📖 How to Use

### Sharing Files (Host)

1. Go to http://localhost:3000
2. Click "Create Room" to create a new private space
3. Share the room URL or room code with people you want to share files with
4. Drag & drop files or click to browse and select files
5. **Keep the browser tab open** - files are served from your device!

### Downloading Files (Client)

1. Click the shared link or enter the room code on the home page
2. You'll see a list of available files
3. Click "Download" on any file to start the P2P transfer
4. Watch the progress bar as the file downloads directly from the host

## 🔧 Configuration

### Server Environment Variables (.env)

```env
PORT=3001
CLIENT_URL=http://localhost:3000
```

### Client Environment Variables (.env)

```env
REACT_APP_API_URL=http://localhost:3001
REACT_APP_SOCKET_URL=http://localhost:3001
```

## 🔒 Security

- **DTLS Encryption**: All WebRTC data channels use DTLS (Datagram Transport Layer Security)
- **P2P Transfer**: Files never touch the server - direct browser-to-browser transfer
- **No Storage**: Server only facilitates connection establishment, no file data is stored
- **Room Codes**: Short-lived room codes for access control

## 🛠️ Technical Details

### WebRTC Data Channels

- Uses ordered, reliable data channels for file transfer
- Chunk size: 16KB (optimal for WebRTC)
- Automatic flow control with bufferedAmount checking

### Signaling Flow

1. Host creates room → Server assigns room ID
2. Client joins room → Server notifies host
3. Client requests file → Host creates RTCPeerConnection
4. ICE candidates and SDP exchanged via Socket.io
5. Direct P2P connection established
6. File transferred in chunks via data channel

### STUN Servers

Uses Google's public STUN servers for NAT traversal:
- stun:stun.l.google.com:19302
- stun:stun1.l.google.com:19302
- stun:stun2.l.google.com:19302

## ⚠️ Limitations

- Host must keep browser tab open for transfers
- Large files may take time over slow connections
- May not work behind symmetric NATs (consider adding TURN server)
- Browser must support WebRTC (all modern browsers do)

## 🚀 Production Deployment

For production use, consider:

1. **Add TURN Server**: For users behind restrictive NATs
   ```javascript
   const ICE_SERVERS = {
     iceServers: [
       { urls: 'stun:stun.l.google.com:19302' },
       { 
         urls: 'turn:your-turn-server.com:3478',
         username: 'user',
         credential: 'password'
       }
     ]
   };
   ```

2. **Enable HTTPS**: Required for WebRTC in production
3. **Add Rate Limiting**: Prevent abuse of signaling server
4. **Room Expiration**: Auto-delete inactive rooms
5. **Authentication**: Add user authentication if needed

## 📝 License

MIT License - feel free to use this project for learning or building your own applications.

## 🤝 Contributing

Contributions are welcome! Feel free to submit issues and pull requests.

---

Built with ❤️ using React, Node.js, Socket.io, and WebRTC
# fantastic-robot
