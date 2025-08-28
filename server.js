const express = require("express");
const https = require("https");
const socketIo = require("socket.io");
const cors = require("cors");
const path = require("path");

const app = express();

const sslOptions = {
  key: fs.readFileSync("/etc/ssl/private/selfsigned.key"),
  cert: fs.readFileSync("/etc/ssl/certs/selfsigned.crt"),
};

// Game configuration
const GAME_CONFIG = {
  canvasWidth: 3000,
  canvasHeight: 3000,
  playerRadius: 32,
};

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow all origins for now, adjust in production
    callback(null, true);
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// Apply CORS middleware
app.use(cors(corsOptions));

const server = https.createServer(sslOptions, app);

// Socket.IO configuration with CORS
const io = socketIo(server, {
  cors: {
    origin: "*", // Be more specific in production
    methods: ["GET", "POST"],
  },
});

// Store players
const players = {};

// Latency tracking
const playerLatencies = {};

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("New player connected:", socket.id);

  // Latency measurement
  socket.on("clientPing", (timestamp) => {
    socket.emit("serverPong", {
      timestamp: timestamp,
      serverTimestamp: Date.now(),
    });
  });

  // Handle player join
  socket.on("playerJoin", (playerInfo) => {
    // Create player object at the center of the world
    const initialX = GAME_CONFIG.canvasWidth / 2;
    const initialY = GAME_CONFIG.canvasHeight / 2;

    players[socket.id] = {
      id: socket.id,
      name: playerInfo.name,
      x: initialX,
      y: initialY,
      characterId: playerInfo.characterId || 1,
      lastUpdateTimestamp: Date.now(),
      color: playerInfo.color,
    };

    // Initialize latency for this player
    playerLatencies[socket.id] = {
      latency: 0,
      jitter: 0,
      lastPings: [],
    };

    // Emit new player to all clients
    io.emit("playerJoined", players[socket.id]);

    // Send current players to the new player
    socket.emit("currentPlayers", players);
  });

  // Handle player movement
  socket.on("playerMove", (moveData) => {
    if (players[socket.id]) {
      const now = Date.now();
      const player = players[socket.id];

      // Constrain movement within canvas
      player.x = Math.max(
        GAME_CONFIG.playerRadius,
        Math.min(GAME_CONFIG.canvasWidth - GAME_CONFIG.playerRadius, moveData.x)
      );
      player.y = Math.max(
        GAME_CONFIG.playerRadius,
        Math.min(
          GAME_CONFIG.canvasHeight - GAME_CONFIG.playerRadius,
          moveData.y
        )
      );
      player.lastUpdateTimestamp = now;

      // Broadcast player movement to all other clients
      socket.broadcast.emit("playerMoved", {
        id: socket.id,
        x: player.x,
        y: player.y,
        timestamp: now,
        spawnParticles: moveData.spawnParticles,
      });
    }
  });

  // Handle player draw
  socket.on("playerDraw", (drawData) => {
    if (players[socket.id]) {
      const now = Date.now();
      const player = players[socket.id];

      player.lastUpdateTimestamp = now;

      console.log("broadcast draw", drawData);

      if (Object.keys(players).length > 1) {
        // Broadcast player draw to all other clients
        socket.broadcast.emit("playerDraw", {
          id: socket.id,
          x: drawData.x,
          y: drawData.y,
          timestamp: now,
          zone: drawData.zone,
        });
      } else {
        socket.emit("playerDraw", {
          id: socket.id,
          x: drawData.x,
          y: drawData.y,
          timestamp: now,
          zone: drawData.zone,
        });
      }
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);

    // Remove player from players and latency tracking
    delete players[socket.id];
    delete playerLatencies[socket.id];

    // Notify all clients about the disconnected player
    io.emit("playerLeft", socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`HTTPS Server running on port ${PORT}`);
});
