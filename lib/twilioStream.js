const { createCallTranscriber } = require('./azureSpeech');
const transcriptBus = require('./transcriptBus');

function handleTwilioStream(ws) {
  let transcriber = null;
  let callSid = null;
  let streamSid = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.event) {
      case 'connected':
        break;

      case 'start': {
        streamSid = msg.start.streamSid;
        callSid = msg.start.callSid;
        console.log(`[stream] start callSid=${callSid} streamSid=${streamSid}`);

        transcriptBus.startCall(callSid, { streamSid });

        transcriber = createCallTranscriber({
          callSid,
          onPartial: ({ speaker, text }) => {
            transcriptBus.addLine(callSid, { speaker, text, isFinal: false });
          },
          onFinal: ({ speaker, text }) => {
            transcriptBus.addLine(callSid, { speaker, text, isFinal: true });
          },
        });
        break;
      }

      case 'media': {
        if (!transcriber) return;
        const audio = Buffer.from(msg.media.payload, 'base64');
        transcriber.pushTrack(msg.media.track, audio);
        break;
      }

      case 'stop': {
        console.log(`[stream] stop callSid=${callSid}`);
        if (transcriber) {
          transcriber.close();
          transcriber = null;
        }
        if (callSid) transcriptBus.endCall(callSid);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (transcriber) {
      transcriber.close();
      transcriber = null;
    }
    if (callSid && transcriptBus.getActiveCall()?.callSid === callSid) {
      transcriptBus.endCall(callSid);
    }
  });

  ws.on('error', (err) => {
    console.error('[stream] ws error:', err);
  });
}

module.exports = { handleTwilioStream };
