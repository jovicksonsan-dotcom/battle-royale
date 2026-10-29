const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ====== CONFIGURAÇÕES DO JOGO ======
const MAP_SIZE = 2000;
const MAX_PLAYERS = 8;
const TICK_RATE = 60;

let players = {};
let bullets = [];
let zone = {
  x: MAP_SIZE / 2,
  y: MAP_SIZE / 2,
  radius: 900,
  targetRadius: 900,
  damage: 5
};
let gameState = 'waiting';
let winner = null;
let zoneTimer = 0;

function createPlayer(id, name) {
  const angle = Math.random() * Math.PI * 2;
  const dist = 300 + Math.random() * 200;
  return {
    id,
    name: name || `Player${Object.keys(players).length + 1}`,
    x: MAP_SIZE / 2 + Math.cos(angle) * dist,
    y: MAP_SIZE / 2 + Math.sin(angle) * dist,
    angle: 0,
    health: 100,
    maxHealth: 100,
    speed: 3.2,
    color: `hsl(${Math.random() * 360}, 70%, 50%)`,
    kills: 0,
    alive: true,
    lastShot: 0
  };
}

function resetGame() {
  players = {};
  bullets = [];
  zone = {
    x: MAP_SIZE / 2,
    y: MAP_SIZE / 2,
    radius: 900,
    targetRadius: 900,
    damage: 5
  };
  gameState = 'waiting';
  winner = null;
  zoneTimer = 0;
}

function shrinkZone() {
  zoneTimer++;
  if (zoneTimer % (30 * 60) === 0) {
    zone.targetRadius = Math.max(80, zone.targetRadius - 120);
  }
  zone.radius += (zone.targetRadius - zone.radius) * 0.008;
}

function updateBullets() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += Math.cos(b.angle) * b.speed;
    b.y += Math.sin(b.angle) * b.speed;
    b.life--;

    for (const id in players) {
      const p = players[id];
      if (!p.alive || p.id === b.owner) continue;
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      if (dx * dx + dy * dy < 22 * 22) {
        p.health -= b.damage;
        bullets.splice(i, 1);
        if (p.health <= 0) {
          p.alive = false;
          p.health = 0;
          if (players[b.owner]) players[b.owner].kills++;
        }
        break;
      }
    }

    if (b.life <= 0) bullets.splice(i, 1);
  }
}

function applyZoneDamage() {
  for (const id in players) {
    const p = players[id];
    if (!p.alive) continue;
    const dx = p.x - zone.x;
    const dy = p.y - zone.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > zone.radius) {
      p.health -= zone.damage / 60;
      if (p.health <= 0) {
        p.alive = false;
        p.health = 0;
      }
    }
  }
}

function checkWinner() {
  const alive = Object.values(players).filter(p => p.alive);
  if (gameState === 'playing' && alive.length === 1) {
    gameState = 'finished';
    winner = alive[0];
  }
  if (gameState === 'playing' && alive.length === 0) {
    gameState = 'finished';
    winner = null;
  }
}

setInterval(() => {
  if (gameState === 'playing') {
    shrinkZone();
    updateBullets();
    applyZoneDamage();
    checkWinner();
  }

  io.emit('state', {
    players,
    bullets,
    zone,
    gameState,
    winner: winner ? { id: winner.id, name: winner.name } : null
  });
}, 1000 / TICK_RATE);

io.on('connection', (socket) => {
  console.log('Jogador conectado:', socket.id);

  socket.on('join', (name) => {
    if (Object.keys(players).length >= MAX_PLAYERS) {
      socket.emit('full');
      return;
    }
    players[socket.id] = createPlayer(socket.id, name);
    socket.emit('joined', players[socket.id]);
  });

  socket.on('startGame', () => {
    if (gameState === 'waiting' && Object.keys(players).length >= 2) {
      gameState = 'playing';
      zoneTimer = 0;
      zone.radius = 900;
      zone.targetRadius = 900;
    }
  });

  socket.on('input', (data) => {
    const p = players[socket.id];
    if (!p || !p.alive || gameState !== 'playing') return;

    let dx = 0, dy = 0;
    if (data.keys.w) dy -= 1;
    if (data.keys.s) dy += 1;
    if (data.keys.a) dx -= 1;
    if (data.keys.d) dx += 1;

    if (dx !== 0 || dy !== 0) {
      const len = Math.sqrt(dx * dx + dy * dy);
      p.x += (dx / len) * p.speed;
      p.y += (dy / len) * p.speed;
      p.x = Math.max(20, Math.min(MAP_SIZE - 20, p.x));
      p.y = Math.max(20, Math.min(MAP_SIZE - 20, p.y));
    }

    if (data.angle !== undefined) p.angle = data.angle;

    if (data.shooting && Date.now() - p.lastShot > 280) {
      p.lastShot = Date.now();
      bullets.push({
        x: p.x + Math.cos(p.angle) * 25,
        y: p.y + Math.sin(p.angle) * 25,
        angle: p.angle,
        speed: 11,
        damage: 18,
        life: 70,
        owner: p.id
      });
    }
  });

  socket.on('restart', () => {
    resetGame();
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    console.log('Jogador saiu:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
