// =========================================
// Memory Service for n8n 2.x
// Simple in-memory session storage with TTL
// =========================================

import express from 'express';

const app = express();
app.use(express.json());

// In-memory storage
const memory = new Map();
const timers = new Map();

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ===== POST /set - Save session with TTL =====
app.post('/set', (req, res) => {
  const { sessionId, data, ttl = 1800 } = req.body; // default 30 min
  
  // Clear existing timer
  if (timers.has(sessionId)) {
    clearTimeout(timers.get(sessionId));
  }
  
  // Save data
  memory.set(sessionId, data);
  
  // Set TTL timer
  const timer = setTimeout(() => {
    memory.delete(sessionId);
    timers.delete(sessionId);
    console.log(`🗑️  Session expired: ${sessionId}`);
  }, ttl * 1000);
  
  timers.set(sessionId, timer);
  
  console.log(`💾 Saved session: ${sessionId} (TTL: ${ttl}s)`);
  res.json({ ok: true, sessionId });
});

// ===== POST /get - Get session data =====
app.post('/get', (req, res) => {
  const { sessionId } = req.body;
  const data = memory.get(sessionId) || null;
  
  console.log(`🔍 Get session: ${sessionId} → ${data ? 'found' : 'not found'}`);
  res.json({ data });
});

// ===== GET /stats - Debug info =====
app.get('/stats', (req, res) => {
  res.json({
    total: memory.size,
    sessions: Array.from(memory.keys())
  });
});

// Start server
const PORT = 3333;
app.listen(PORT, () => {
  console.log(`🧠 Memory Service running on http://localhost:${PORT}`);
  console.log(`📊 Stats: http://localhost:${PORT}/stats`);
});
