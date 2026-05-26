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

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
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
  if (!rooms.has(code)) {
    rooms.set(code, { hosts: new Set(), players: new Map() });
  }
  return rooms.get(code);
};

const broadcastRoom = (code) => {
  const room = rooms.get(code);
  if (!room) return;

  const payload = JSON.stringify({
    type: 'room-update',
    room: code,
    players: Array.from(room.players.values()),
    playerCount: room.players.size,
    hostCount: room.hosts.size,
  });

  for (const client of [...room.hosts, ...room.players.keys()]) {
    if (client.readyState === client.OPEN) client.send(payload);
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

    const roomCode = String(message.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (!/^[A-Z0-9]{6}$/.test(roomCode)) return;

    const room = getRoom(roomCode);

    if (message.type === 'host-join') {
      socket.meta = { role: 'host', room: roomCode };
      room.hosts.add(socket);
      broadcastRoom(roomCode);
      return;
    }

    if (message.type === 'player-join') {
      const playerId = String(message.playerId || crypto.randomUUID());
      const name = String(message.name || `Jogador ${room.players.size + 1}`).slice(0, 24);
      const card = Array.isArray(message.card) ? message.card.slice(0, 25).map(Number) : [];
      const cardId = String(message.cardId || playerId.slice(0, 6).toUpperCase()).slice(0, 12);
      socket.meta = { role: 'player', room: roomCode, playerId };
      room.players.set(socket, { id: playerId, name, cardId, card, ready: false, joinedAt: Date.now() });
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
      room.players.set(socket, { ...player, name, cardId, card, ready: false });
      broadcastRoom(roomCode);
      return;
    }

    if (message.type === 'player-ready') {
      const player = room.players.get(socket);
      if (!player) return;
      const card = Array.isArray(message.card) ? message.card.slice(0, 25).map(Number) : player.card;
      const cardId = String(message.cardId || player.cardId).slice(0, 12);
      const name = String(message.name || player.name).slice(0, 24);
      room.players.set(socket, { ...player, name, cardId, card, ready: true });
      broadcastRoom(roomCode);
      return;
    }

    if (message.type === 'host-game-start') {
      const payload = JSON.stringify({ type: 'game-start', room: roomCode });
      for (const client of [...room.hosts, ...room.players.keys()]) {
        if (client.readyState === client.OPEN) client.send(payload);
      }
      return;
    }

    if (message.type === 'host-ball') {
      const payload = JSON.stringify({
        type: 'ball-update',
        room: roomCode,
        number: Number(message.number),
        letter: String(message.letter || ''),
        totalDrawn: Number(message.totalDrawn || 0),
      });

      for (const client of [...room.hosts, ...room.players.keys()]) {
        if (client.readyState === client.OPEN) client.send(payload);
      }
      return;
    }

    if (message.type === 'bingo-claim') {
      const player = Array.from(room.players.values()).find(item => item.id === message.playerId);
      const payload = JSON.stringify({
        type: 'bingo-claim',
        room: roomCode,
        playerId: String(message.playerId || ''),
        playerName: player?.name || 'Jogador',
        cardId: player?.cardId || '',
        card: player?.card?.length ? player.card : (Array.isArray(message.card) ? message.card : []),
      });

      for (const host of room.hosts) {
        if (host.readyState === host.OPEN) host.send(payload);
      }
      return;
    }

    if (message.type === 'host-bingo-result') {
      const payload = JSON.stringify({
        type: 'bingo-result',
        room: roomCode,
        playerId: String(message.playerId || ''),
        valid: Boolean(message.valid),
      });

      for (const client of [...room.hosts, ...room.players.keys()]) {
        if (client.readyState === client.OPEN) client.send(payload);
      }
    }
  });

  socket.on('close', () => {
    const { role, room: roomCode } = socket.meta || {};
    const room = rooms.get(roomCode);
    if (!room) return;

    if (role === 'host') room.hosts.delete(socket);
    if (role === 'player') room.players.delete(socket);

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
