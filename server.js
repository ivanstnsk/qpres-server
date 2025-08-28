const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const path = require("path");

const app = express();

// Game configuration
const GAME_CONFIG = {
  canvasWidth: 3000,
  canvasHeight: 3000,
  playerRadius: 32,
};

// CORS configuration - Updated for production
const corsOptions = {
  origin: function (origin, callback) {
    // Allow your domain and localhost for development
    const allowedOrigins = [
      "https://sothisismypresentationserver.stinsky.dev",
      "http://localhost:3000",
      "http://localhost:8080",
      "https://stinsky.dev", // if you have other subdomains
      // Add other domains as needed
    ];

    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log("CORS blocked origin:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true, // If you need to send cookies
};

// Apply CORS middleware
app.use(cors(corsOptions));

const server = http.createServer(app);

// Socket.IO configuration with CORS - Updated for production
const io = socketIo(server, {
  cors: {
    origin: [
      "https://sothisismypresentationserver.stinsky.dev",
      "https://sothisismypresentation.stinsky.dev",
      "http://localhost:3000",
      "http://localhost:8080",
      "https://stinsky.dev",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
  // Add these for better performance behind proxy
  transports: ["websocket", "polling"],
  allowEIO3: true,
});

// Trust proxy - Important for deployment behind Nginx
app.set("trust proxy", 1);

// Health check endpoint - useful for monitoring
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    players: Object.keys(players).length,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
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

  // Handle connection errors
  socket.on("error", (err) => {
    console.error("Socket error:", err);
  });
});

// Error handling
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("Process terminated");
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});
