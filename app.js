const socket = io();
let lastState = null;

function $(id) { return document.getElementById(id); }

socket.on('state', (state) => {
  lastState = state;
  render(state);
});

async function post(url, body = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Request failed');
  }
}

function correct(side) { post('/api/correct', { side }); }
function pickCorrect() { post('/api/pick', { side: lastState?.correctSide || 'winning' }); }
function pickSide(side) { post('/api/pick', { side }); }

function render(state) {
  const total = Math.max(1, state.side1 + state.side2);
  const p1 = Math.round((state.side1 / total) * 100);
  const p2 = 100 - p1;

  if ($('status')) {
    $('status').textContent = `${state.connected ? 'Connected' : 'Disconnected'} to ${state.channel || 'missing channel'}${state.lastError ? ' — ' + state.lastError : ''}`;
    $('lockState').textContent = state.locked ? 'Locked' : 'Unlocked';
    $('lockState').className = 'pill ' + (state.locked ? 'locked' : '');
    $('side1').textContent = state.side1;
    $('side2').textContent = state.side2;
    $('total').textContent = state.total;
    const winner = state.winners?.[0];
    $('winnerBox').textContent = winner ? `${winner.username} — voted ${winner.side} (${winner.poolSize} eligible)` : 'None yet';
    $('recent').innerHTML = (state.recent || []).map(v => `<li><b>${escapeHtml(v.username)}</b> voted ${escapeHtml(v.side)}</li>`).join('');
  }

  if ($('bar1')) {
    $('bar1').style.width = `${Math.max(7, p1)}%`;
    $('bar2').style.width = `${Math.max(7, p2)}%`;
    $('label1').textContent = `1 — ${state.side1}`;
    $('label2').textContent = `2 — ${state.side2}`;
    $('overlayStatus').textContent = state.locked ? 'LOCKED' : 'LIVE';
    $('overlayTotal').textContent = `${state.total} voters`;
    const winner = state.winners?.[0];
    $('overlayWinner').textContent = winner ? `Winner: ${winner.username}` : '';
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
