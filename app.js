const QUESTIONS = [
  "What made you smile most this week?",
  "What is one small thing I do that you love?",
  "Where should our next little adventure be?",
  "What is something you want more of in our relationship?",
  "Which memory of us would you happily relive?",
  "What do you think we will laugh about when we're older?",
  "When do you feel closest to me?",
  "What is a dream you would love for us to share?",
  "What song feels like us right now?",
  "What is one thing you have wanted to tell me lately?"
];

const HOST_PROFILE_KEY = "twogether.host.v2";
const enc = new TextEncoder();
const dec = new TextDecoder();
const app = document.querySelector("#app");

let profile = null;
let own = { answers: {}, revealed: {} };
let partner = { name: "Partner", answered: {}, revealed: {} };
let peer = null;
let connection = null;
let localChannel = null;
let localLive = false;
let connectionState = "offline";
let currentTab = "answer";
let reconnectTimer = null;
let joinPayload = readJoinPayload();

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function writeJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

function randomToken(bytes = 12) {
  return bytesToB64(crypto.getRandomValues(new Uint8Array(bytes)));
}

function bytesToB64(bytes) {
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64ToBytes(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodePayload(value) { return bytesToB64(enc.encode(JSON.stringify(value))); }
function decodePayload(value) { return JSON.parse(dec.decode(b64ToBytes(value))); }

function readJoinPayload() {
  try {
    const value = new URLSearchParams(location.hash.slice(1)).get("join");
    if (!value) return null;
    const payload = decodePayload(value);
    return payload.v === 2 && payload.roomId && payload.secret && payload.hostId ? payload : null;
  } catch { return null; }
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function toast(message) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2400);
}

function dataKey() { return `twogether.person.v2.${profile.roomId}.${profile.role}.${profile.participantId}`; }

function saveOwn() {
  writeJSON(dataKey(), { name: profile.name, answers: own.answers, revealed: own.revealed });
  if (profile.role === "host") writeJSON(HOST_PROFILE_KEY, profile);
  else writeJSON(`twogether.guest.v2.${profile.roomId}`, profile);
}

function loadOwn() {
  const saved = readJSON(dataKey());
  own = saved ? { answers: saved.answers || {}, revealed: saved.revealed || {} } : { answers: {}, revealed: {} };
}

function answeredMap() {
  return Object.fromEntries(QUESTIONS.map((_, index) => [index, Boolean(own.answers[index])]));
}

function shareLink() {
  const payload = encodePayload({ v: 2, roomId: profile.roomId, secret: profile.secret, hostId: profile.hostId, hostName: profile.name });
  return `${location.origin}${location.pathname}#join=${payload}`;
}

function landing() {
  const previous = readJSON(HOST_PROFILE_KEY);
  app.innerHTML = `
    <main class="welcome">
      <div class="brand"><span class="brand-mark">♥</span> Twogether</div>
      <div class="heart-pair"><div class="heart one">💌</div><div class="heart two">⚡</div></div>
      <p class="eyebrow">Private answers · live reveal</p>
      <h1>Just the two of you.</h1>
      <p class="welcome-copy">Create a private room, send one link, and answer together in real time.</p>
      ${previous ? `<button id="continue-room" class="button secondary" style="margin-bottom:12px">Continue as ${escapeHTML(previous.name)}</button>` : ""}
      <form id="create-form" class="card stack">
        <div class="field"><label for="name">Your name</label><input id="name" required maxlength="24" placeholder="Your name" autocomplete="nickname"></div>
        <div class="field"><label for="share-code">Private share code</label><input id="share-code" required minlength="6" maxlength="40" placeholder="Something only you would choose" autocomplete="off"></div>
        <button class="button primary" type="submit">Generate our link</button>
        <div class="privacy-note"><span>🔒</span><span>The code creates a unique room link. Unrevealed answer text stays on your own device.</span></div>
      </form>
    </main>`;
  document.querySelector("#continue-room")?.addEventListener("click", () => resumeHost(previous));
  document.querySelector("#create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.querySelector("#name").value.trim();
    const code = document.querySelector("#share-code").value;
    const salt = randomToken(12);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`${code}:${salt}`)));
    const roomId = bytesToB64(digest).slice(0, 14);
    profile = { role: "host", name, roomId, secret: bytesToB64(digest), hostId: `twogether-${roomId}`, participantId: randomToken(9) };
    own = { answers: {}, revealed: {} };
    saveOwn();
    renderApp();
    startPeer();
  });
}

function resumeHost(previous) {
  profile = previous;
  loadOwn();
  renderApp();
  startPeer();
}

function joinScreen(payload) {
  const previous = readJSON(`twogether.guest.v2.${payload.roomId}`);
  app.innerHTML = `
    <main class="welcome">
      <div class="brand"><span class="brand-mark">♥</span> Twogether</div>
      <div class="heart-pair"><div class="heart one">👋</div><div class="heart two">💞</div></div>
      <p class="eyebrow">You're invited</p>
      <h1>Join ${escapeHTML(payload.hostName || "your partner")}.</h1>
      <p class="welcome-copy">Put your name down and your shared question room will open.</p>
      <form id="join-form" class="card stack">
        <div class="field"><label for="name">Your name</label><input id="name" required maxlength="24" value="${escapeHTML(previous?.name || "")}" placeholder="Your name" autocomplete="nickname"></div>
        <button class="button primary" type="submit">Start answering</button>
        <div class="privacy-note"><span>⚡</span><span>Live answers work while both of you have the app open and are online.</span></div>
      </form>
    </main>`;
  document.querySelector("#join-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = document.querySelector("#name").value.trim();
    profile = { role: "guest", name, roomId: payload.roomId, secret: payload.secret, hostId: payload.hostId, hostName: payload.hostName, participantId: previous?.participantId || randomToken(9) };
    loadOwn();
    saveOwn();
    partner.name = payload.hostName || "Partner";
    renderApp();
    startPeer();
  });
}

function startPeer() {
  if (!window.Peer) {
    connectionState = "error";
    renderApp();
    return toast("Live connection library could not load");
  }
  clearTimeout(reconnectTimer);
  peer?.destroy();
  localChannel?.close();
  connection = null;
  localLive = false;
  connectionState = "connecting";
  renderApp();
  localChannel = new BroadcastChannel(`twogether-live-${profile.roomId}`);
  localChannel.onmessage = (event) => {
    const message = event.data;
    if (!message || message.senderId === profile.participantId) return;
    localLive = true;
    connectionState = "live";
    receive(message);
    if (message.type === "hello" && message.requestReply) sendHello(false);
  };
  sendHello(true);
  peer = profile.role === "host" ? new Peer(profile.hostId, { debug: 1 }) : new Peer({ debug: 1 });
  peer.on("open", () => {
    connectionState = "waiting";
    renderApp();
    if (profile.role === "guest") connectToHost();
  });
  peer.on("connection", (incoming) => {
    if (profile.role !== "host" || incoming.metadata?.roomId !== profile.roomId || incoming.metadata?.secret !== profile.secret) return incoming.close();
    setupConnection(incoming);
  });
  peer.on("disconnected", () => {
    connectionState = localLive ? "live" : "offline";
    renderApp();
    try { peer.reconnect(); } catch { /* handled by normal retry */ }
  });
  peer.on("error", (error) => {
    if (error.type === "peer-unavailable" && profile.role === "guest") {
      connectionState = localLive ? "live" : "waiting";
      renderApp();
      scheduleReconnect();
      return;
    }
    connectionState = localLive ? "live" : "error";
    renderApp();
    toast(error.type === "unavailable-id" ? "This room is already open in another tab" : "Live connection interrupted");
  });
}

function connectToHost() {
  if (!peer || peer.destroyed || connection?.open) return;
  setupConnection(peer.connect(profile.hostId, { reliable: true, metadata: { roomId: profile.roomId, secret: profile.secret, name: profile.name, participantId: profile.participantId } }));
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connectToHost, 4000);
}

function setupConnection(nextConnection) {
  if (connection && connection !== nextConnection) connection.close();
  connection = nextConnection;
  connection.on("open", () => {
    clearTimeout(reconnectTimer);
    connectionState = "live";
    sendHello(false);
    renderApp();
  });
  connection.on("data", receive);
  connection.on("close", () => {
    if (connection !== nextConnection) return;
    connection = null;
    connectionState = localLive ? "live" : "waiting";
    renderApp();
    if (profile.role === "guest") scheduleReconnect();
  });
  connection.on("error", () => {
    connectionState = "error";
    renderApp();
  });
}

function send(message) {
  const wireMessage = { ...message, senderId: profile.participantId };
  localChannel?.postMessage(wireMessage);
  if (connection?.open) connection.send(wireMessage);
}

function sendHello(requestReply) {
  send({ type: "hello", requestReply, name: profile.name, participantId: profile.participantId, answered: answeredMap(), revealed: own.revealed });
}

function receive(message) {
  if (!message || typeof message !== "object") return;
  if (message.type === "hello") {
    partner.name = String(message.name || "Partner").slice(0, 24);
    partner.answered = message.answered || {};
    partner.revealed = message.revealed || {};
    if (profile.role === "host") profile.partnerName = partner.name;
    saveOwn();
  }
  if (message.type === "answer-status") {
    partner.answered[message.question] = Boolean(message.answered);
    delete partner.revealed[message.question];
    delete own.revealed[message.question];
    saveOwn();
  }
  if (message.type === "reveal-request") {
    partner.revealed[message.question] = String(message.answer || "");
    if (own.answers[message.question]) {
      own.revealed[message.question] = own.answers[message.question];
      saveOwn();
      send({ type: "revealed", question: message.question, answer: own.answers[message.question] });
    }
  }
  if (message.type === "revealed") partner.revealed[message.question] = String(message.answer || "");
  renderApp();
}

function statusMarkup() {
  const states = {
    live: ["live", `${escapeHTML(partner.name)} is here`],
    connecting: ["connecting", "Connecting…"],
    waiting: ["waiting", profile.role === "host" ? "Waiting for partner" : `Waiting for ${escapeHTML(profile.hostName || "partner")}`],
    offline: ["offline", "Offline"],
    error: ["offline", "Connection issue"]
  };
  const [className, label] = states[connectionState];
  return `<span class="live-pill ${className}"><span class="live-dot"></span>${label}</span>`;
}

function header(title, subtitle) {
  return `<header class="topbar"><div class="brand"><span class="brand-mark">♥</span> Twogether</div>${statusMarkup()}</header><section class="hero-row"><div><p class="eyebrow">${escapeHTML(subtitle)}</p><h2>${escapeHTML(title)}</h2></div></section>`;
}

function nav() {
  return `<nav class="bottom-nav" aria-label="Main navigation">${[["answer","✎","Answer"],["together","♥","Together"],["invite","↗","Invite"]].map(([id, icon, label]) => `<button class="nav-item ${currentTab === id ? "active" : ""}" data-tab="${id}"><span class="nav-icon">${icon}</span>${label}</button>`).join("")}</nav>`;
}

function renderApp() {
  if (!profile) return joinPayload ? joinScreen(joinPayload) : landing();
  if (currentTab === "answer") renderQuestions();
  if (currentTab === "together") renderTogether();
  if (currentTab === "invite") renderInvite();
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
    currentTab = button.dataset.tab;
    renderApp();
  }));
}

function renderQuestions() {
  const count = Object.values(own.answers).filter(Boolean).length;
  app.innerHTML = `${header(`Hi, ${profile.name}`, "Your private answers")}<section class="hero-row"><p class="muted" style="margin:0">Saved as you. Your words stay here until reveal.</p><div class="progress-ring" style="--progress:${count / QUESTIONS.length * 360}deg"><span>${count}/${QUESTIONS.length}</span></div></section><div class="question-list">${QUESTIONS.map((question, index) => `<button class="question ${own.answers[index] ? "done" : ""}" data-question="${index}"><span class="question-number">${own.answers[index] ? "✓" : index + 1}</span><span class="question-title">${escapeHTML(question)}</span><span class="question-status">›</span></button>`).join("")}</div>${nav()}`;
  document.querySelectorAll("[data-question]").forEach((button) => button.addEventListener("click", () => editAnswer(Number(button.dataset.question))));
}

function editAnswer(index) {
  const overlay = document.createElement("div");
  overlay.className = "sheet-backdrop";
  overlay.innerHTML = `<section class="sheet"><div class="sheet-handle"></div><p class="eyebrow">${escapeHTML(profile.name)} · Question ${index + 1}</p><h2>${escapeHTML(QUESTIONS[index])}</h2><div class="field" style="margin-top:18px"><label for="answer">Your answer</label><textarea id="answer" maxlength="600" placeholder="Write what feels true…">${escapeHTML(own.answers[index] || "")}</textarea></div><div class="sheet-actions"><button class="button ghost" id="cancel">Cancel</button><button class="button primary" id="save">Save as ${escapeHTML(profile.name)}</button></div></section>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  document.querySelector("#cancel").addEventListener("click", close);
  document.querySelector("#save").addEventListener("click", () => {
    const value = document.querySelector("#answer").value.trim();
    if (value) own.answers[index] = value;
    else delete own.answers[index];
    delete own.revealed[index];
    delete partner.revealed[index];
    saveOwn();
    send({ type: "answer-status", question: index, answered: Boolean(value) });
    close();
    renderApp();
    toast(`Saved as ${profile.name}`);
  });
  document.querySelector("#answer").focus();
}

function renderTogether() {
  const matching = QUESTIONS.map((_, index) => index).filter((index) => own.answers[index] && partner.answered[index]);
  const partnerName = partner.name || profile.partnerName || profile.hostName || "Partner";
  app.innerHTML = `${header("Reveal together", "Updates live")}<section class="card sync-card"><div class="sync-icon">${connectionState === "live" ? "✨" : "⏳"}</div><h2>${connectionState === "live" ? `${matching.length} ready` : "Waiting to reconnect"}</h2><p class="muted">When either of you reveals a question, it opens instantly on both screens.</p></section><div class="reveal-grid">${QUESTIONS.map((question, index) => {
    const mineAnswered = Boolean(own.answers[index]);
    const theirsAnswered = Boolean(partner.answered[index]);
    const open = Boolean(own.revealed[index] && partner.revealed[index]);
    return `<article class="reveal-card"><p class="reveal-question">${escapeHTML(question)}</p><div class="ready-row"><span>${mineAnswered ? "✓" : "○"} ${escapeHTML(profile.name)}</span><span>${theirsAnswered ? "✓" : "○"} ${escapeHTML(partnerName)}</span></div>${open ? `<div class="answers"><div class="answer"><div class="answer-name">${escapeHTML(profile.name)}</div><div class="answer-text">${escapeHTML(own.revealed[index])}</div></div><div class="answer partner"><div class="answer-name">${escapeHTML(partnerName)}</div><div class="answer-text">${escapeHTML(partner.revealed[index])}</div></div></div>` : `<button class="button ${mineAnswered && theirsAnswered ? "primary" : "ghost"}" data-reveal="${index}" ${connectionState === "live" && mineAnswered && theirsAnswered ? "" : "disabled"}>${mineAnswered && theirsAnswered ? "Reveal this answer" : "Waiting for both answers"}</button>`}</article>`;
  }).join("")}</div>${nav()}`;
  document.querySelectorAll("[data-reveal]").forEach((button) => button.addEventListener("click", () => revealQuestion(Number(button.dataset.reveal))));
}

function revealQuestion(index) {
  if (connectionState !== "live" || !own.answers[index] || !partner.answered[index]) return;
  own.revealed[index] = own.answers[index];
  saveOwn();
  send({ type: "reveal-request", question: index, answer: own.answers[index] });
  renderApp();
}

function renderInvite() {
  const isHost = profile.role === "host";
  app.innerHTML = `${header(isHost ? "Invite your person" : "Your shared room", "Private peer-to-peer room")}<section class="card sync-card"><div class="sync-icon">🔗</div><h2>${isHost ? "Send one link" : `Joined ${escapeHTML(profile.hostName || partner.name)}'s room`}</h2><p class="muted">${isHost ? "They open it, enter their own name, and you can both start answering." : "Keep this page open for live updates. Your own answers are saved separately on this device."}</p>${isHost ? `<div class="stack"><button id="share-link" class="button primary">Share invite link</button><button id="copy-link" class="button ghost">Copy invite link</button></div>` : ""}</section><section class="card" style="margin-top:14px"><p class="eyebrow">How privacy works</p><p class="muted small">Your answer text is saved under your identity in this browser. Your partner sees only that you answered until one of you taps Reveal. Live data travels through an encrypted WebRTC connection.</p></section>${isHost ? `<button id="new-room" class="button danger" style="margin-top:14px">Create a different room</button>` : ""}${nav()}`;
  document.querySelector("#share-link")?.addEventListener("click", shareInvite);
  document.querySelector("#copy-link")?.addEventListener("click", copyInvite);
  document.querySelector("#new-room")?.addEventListener("click", () => {
    if (!confirm("Leave this room on this device and create a new one? Your current answers will remain stored, but this room will no longer open automatically.")) return;
    localStorage.removeItem(HOST_PROFILE_KEY);
    peer?.destroy();
    profile = null;
    own = { answers: {}, revealed: {} };
    partner = { name: "Partner", answered: {}, revealed: {} };
    connectionState = "offline";
    currentTab = "answer";
    landing();
  });
}

async function shareInvite() {
  const url = shareLink();
  if (navigator.share) {
    try {
      await navigator.share({ title: "Join me on Twogether", text: `${profile.name} invited you to answer together 💌`, url });
      return;
    } catch (error) { if (error.name === "AbortError") return; }
  }
  await copyInvite();
}

async function copyInvite() {
  const url = shareLink();
  try {
    await navigator.clipboard.writeText(url);
    toast("Invite link copied");
  } catch {
    const overlay = document.createElement("div");
    overlay.className = "sheet-backdrop";
    overlay.innerHTML = `<section class="sheet"><div class="sheet-handle"></div><h2>Copy this invite</h2><div class="code-box">${escapeHTML(url)}</div><button class="button primary" id="close-code">Done</button></section>`;
    document.body.appendChild(overlay);
    document.querySelector("#close-code").addEventListener("click", () => overlay.remove());
  }
}

window.addEventListener("online", () => {
  if (!profile) return;
  if (!peer || peer.destroyed) startPeer();
  else if (profile.role === "guest" && !connection?.open) connectToHost();
});
window.addEventListener("beforeunload", () => {
  localChannel?.close();
  peer?.destroy();
});
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
renderApp();
