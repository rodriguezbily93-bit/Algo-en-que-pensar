require("dotenv").config();

const express = require("express");
const http = require("http");
const helmet = require("helmet");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const { Server } = require("socket.io");
const { RateLimiterMemory } = require("rate-limiter-flexible");

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const io = new Server(server, {
  cors: { origin: "*" }
});

const rateLimiter = new RateLimiterMemory({
  points: 50,
  duration: 60
});

const onlineUsers = new Map();
const waitingQueue = [];
const partners = new Map();

function getPublicStats() {
  return {
    online: onlineUsers.size,
    waiting: waitingQueue.length
  };
}

function broadcastStats() {
  io.emit("stats", getPublicStats());
}

function removeFromQueue(socketId) {
  const index = waitingQueue.indexOf(socketId);
  if (index !== -1) waitingQueue.splice(index, 1);
}

function pairUsers(socketAId, socketBId) {
  const socketA = io.sockets.sockets.get(socketAId);
  const socketB = io.sockets.sockets.get(socketBId);

  if (!socketA || !socketB) return;

  partners.set(socketAId, socketBId);
  partners.set(socketBId, socketAId);

  socketA.emit("matched", { partnerId: socketBId, initiator: true });
  socketB.emit("matched", { partnerId: socketAId, initiator: false });

  broadcastStats();
}

function findMatch(socket) {
  removeFromQueue(socket.id);

  while (waitingQueue.length > 0) {
    const candidateId = waitingQueue.shift();
    const candidate = io.sockets.sockets.get(candidateId);

    if (candidate && candidate.id !== socket.id) {
      pairUsers(socket.id, candidateId);
      return;
    }
  }

  waitingQueue.push(socket.id);
  socket.emit("waiting");
  broadcastStats();
}

async function authMiddleware(req, res, next) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "No token" });

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { username, passwordHash }
    });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "30d" });

    res.json({ token, user: { id: user.id, username: user.username } });
  } catch {
    res.status(400).json({ error: "Username already exists or invalid data" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await prisma.user.findUnique({ where: { username } });

  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, user: { id: user.id, username: user.username } });
});

app.get("/api/stats", (req, res) => {
  res.json(getPublicStats());
});

app.post("/api/report", async (req, res) => {
  const { reporterId, reportedSocketId, reason } = req.body;

  await prisma.report.create({
    data: {
      reporterId: reporterId || "anonymous",
      reportedSocketId: reportedSocketId || "unknown",
      reason: reason || "No reason"
    }
  });

  res.json({ ok: true });
});

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: "Invalid admin password" });

  const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token });
});

app.get("/api/admin/reports", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.admin) return res.status(403).json({ error: "Forbidden" });

    const reports = await prisma.report.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    res.json(reports);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
});

io.on("connection", async (socket) => {
  try {
    await rateLimiter.consume(socket.handshake.address);
  } catch {
    socket.disconnect(true);
    return;
  }

  onlineUsers.set(socket.id, {
    id: socket.id,
    connectedAt: Date.now()
  });

  socket.emit("stats", getPublicStats());
  broadcastStats();

  socket.on("find", () => {
    const partnerId = partners.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit("partner-left");
      partners.delete(partnerId);
      partners.delete(socket.id);
    }
    findMatch(socket);
  });

  socket.on("next", () => {
    const partnerId = partners.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit("partner-left");
      partners.delete(partnerId);
      partners.delete(socket.id);
      const partner = io.sockets.sockets.get(partnerId);
      if (partner) findMatch(partner);
    }
    findMatch(socket);
  });

  socket.on("signal", ({ to, data }) => {
    if (to && partners.get(socket.id) === to) {
      io.to(to).emit("signal", { from: socket.id, data });
    }
  });

  socket.on("chat-message", ({ to, message }) => {
    if (!message || message.length > 300) return;
    if (to && partners.get(socket.id) === to) {
      io.to(to).emit("chat-message", { from: socket.id, message });
    }
  });

  socket.on("disconnect", () => {
    removeFromQueue(socket.id);
    onlineUsers.delete(socket.id);

    const partnerId = partners.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit("partner-left");
      partners.delete(partnerId);
      partners.delete(socket.id);
    }

    broadcastStats();
  });
});

server.listen(PORT, () => {
  console.log("Se vale todo running on port " + PORT);
});
