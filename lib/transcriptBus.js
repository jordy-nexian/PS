const { EventEmitter } = require('events');

class TranscriptBus extends EventEmitter {
  constructor() {
    super();
    this.calls = new Map();
    this.activeCallSid = null;
  }

  startCall(callSid, meta = {}) {
    this.calls.set(callSid, {
      callSid,
      startedAt: Date.now(),
      endedAt: null,
      lines: [],
      ...meta,
    });
    this.activeCallSid = callSid;
    this.emit('call-started', { callSid, ...meta });
  }

  endCall(callSid) {
    const call = this.calls.get(callSid);
    if (!call) return;
    call.endedAt = Date.now();
    if (this.activeCallSid === callSid) this.activeCallSid = null;
    this.emit('call-ended', { callSid });
  }

  addLine(callSid, { speaker, text, isFinal }) {
    const call = this.calls.get(callSid);
    if (!call) return;
    const line = { speaker, text, isFinal, at: Date.now() };
    if (isFinal) {
      call.lines.push(line);
    }
    this.emit('line', { callSid, line });
  }

  getCall(callSid) {
    return this.calls.get(callSid) || null;
  }

  getActiveCall() {
    return this.activeCallSid ? this.getCall(this.activeCallSid) : null;
  }

  getTranscriptText(callSid) {
    const call = this.calls.get(callSid);
    if (!call) return '';
    return call.lines
      .map((l) => `${l.speaker}: ${l.text}`)
      .join('\n');
  }
}

module.exports = new TranscriptBus();
