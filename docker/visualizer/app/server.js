const express = require('express');
const path = require('path');
const http = require('http');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

const senderUrl = process.env.SENDER_BASE_URL || 'http://sender-dfsp:8444';
const receiverUrl = process.env.RECEIVER_BASE_URL || 'http://receiver-dfsp:8444';
const coreUrl = process.env.CORE_URL || '';
const refreshSeconds = parseInt(process.env.REFRESH_INTERVAL_SECONDS || '5', 10);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', socket => {
  console.log('Visualizer client connected');
});

// receive events from DFSPs
app.post('/events', (req, res) => {
  const evt = req.body;
  io.emit('event', evt);
  res.json({ ok: true });
});

app.get('/api/status', async (req, res) => {
  const targets = [
    { name: 'sender', url: `${senderUrl}/health` },
    { name: 'receiver', url: `${receiverUrl}/health` }
  ];
  if (coreUrl) {
    targets.push({ name: 'core', url: coreUrl });
  }

  const results = await Promise.all(targets.map(async service => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(service.url, { signal: controller.signal });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const text = await response.text();
      return { ...service, healthy: true, details: text.trim() };
    } catch (error) {
      return { ...service, healthy: false, details: error.message };
    } finally {
      clearTimeout(timeout);
    }
  }));

  res.json({ refreshSeconds, results });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(port, () => {
  console.log(`Visualizer UI running on port ${port}`);
});
