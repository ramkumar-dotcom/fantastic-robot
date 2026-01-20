// WebRTC configuration with STUN servers for NAT traversal
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ]
};

// Chunk size for file transfer (64KB - optimal for WebRTC)
const CHUNK_SIZE = 65536;

// Buffer thresholds
const MAX_BUFFER_SIZE = 2 * 1024 * 1024;
const LOW_BUFFER_THRESHOLD = 512 * 1024;

/**
 * Adaptive Bandwidth Scheduler
 */
class AdaptiveScheduler {
  constructor() {
    this.transfers = new Map();
    this.isRunning = false;
    this.timeoutId = null;
  }

  addTransfer(key, transfer) {
    this.transfers.set(key, transfer);
    console.log(`[Scheduler] Added: ${transfer.fileName}, active transfers: ${this.transfers.size}`);
    this.start();
  }

  removeTransfer(key) {
    this.transfers.delete(key);
    console.log(`[Scheduler] Removed transfer, active: ${this.transfers.size}`);
    if (this.transfers.size === 0) {
      this.stop();
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.tick();
  }

  stop() {
    this.isRunning = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  tick() {
    if (!this.isRunning || this.transfers.size === 0) {
      this.isRunning = false;
      return;
    }

    const activeTransfers = [];
    for (const transfer of this.transfers.values()) {
      if (!transfer.completed && 
          transfer.dataChannel.readyState === 'open' &&
          transfer.dataChannel.bufferedAmount < MAX_BUFFER_SIZE) {
        activeTransfers.push(transfer);
      }
    }

    if (activeTransfers.length > 0) {
      const chunksPerTransfer = Math.max(1, Math.floor(16 / activeTransfers.length));
      for (const transfer of activeTransfers) {
        this.sendChunks(transfer, chunksPerTransfer);
      }
    }

    let shouldContinue = false;
    for (const transfer of this.transfers.values()) {
      if (!transfer.completed) {
        shouldContinue = true;
        break;
      }
    }

    if (shouldContinue) {
      this.timeoutId = setTimeout(() => this.tick(), 1);
    } else {
      this.isRunning = false;
    }
  }

  sendChunks(transfer, maxChunks) {
    const { dataChannel, arrayBuffer, totalSize } = transfer;
    let chunksSent = 0;

    while (chunksSent < maxChunks && transfer.offset < totalSize) {
      if (dataChannel.bufferedAmount >= MAX_BUFFER_SIZE) {
        break;
      }

      const end = Math.min(transfer.offset + CHUNK_SIZE, totalSize);
      const chunk = arrayBuffer.slice(transfer.offset, end);

      try {
        dataChannel.send(chunk);
        transfer.offset = end;
        transfer.chunksSent++;
        chunksSent++;
      } catch (error) {
        console.warn('Send buffer full, will retry');
        break;
      }
    }

    if (transfer.offset >= totalSize && !transfer.completed) {
      this.finalizeTransfer(transfer);
    }

    return chunksSent;
  }

  finalizeTransfer(transfer) {
    transfer.completed = true;

    const elapsed = (Date.now() - transfer.startTime) / 1000;
    const sizeMB = transfer.totalSize / 1024 / 1024;
    const speed = elapsed > 0 ? sizeMB / elapsed : 0;

    console.log(`[Scheduler] Complete: ${transfer.fileName} - ${sizeMB.toFixed(2)}MB in ${elapsed.toFixed(2)}s (${speed.toFixed(2)} MB/s)`);

    const sendComplete = () => {
      if (transfer.dataChannel.readyState !== 'open') {
        if (transfer.onComplete) transfer.onComplete();
        return;
      }

      if (transfer.dataChannel.bufferedAmount < 1000) {
        try {
          transfer.dataChannel.send(JSON.stringify({ type: 'complete' }));
        } catch (e) {
          console.warn('Could not send complete message');
        }
        if (transfer.onComplete) transfer.onComplete();
      } else {
        setTimeout(sendComplete, 10);
      }
    };

    sendComplete();
  }

  cleanup() {
    this.stop();
    this.transfers.clear();
  }
}

const scheduler = new AdaptiveScheduler();

export class WebRTCHost {
  constructor(socket, files) {
    this.socket = socket;
    this.files = files;
    this.peerConnections = new Map();
    this.setupSocketListeners();
  }

  setupSocketListeners() {
    this.socket.on('webrtc-answer', async ({ senderId, answer, fileId }) => {
      const key = `${senderId}-${fileId}`;
      const pc = this.peerConnections.get(key);
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (error) {
          console.error('Error setting remote description:', error);
        }
      }
    });

    this.socket.on('webrtc-ice-candidate', async ({ senderId, candidate, fileId }) => {
      const key = `${senderId}-${fileId}`;
      const pc = this.peerConnections.get(key);
      if (pc && candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error('Error adding ICE candidate:', error);
        }
      }
    });

    this.socket.on('file-requested', ({ clientId, fileId }) => {
      console.log(`File requested: ${fileId} by ${clientId}`);
      this.initiateFileTransfer(clientId, fileId);
    });
  }

  updateFiles(files) {
    this.files = files;
  }

  async initiateFileTransfer(clientId, fileId) {
    const file = this.files.get(fileId);
    if (!file) {
      console.error('File not found:', fileId);
      return;
    }

    const key = `${clientId}-${fileId}`;
    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peerConnections.set(key, pc);

    const dataChannel = pc.createDataChannel('fileTransfer', {
      ordered: true
    });

    dataChannel.binaryType = 'arraybuffer';
    dataChannel.bufferedAmountLowThreshold = LOW_BUFFER_THRESHOLD;

    dataChannel.onopen = async () => {
      console.log(`Channel open for: ${file.name}`);
      await this.startTransfer(dataChannel, file, key);
    };

    dataChannel.onerror = (error) => {
      console.error('Channel error:', error);
      scheduler.removeTransfer(key);
    };

    dataChannel.onclose = () => {
      scheduler.removeTransfer(key);
      pc.close();
      this.peerConnections.delete(key);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('webrtc-ice-candidate', {
          targetId: clientId,
          candidate: event.candidate,
          fileId
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        scheduler.removeTransfer(key);
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.socket.emit('webrtc-offer', {
        targetId: clientId,
        offer: pc.localDescription,
        fileId
      });
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  }

  async startTransfer(dataChannel, file, transferKey) {
    dataChannel.send(JSON.stringify({
      type: 'metadata',
      name: file.name,
      size: file.size,
      mimeType: file.type
    }));

    const arrayBuffer = await file.arrayBuffer();

    console.log(`[Host] Starting: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

    const transfer = {
      dataChannel,
      arrayBuffer,
      totalSize: arrayBuffer.byteLength,
      offset: 0,
      chunksSent: 0,
      fileName: file.name,
      startTime: Date.now(),
      completed: false,
      onComplete: () => scheduler.removeTransfer(transferKey)
    };

    scheduler.addTransfer(transferKey, transfer);
  }

  cleanup() {
    scheduler.cleanup();
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();
    this.socket.off('webrtc-answer');
    this.socket.off('webrtc-ice-candidate');
    this.socket.off('file-requested');
  }
}

export class WebRTCClient {
  constructor(socket, onProgress, onComplete, onError) {
    this.socket = socket;
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    this.onError = onError;
    this.peerConnections = new Map();
    this.fileBuffers = new Map();
    this.currentRoomId = null; // Track room ID for download-complete notification
    this.setupSocketListeners();
  }

  setupSocketListeners() {
    this.socket.on('webrtc-offer', async ({ senderId, offer, fileId }) => {
      await this.handleOffer(senderId, offer, fileId);
    });

    this.socket.on('webrtc-ice-candidate', async ({ senderId, candidate, fileId }) => {
      const key = `${senderId}-${fileId}`;
      const pc = this.peerConnections.get(key);
      if (pc && candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error('Error adding ICE candidate:', error);
        }
      }
    });
  }

  async handleOffer(hostId, offer, fileId) {
    const key = `${hostId}-${fileId}`;
    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peerConnections.set(key, pc);

    this.fileBuffers.set(fileId, {
      metadata: null,
      chunks: [],
      receivedSize: 0,
      startTime: null
    });

    pc.ondatachannel = (event) => {
      const dc = event.channel;
      dc.binaryType = 'arraybuffer';
      dc.onmessage = (e) => this.handleMessage(fileId, e.data);
      dc.onerror = (err) => {
        console.error('Channel error:', err);
        if (this.onError) this.onError(fileId, err);
      };
      dc.onclose = () => {
        pc.close();
        this.peerConnections.delete(key);
      };
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('webrtc-ice-candidate', {
          targetId: hostId,
          candidate: event.candidate,
          fileId
        });
      }
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.socket.emit('webrtc-answer', {
        targetId: hostId,
        answer: pc.localDescription,
        fileId
      });
    } catch (error) {
      console.error('Error handling offer:', error);
      if (this.onError) this.onError(fileId, error);
    }
  }

  handleMessage(fileId, data) {
    const buffer = this.fileBuffers.get(fileId);
    if (!buffer) return;

    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'metadata') {
          buffer.metadata = msg;
          buffer.startTime = Date.now();
          console.log(`[Client] Receiving: ${msg.name} (${(msg.size / 1024 / 1024).toFixed(2)} MB)`);
        } else if (msg.type === 'complete') {
          this.downloadFile(fileId);
        }
      } catch (e) {
        console.error('Parse error:', e);
      }
    } else {
      buffer.chunks.push(data);
      buffer.receivedSize += data.byteLength;

      if (buffer.metadata && this.onProgress) {
        const progress = (buffer.receivedSize / buffer.metadata.size) * 100;
        this.onProgress(fileId, progress);
      }
    }
  }

  downloadFile(fileId) {
    const buffer = this.fileBuffers.get(fileId);
    if (!buffer?.metadata) return;

    const elapsed = (Date.now() - buffer.startTime) / 1000;
    const sizeMB = buffer.receivedSize / 1024 / 1024;
    const speed = elapsed > 0 ? sizeMB / elapsed : 0;

    console.log(`[Client] Complete: ${buffer.metadata.name} - ${sizeMB.toFixed(2)}MB in ${elapsed.toFixed(2)}s (${speed.toFixed(2)} MB/s)`);

    const blob = new Blob(buffer.chunks, { 
      type: buffer.metadata.mimeType || 'application/octet-stream' 
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buffer.metadata.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    this.fileBuffers.delete(fileId);
    
    // Notify server that download is complete
    if (this.currentRoomId) {
      this.socket.emit('download-complete', { 
        roomId: this.currentRoomId, 
        fileId 
      });
    }
    
    if (this.onComplete) this.onComplete(fileId, buffer.metadata.name);
  }

  requestFile(roomId, fileId) {
    this.currentRoomId = roomId; // Store roomId for download-complete
    this.socket.emit('request-file', { roomId, fileId });
  }

  cleanup() {
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();
    this.fileBuffers.clear();
    this.socket.off('webrtc-offer');
    this.socket.off('webrtc-ice-candidate');
  }
}
