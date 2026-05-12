const statusEl = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');
const chatEl = document.getElementById('chat');
const askForm = document.getElementById('ask-form');
const questionEl = document.getElementById('question');
const askBtn = document.getElementById('ask-btn');

let activeCallSid = null;
const partialBySpeaker = new Map();

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

function clearTranscript() {
  transcriptEl.innerHTML = '';
  partialBySpeaker.clear();
}

function renderLine(line, opts = {}) {
  const div = document.createElement('div');
  div.className = `line ${line.speaker.toLowerCase()}${line.isFinal ? '' : ' partial'}`;
  if (opts.id) div.dataset.partialId = opts.id;
  const speaker = document.createElement('span');
  speaker.className = 'speaker';
  speaker.textContent = line.speaker;
  const text = document.createElement('span');
  text.textContent = line.text;
  div.append(speaker, text);
  transcriptEl.append(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  return div;
}

function handleLine(line) {
  if (line.isFinal) {
    const existing = partialBySpeaker.get(line.speaker);
    if (existing) {
      existing.remove();
      partialBySpeaker.delete(line.speaker);
    }
    renderLine(line);
  } else {
    let el = partialBySpeaker.get(line.speaker);
    if (!el) {
      el = renderLine(line, { id: `partial-${line.speaker}` });
      partialBySpeaker.set(line.speaker, el);
    } else {
      el.querySelector('span:last-child').textContent = line.text;
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }
  }
}

function connectStream() {
  const es = new EventSource('/api/events');

  es.addEventListener('call-started', (e) => {
    const data = JSON.parse(e.data);
    activeCallSid = data.callSid;
    clearTranscript();
    setStatus(`Live — call ${data.callSid.slice(-6)}`, 'live');
  });

  es.addEventListener('line', (e) => {
    const data = JSON.parse(e.data);
    if (!activeCallSid) activeCallSid = data.callSid;
    handleLine(data.line);
  });

  es.addEventListener('call-ended', (_e) => {
    setStatus('Call ended — transcript preserved', 'idle');
    activeCallSid = null;
  });

  es.onerror = () => {
    setStatus('Disconnected — reconnecting…', 'idle');
  };
}

async function askQuestion(question) {
  const qa = document.createElement('div');
  qa.className = 'qa';
  const q = document.createElement('div');
  q.className = 'q';
  q.textContent = question;
  const a = document.createElement('div');
  a.className = 'a pending';
  a.textContent = 'Thinking…';
  qa.append(q, a);
  chatEl.append(qa);
  chatEl.scrollTop = chatEl.scrollHeight;

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, callSid: activeCallSid }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    a.classList.remove('pending');
    a.textContent = data.answer || '(no answer)';
  } catch (err) {
    a.classList.remove('pending');
    a.textContent = `Error: ${err.message}`;
  }
  chatEl.scrollTop = chatEl.scrollHeight;
}

askForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const question = questionEl.value.trim();
  if (!question) return;
  questionEl.value = '';
  askQuestion(question);
});

questionEl.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    askForm.requestSubmit();
  }
});

connectStream();
