require('dotenv').config();

const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { twiml: { VoiceResponse } } = require('twilio');

const transcriptBus = require('./lib/transcriptBus');
const { handleTwilioStream } = require('./lib/twilioStream');
const { ask } = require('./lib/azureOpenAI');

const port = process.env.PORT || 3000;
const publicHost = process.env.PUBLIC_HOST;
const engineerNumber = process.env.ENGINEER_PHONE_NUMBER;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/voice', (req, res) => {
  if (!publicHost || !engineerNumber) {
    console.error('Missing PUBLIC_HOST or ENGINEER_PHONE_NUMBER');
    res.status(500).type('text/xml').send(
      new VoiceResponse().say('Server not configured.').toString(),
    );
    return;
  }

  const response = new VoiceResponse();
  const start = response.start();
  start.stream({
    url: `wss://${publicHost}/stream`,
    track: 'both_tracks',
  });
  response.dial(engineerNumber);

  res.type('text/xml').send(response.toString());
});

app.post('/call-status', (req, res) => {
  const { CallSid, CallStatus } = req.body;
  console.log(`[call-status] ${CallSid} → ${CallStatus}`);
  if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'canceled') {
    transcriptBus.endCall(CallSid);
  }
  res.sendStatus(204);
});

app.get('/api/active-call', (req, res) => {
  const call = transcriptBus.getActiveCall();
  if (!call) return res.json({ active: null });
  res.json({
    active: {
      callSid: call.callSid,
      startedAt: call.startedAt,
      lines: call.lines,
    },
  });
});

app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const active = transcriptBus.getActiveCall();
  if (active) {
    send('call-started', { callSid: active.callSid, startedAt: active.startedAt });
    for (const line of active.lines) {
      send('line', { callSid: active.callSid, line });
    }
  }

  const onStarted = (payload) => send('call-started', payload);
  const onLine = (payload) => send('line', payload);
  const onEnded = (payload) => send('call-ended', payload);
  transcriptBus.on('call-started', onStarted);
  transcriptBus.on('line', onLine);
  transcriptBus.on('call-ended', onEnded);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    transcriptBus.off('call-started', onStarted);
    transcriptBus.off('line', onLine);
    transcriptBus.off('call-ended', onEnded);
  });
});

app.post('/api/ask', async (req, res) => {
  const { question, callSid } = req.body || {};
  if (!question) return res.status(400).json({ error: 'question required' });

  const targetSid = callSid || transcriptBus.getActiveCall()?.callSid;
  const transcript = targetSid ? transcriptBus.getTranscriptText(targetSid) : '';

  try {
    const answer = await ask({ transcript, question });
    res.json({ answer });
  } catch (err) {
    console.error('[ask] error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/healthz', (_req, res) => res.send('ok'));

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const { url } = req;
  if (url === '/stream') {
    wss.handleUpgrade(req, socket, head, (ws) => handleTwilioStream(ws));
  } else {
    socket.destroy();
  }
});

server.listen(port, () => {
  console.log(`Server listening on :${port}`);
  if (publicHost) console.log(`Public host: ${publicHost} (Twilio Stream URL: wss://${publicHost}/stream)`);
});
