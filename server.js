require('dotenv').config();

const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const twilio = require('twilio');
const { twiml: { VoiceResponse } } = twilio;

const transcriptBus = require('./lib/transcriptBus');
const { handleTwilioStream } = require('./lib/twilioStream');
const { ask } = require('./lib/foundryAgent');

const port = process.env.PORT || 3000;
const publicHost = process.env.PUBLIC_HOST;
const engineerNumber = process.env.ENGINEER_PHONE_NUMBER;
const twilioNumber = process.env.TWILIO_PHONE_NUMBER;
const twilioSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = twilioSid && twilioAuthToken ? twilio(twilioSid, twilioAuthToken) : null;

const E164 = /^\+[1-9]\d{6,14}$/;

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

  if (process.env.TEST_MODE === 'true') {
    response.say('Solo test mode. Start speaking. The call will stay open for an hour or until you hang up.');
    response.pause({ length: 3600 });
  } else if (twilioNumber) {
    response.dial({ callerId: twilioNumber }, engineerNumber);
  } else {
    response.dial(engineerNumber);
  }

  res.type('text/xml').send(response.toString());
});

const responseIdByCall = new Map();

app.post('/call-status', (req, res) => {
  const { CallSid, CallStatus } = req.body;
  console.log(`[call-status] ${CallSid} → ${CallStatus}`);
  if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'canceled') {
    transcriptBus.endCall(CallSid);
    responseIdByCall.delete(CallSid);
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

app.post('/api/call', async (req, res) => {
  const { to } = req.body || {};
  if (!to || !E164.test(to)) {
    return res.status(400).json({ error: 'Provide "to" in E.164 format, e.g. +447700900123' });
  }
  if (!twilioClient) {
    return res.status(500).json({ error: 'Twilio not configured (set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN)' });
  }
  if (!twilioNumber || !publicHost) {
    return res.status(500).json({ error: 'TWILIO_PHONE_NUMBER and PUBLIC_HOST must be set' });
  }

  try {
    const call = await twilioClient.calls.create({
      to,
      from: twilioNumber,
      url: `https://${publicHost}/voice`,
      method: 'POST',
      statusCallback: `https://${publicHost}/call-status`,
      statusCallbackMethod: 'POST',
    });
    res.json({ callSid: call.sid, status: call.status, to });
  } catch (err) {
    console.error('[api/call] error:', err);
    res.status(500).json({ error: err.message, code: err.code });
  }
});

app.post('/api/ask', async (req, res) => {
  const { question, callSid } = req.body || {};
  if (!question) return res.status(400).json({ error: 'question required' });

  const targetSid = callSid || transcriptBus.getActiveCall()?.callSid;
  const transcript = targetSid ? transcriptBus.getTranscriptText(targetSid) : '';

  try {
    const { text, responseId } = await ask({
      transcript,
      question,
      previousResponseId: targetSid ? responseIdByCall.get(targetSid) : undefined,
    });
    if (targetSid && responseId) responseIdByCall.set(targetSid, responseId);
    res.json({ answer: text });
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
