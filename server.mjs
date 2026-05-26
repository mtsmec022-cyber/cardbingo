import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const port = Number(process.env.PORT || 4180);
const rooms = new Map();
const HOST_RECONNECT_GRACE_MS = 8000;
const normalizeRoomCode = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
};

const roomHasReconnectGrace = (room) => Boolean(room?.hostReconnectUntil && room.hostReconnectUntil > Date.now());
const getEffectiveHostCount = (room) => (room?.hosts.size || 0) > 0 ? room.hosts.size : (roomHasReconnectGrace(room) ? 1 : 0);
const clearHostReconnectGrace = (room) => {
  if (!room) return;
  if (room.hostReconnectTimer) {
    clearTimeout(room.hostReconnectTimer);
    room.hostReconnectTimer = null;
  }
  room.hostReconnectUntil = 0;
};

const buildRoomStatus = (code) => {
  const roomCode = normalizeRoomCode(code);
  const room = rooms.get(roomCode);
  const hostCount = getEffectiveHostCount(room);

  return {
    room: roomCode,
    valid: /^[A-Z0-9]{6}$/.test(roomCode),
    online: Boolean(room && hostCount > 0),
    hostCount,
    playerCount: room ? Array.from(room.players.values()).filter((player) => player.connected !== false).length : 0,
    gameActive: Boolean(room?.gameActive),
    currentBall: room?.currentBall || null,
  };
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/room/')) {
    const status = buildRoomStatus(url.pathname.split('/').pop() || '');
    res.writeHead(status.valid ? 200 : 400, {
      'Content-Type': contentTypes['.json'],
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(status));
    return;
  }

  const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(distDir, safePath);

  if (url.pathname === '/' || !path.extname(filePath)) {
    filePath = path.join(distDir, 'index.html');
  }

  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      fs.readFile(path.join(distDir, 'index.html'), (fallbackError, fallbackData) => {
        if (fallbackError) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': contentTypes['.html'] });
        res.end(fallbackData);
      });
      return;
    }

    res.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });

const getRoom = (code) => {
  const roomCode = normalizeRoomCode(code);
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, {
      hosts: new Set(),
      players: new Map(),
      gameActive: false,
      currentBall: null,
      lastHeartbeatAt: Date.now(),
      hostReconnectTimer: null,
      hostReconnectUntil: 0,
    });
  }
  return rooms.get(roomCode);
};

const getPlayerEntries = (room) => Array.from(room.players.entries());

const serializePlayer = (player) => ({
  id: player.id,
  name: player.name,
  cardId: player.cardId,
  card: player.card,
  ready: Boolean(player.ready),
  connected: Boolean(player.connected),
  joinedAt: player.joinedAt,
  lastSeenAt: player.lastSeenAt,
});

const findPlayerEntryById = (room, playerId) => (
  getPlayerEntries(room).find(([, player]) => player.id === playerId)
);

const sendJson = (socket, payload) => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
};

const broadcastRoom = (code) => {
  const room = rooms.get(code);
  if (!room) return;

  const payload = {
    type: 'room-update',
    room: code,
    players: Array.from(room.players.values()).map(serializePlayer),
    playerCount: Array.from(room.players.values()).filter((player) => player.connected !== false).length,
    hostCount: getEffectiveHostCount(room),
    gameActive: Boolean(room.gameActive),
    currentBall: room.currentBall,
  };

  for (const client of [...room.hosts, ...room.players.keys()]) {
    sendJson(client, payload);
  }
};

wss.on('connection', (socket) => {
  socket.meta = {};

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    const roomCode = normalizeRoomCode(message.room);
    if (!/^[A-Z0-9]{6}$/.test(roomCode)) return;

    const room = getRoom(roomCode);

    if (message.type === 'host-join') {
      socket.meta = { role: 'host', room: roomCode };
      clearHostReconnectGrace(room);
      room.hosts.add(socket);
      room.lastHeartbeatAt = Date.now();
      sendJson(socket, {
        type: 'host-ack',
        ...buildRoomStatus(roomCode),
        gameActive: Boolean(room.gameActive),
        currentBall: room.currentBall,
      });
      broadcastRoom(roomCode);
      return;
    }

    if (message.type === 'host-leave') {
      clearHostReconnectGrace(room);
      for (const playerSocket of room.players.keys()) {
        sendJson(playerSocket, {
          type: 'session-ended',
          room: roomCode,
        });
      }
      room.hosts.delete(socket);
      rooms.delete(roomCode);
      return;
    }

    if (message.type === 'host-heartbeat') {
      socket.meta = { role: 'host', room: roomCode };
      clearHostReconnectGrace(room);
      room.hosts.add(socket);
      room.lastHeartbeatAt = Date.now();
      return;
    }

    if (message.type === 'player-join') {
      const playerId = String(message.playerId || crypto.randomUUID());
      const existingEntry = findPlayerEntryById(room, playerId);
      const existingPlayer = existingEntry?.[1] || null;

      if (getEffectiveHostCount(room) <= 0) {
        sendJson(socket, { type: 'room-unavailable', ...buildRoomStatus(roomCode), reason: 'host-offline' });
        return;
      }

      if (room.gameActive && !existingPlayer) {
        sendJson(socket, { type: 'room-unavailable', ...buildRoomStatus(roomCode), reason: 'game-in-progress' });
        return;
      }

      const name = String(message.name || `Jogador ${room.players.size + 1}`).slice(0, 24);
      const card = Array.isArray(message.card) ? message.card.slice(0, 25).map(Number) : [];
      const cardId = String(message.cardId || playerId.slice(0, 6).toUpperCase()).slice(0, 12);
      socket.meta = { role: 'player', room: roomCode, playerId };

      if (existingEntry) {
        const [previousSocket, previousPlayer] = existingEntry;
        room.players.delete(previousSocket);
        previousSocket.meta = {};
        try {
          previousSocket.close();
        } catch {
          undefined;
        }
        room.players.set(socket, {
          ...previousPlayer,
          name: previousPlayer.name || name,
          cardId: previousPlayer.cardId || cardId,
          card: Array.isArray(previousPlayer.card) && previousPlayer.card.length ? previousPlayer.card : card,
          connected: true,
          lastSeenAt: Date.now(),
        });
      } else {
        room.players.set(socket, {
          id: playerId,
          name,
          cardId,
          card,
          ready: false,
          connected: true,
          joinedAt: Date.now(),
          lastSeenAt: Date.now(),
        });
      }

      const joinedPlayer = room.players.get(socket);
      sendJson(socket, {
        type: 'player-ack',
        ...buildRoomStatus(roomCode),
        playerId,
        player: serializePlayer(joinedPlayer),
        gameActive: Boolean(room.gameActive),
        currentBall: room.currentBall,
      });
      broadcastRoom(roomCode);
      return;
    }

    if (message.type === 'player-card-update') {
      const player = room.players.get(socket);
      if (!player) return;
      if (player.ready) return;
      const card = Array.isArray(message.card) ? message.card.slice(0, 25).map(Number) : player.card;
      const cardId = String(message.cardId || player.cardId).slice(0, 12);
      const name = String(message.name || player.name).slice(0, 24);
      room.players.set(socket, { ...player, name, cardId, card, ready: false, connected: true, lastSeenAt: Date.now() });
      broadcastRoom(roomCode);
      return;
    }

    if (message.type === 'player-ready') {
      const player = room.players.get(socket);
      if (!player) return;
      const card = Array.isArray(message.card) ? message.card.slice(0, 25).map(Number) : player.card;
      const cardId = String(message.cardId || player.cardId).slice(0, 12);
      const name = String(message.name || player.name).slice(0, 24);
      room.players.set(socket, { ...player, name, cardId, card, ready: true, connected: true, lastSeenAt: Date.now() });
      broadcastRoom(roomCode);
      return;
    }

    if (message.type === 'host-game-start') {
      room.gameActive = true;
      const payload = {
        type: 'game-start',
        room: roomCode,
        currentBall: room.currentBall,
      };
      for (const client of [...room.hosts, ...room.players.keys()]) {
        sendJson(client, payload);
      }
      broadcastRoom(roomCode);
      return;
    }

    if (message.type === 'host-ball') {
      room.gameActive = true;
      room.currentBall = {
        number: Number(message.number),
        letter: String(message.letter || ''),
        totalDrawn: Number(message.totalDrawn || 0),
      };

      const payload = {
        type: 'ball-update',
        room: roomCode,
        ...room.currentBall,
      };

      for (const client of [...room.hosts, ...room.players.keys()]) {
        sendJson(client, payload);
      }
      broadcastRoom(roomCode);
      return;
    }

    if (message.type === 'host-game-reset') {
      room.gameActive = false;
      room.currentBall = null;
      for (const [playerSocket, player] of room.players.entries()) {
        room.players.set(playerSocket, {
          ...player,
          ready: false,
          connected: true,
          lastSeenAt: Date.now(),
        });
      }
      for (const client of [...room.hosts, ...room.players.keys()]) {
        sendJson(client, {
          type: 'game-reset',
          room: roomCode,
        });
      }
      broadcastRoom(roomCode);
      return;
    }

    if (message.type === 'bingo-claim') {
      const player = Array.from(room.players.values()).find(item => item.id === message.playerId);
      const payload = {
        type: 'bingo-claim',
        room: roomCode,
        playerId: String(message.playerId || ''),
        playerName: player?.name || 'Jogador',
        cardId: player?.cardId || '',
        card: player?.card?.length ? player.card : (Array.isArray(message.card) ? message.card : []),
      };

      for (const host of room.hosts) {
        sendJson(host, payload);
      }
      return;
    }

    if (message.type === 'host-bingo-result') {
      const payload = {
        type: 'bingo-result',
        room: roomCode,
        playerId: String(message.playerId || ''),
        valid: Boolean(message.valid),
      };

      for (const client of [...room.hosts, ...room.players.keys()]) {
        sendJson(client, payload);
      }
    }
  });

  socket.on('close', () => {
    const { role, room: roomCode } = socket.meta || {};
    const room = rooms.get(roomCode);
    if (!room) return;

    if (role === 'host') {
      room.hosts.delete(socket);
      if (room.hosts.size > 0) {
        broadcastRoom(roomCode);
        return;
      }

      clearHostReconnectGrace(room);
      room.hostReconnectUntil = Date.now() + HOST_RECONNECT_GRACE_MS;
      room.hostReconnectTimer = setTimeout(() => {
        const latestRoom = rooms.get(roomCode);
        if (!latestRoom) return;
        if (latestRoom.hosts.size > 0) {
          clearHostReconnectGrace(latestRoom);
          broadcastRoom(roomCode);
          return;
        }
        clearHostReconnectGrace(latestRoom);
        for (const playerSocket of latestRoom.players.keys()) {
          sendJson(playerSocket, {
            type: 'session-ended',
            room: roomCode,
          });
        }
        rooms.delete(roomCode);
      }, HOST_RECONNECT_GRACE_MS);
      broadcastRoom(roomCode);
      return;
    }

    if (role === 'player') {
      const player = room.players.get(socket);
      if (player) {
        room.players.set(socket, {
          ...player,
          connected: false,
          lastSeenAt: Date.now(),
        });
      }
    }

    if (room.hosts.size === 0 && room.players.size === 0) {
      rooms.delete(roomCode);
    } else {
      broadcastRoom(roomCode);
    }
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Bingo House production server: http://0.0.0.0:${port}`);
});
