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

const STORAGE_KEY = "twogether.profile.v1";
const VAULT_KEY = "twogether.vault.v1";
const PARTNER_KEY = "twogether.partner.v1";
const enc = new TextEncoder();
const dec = new TextDecoder();

let profile = readJSON(STORAGE_KEY);
let key = null;
let answers = {};
let partnerAnswers = null;
let currentTab = "answer";
let pendingShare = getHashShare();
let revealed = false;

const app = document.querySelector("#app");

function readJSON(name) {
  try { return JSON.parse(localStorage.getItem(name)); } catch { return null; }
}

function writeJSON(name, value) { localStorage.setItem(name, JSON.stringify(value)); }

function bytesToB64(bytes) {
  let binary = "";
  bytes.forEach((b) => binary += String.fromCharCode(b));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64ToBytes(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function deriveKey(coupleId, password) {
  const material = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(`twogether:v1:${coupleId.trim().toLowerCase()}`), iterations: 180000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function verifier(coupleId, password) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(`twogether-check:${coupleId.trim().toLowerCase()}:${password}`));
  return bytesToB64(new Uint8Array(digest)).slice(0, 24);
}

async function seal(value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(value)));
  return { iv: bytesToB64(iv), data: bytesToB64(new Uint8Array(cipher)) };
}

async function openBox(box) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(box.iv) }, key, b64ToBytes(box.data));
  return JSON.parse(dec.decode(plain));
}

async function saveVault() { writeJSON(VAULT_KEY, await seal(answers)); }

function escapeHTML(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
}

function getHashShare() {
  const params = new URLSearchParams(location.hash.slice(1));
  return params.get("share");
}

function profileForm(mode = "create") {
  const importedId = (() => {
    if (!pendingShare) return "";
    try { return JSON.parse(dec.decode(b64ToBytes(pendingShare))).coupleId || ""; } catch { return ""; }
  })();
  app.innerHTML = `
    <main class="welcome">
      <div class="brand"><span class="brand-mark">♥</span> Twogether</div>
      <div class="heart-pair"><div class="heart one">💌</div><div class="heart two">🔐</div></div>
      <p class="eyebrow">Answer privately · reveal together</p>
      <h1>${mode === "unlock" ? "Welcome back." : "Just the two of you."}</h1>
      <p class="welcome-copy">${mode === "unlock" ? `Unlock your private answers for <strong>${escapeHTML(profile.coupleId)}</strong>.` : "A tiny private question game for you and your favorite person."}</p>
      <form id="profile-form" class="card stack">
        ${mode === "create" ? `
          <div class="field"><label for="coupleId">Couple ID</label><input id="coupleId" required maxlength="24" value="${escapeHTML(importedId)}" placeholder="e.g. mango-moon" autocapitalize="none" autocomplete="off"></div>
          <div class="field"><label for="myName">Your name</label><input id="myName" required maxlength="24" placeholder="Your name" autocomplete="nickname"></div>
          <div class="field"><label for="partnerName">Partner's name</label><input id="partnerName" required maxlength="24" placeholder="Their name" autocomplete="off"></div>
        ` : ""}
        <div class="field"><label for="password">Shared password</label><input id="password" type="password" required minlength="6" placeholder="At least 6 characters" autocomplete="current-password"></div>
        <button class="button primary" type="submit">${mode === "unlock" ? "Unlock" : "Create our space"}</button>
        ${mode === "unlock" ? `<button id="use-different" class="button ghost" type="button">Use a different couple ID</button>` : ""}
        <div class="privacy-note"><span>🔒</span><span>Your password and answers never leave your devices unencrypted. If you forget the password, the answers cannot be recovered.</span></div>
      </form>
    </main>`;

  document.querySelector("#profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = document.querySelector("#password").value;
    if (mode === "unlock") {
      if (await verifier(profile.coupleId, password) !== profile.verifier) return toast("That password doesn't match");
      key = await deriveKey(profile.coupleId, password);
      try {
        const vault = readJSON(VAULT_KEY);
        answers = vault ? await openBox(vault) : {};
        const storedPartner = readJSON(PARTNER_KEY);
        partnerAnswers = storedPartner ? await openBox(storedPartner) : null;
      } catch { return toast("Could not open the saved answers"); }
    } else {
      const coupleId = document.querySelector("#coupleId").value.trim().toLowerCase().replace(/\s+/g, "-");
      profile = {
        coupleId,
        myName: document.querySelector("#myName").value.trim(),
        partnerName: document.querySelector("#partnerName").value.trim(),
        verifier: await verifier(coupleId, password)
      };
      key = await deriveKey(coupleId, password);
      writeJSON(STORAGE_KEY, profile);
      answers = {};
      await saveVault();
    }
    if (pendingShare) await importShare(pendingShare, true);
    history.replaceState(null, "", location.pathname + location.search);
    renderApp();
  });

  document.querySelector("#use-different")?.addEventListener("click", () => {
    if (!confirm("Remove this local profile from this phone?")) return;
    localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(VAULT_KEY); localStorage.removeItem(PARTNER_KEY);
    profile = null; key = null; answers = {}; partnerAnswers = null; profileForm("create");
  });
}

function header(title, subtitle) {
  return `<header class="topbar"><div class="brand"><span class="brand-mark">♥</span> Twogether</div><button class="icon-button" id="settings" aria-label="Settings">⚙</button></header>
    <section class="hero-row"><div><p class="eyebrow">${escapeHTML(subtitle)}</p><h2>${escapeHTML(title)}</h2></div></section>`;
}

function nav() {
  return `<nav class="bottom-nav" aria-label="Main navigation">
    ${[["answer","✎","Answer"],["sync","↗","Share"],["reveal","♥","Reveal"]].map(([id, icon, label]) => `<button class="nav-item ${currentTab === id ? "active" : ""}" data-tab="${id}"><span class="nav-icon">${icon}</span>${label}</button>`).join("")}
  </nav>`;
}

function renderApp() {
  if (!profile) return profileForm("create");
  if (!key) return profileForm("unlock");
  if (currentTab === "answer") renderQuestions();
  if (currentTab === "sync") renderSync();
  if (currentTab === "reveal") renderReveal();
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { currentTab = button.dataset.tab; revealed = false; renderApp(); }));
  document.querySelector("#settings")?.addEventListener("click", renderSettings);
}

function renderQuestions() {
  const count = Object.values(answers).filter(Boolean).length;
  app.innerHTML = `${header(`Hi, ${profile.myName}`, `${profile.coupleId} · your answers`)}
    <section class="hero-row"><p class="muted" style="margin:0">Take your time. ${profile.partnerName} can't see these yet.</p><div class="progress-ring" style="--progress:${count / QUESTIONS.length * 360}deg"><span>${count}/${QUESTIONS.length}</span></div></section>
    <div class="question-list">${QUESTIONS.map((question, index) => `<button class="question ${answers[index] ? "done" : ""}" data-question="${index}"><span class="question-number">${answers[index] ? "✓" : index + 1}</span><span class="question-title">${escapeHTML(question)}</span><span class="question-status">›</span></button>`).join("")}</div>${nav()}`;
  document.querySelectorAll("[data-question]").forEach((button) => button.addEventListener("click", () => editAnswer(Number(button.dataset.question))));
}

function editAnswer(index) {
  const overlay = document.createElement("div");
  overlay.className = "sheet-backdrop";
  overlay.innerHTML = `<section class="sheet"><div class="sheet-handle"></div><p class="eyebrow">Question ${index + 1}</p><h2>${escapeHTML(QUESTIONS[index])}</h2><div class="field" style="margin-top:18px"><label for="answer">Your answer</label><textarea id="answer" maxlength="600" placeholder="Write what feels true…">${escapeHTML(answers[index] || "")}</textarea></div><div class="sheet-actions"><button class="button ghost" id="cancel">Cancel</button><button class="button primary" id="save">Save privately</button></div></section>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.querySelector("#cancel").addEventListener("click", close);
  document.querySelector("#save").addEventListener("click", async () => {
    const value = document.querySelector("#answer").value.trim();
    if (value) answers[index] = value; else delete answers[index];
    await saveVault(); close(); renderApp(); toast("Saved on this phone");
  });
  document.querySelector("#answer").focus();
}

async function makeSharePayload() {
  return bytesToB64(enc.encode(JSON.stringify({ v: 1, coupleId: profile.coupleId, owner: profile.myName, box: await seal({ answers, sentAt: Date.now() }) })));
}

function renderSync() {
  const count = Object.values(answers).filter(Boolean).length;
  app.innerHTML = `${header("Exchange answers", "Private handoff")}
    <div class="stack">
      <section class="card sync-card"><div class="sync-icon">💌</div><h2>Send yours</h2><p class="muted">Creates an encrypted link you can send to ${escapeHTML(profile.partnerName)}. Only your shared password can open it.</p><p class="small"><strong>${count}</strong> answered question${count === 1 ? "" : "s"}</p><div class="stack"><button id="share" class="button primary" ${count ? "" : "disabled"}>Share my answers</button><button id="copy-link" class="button ghost" ${count ? "" : "disabled"}>Copy encrypted link</button></div></section>
      <section class="card sync-card"><div class="sync-icon">📥</div><h2>Receive theirs</h2><p class="muted">Open their link, or paste the answer code here.</p>${partnerAnswers ? `<p><span class="status-pill"><span class="dot"></span> ${escapeHTML(profile.partnerName)}'s answers received</span></p>` : ""}<div class="field" style="text-align:left"><label for="import-code">Answer code</label><textarea id="import-code" style="min-height:82px" placeholder="Paste code here"></textarea></div><button id="import" class="button secondary">Import answers</button></section>
    </div>${nav()}`;
  document.querySelector("#share").addEventListener("click", shareAnswers);
  document.querySelector("#copy-link").addEventListener("click", copyAnswerLink);
  document.querySelector("#import").addEventListener("click", async () => {
    let value = document.querySelector("#import-code").value.trim();
    if (value.includes("#share=")) value = new URL(value).hash.slice(7);
    if (await importShare(value)) { renderApp(); toast("Answers received — still hidden"); }
  });
}

async function shareAnswers() {
  const payload = await makeSharePayload();
  const url = `${location.origin}${location.pathname}#share=${payload}`;
  if (navigator.share) {
    try { await navigator.share({ title: "My Twogether answers", text: `I answered our questions 💌 Open this link and use our shared password.`, url }); return; } catch (error) { if (error.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); toast("Encrypted link copied"); }
  catch { showShareCode(url); }
}

async function copyAnswerLink() {
  const payload = await makeSharePayload();
  const url = `${location.origin}${location.pathname}#share=${payload}`;
  try { await navigator.clipboard.writeText(url); toast("Encrypted link copied"); }
  catch { showShareCode(url); }
}

function showShareCode(value) {
  const overlay = document.createElement("div"); overlay.className = "sheet-backdrop";
  overlay.innerHTML = `<section class="sheet"><div class="sheet-handle"></div><h2>Copy this link</h2><p class="muted">Send it only to ${escapeHTML(profile.partnerName)}.</p><div class="code-box">${escapeHTML(value)}</div><button class="button primary" id="close-code">Done</button></section>`;
  document.body.appendChild(overlay); document.querySelector("#close-code").addEventListener("click", () => overlay.remove());
}

async function importShare(payload, quiet = false) {
  try {
    const pack = JSON.parse(dec.decode(b64ToBytes(payload)));
    if (pack.v !== 1 || pack.coupleId !== profile.coupleId) throw new Error("different couple");
    const opened = await openBox(pack.box);
    partnerAnswers = { owner: pack.owner, ...opened };
    writeJSON(PARTNER_KEY, await seal(partnerAnswers));
    pendingShare = null;
    return true;
  } catch (error) {
    if (!quiet) toast(error.message === "different couple" ? "This link is for a different couple ID" : "Could not open that code");
    return false;
  }
}

function renderReveal() {
  const theirs = partnerAnswers?.answers || {};
  const shared = QUESTIONS.map((_, i) => i).filter((i) => answers[i] && theirs[i]);
  app.innerHTML = `${header("The big reveal", partnerAnswers ? "Both sides are here" : "Waiting for their answers")}
    <section class="card sync-card">
      <div class="sync-icon">${partnerAnswers ? "✨" : "⏳"}</div>
      <h2>${partnerAnswers ? `${shared.length} ready to reveal` : `Ask ${escapeHTML(profile.partnerName)} to share`}</h2>
      <p class="muted">${partnerAnswers ? "Sit together, count to three, and uncover your answers." : "Once you import their encrypted link, your matching answers will appear here."}</p>
      ${partnerAnswers ? `<button id="reveal-all" class="button primary" ${shared.length ? "" : "disabled"}>${revealed ? "Hide answers" : "Reveal together"}</button>` : `<button class="button secondary" data-go-sync>Go to sharing</button>`}
    </section>
    <div class="reveal-grid">${shared.map((index) => `<article class="reveal-card"><p class="reveal-question">${escapeHTML(QUESTIONS[index])}</p><div class="answers"><div class="answer ${revealed ? "" : "covered"}"><div><div class="answer-name">${escapeHTML(profile.myName)}</div><div class="answer-text">${revealed ? escapeHTML(answers[index]) : "Secret answer"}</div></div></div><div class="answer partner ${revealed ? "" : "covered"}"><div><div class="answer-name">${escapeHTML(profile.partnerName)}</div><div class="answer-text">${revealed ? escapeHTML(theirs[index]) : "Secret answer"}</div></div></div></div></article>`).join("") || (partnerAnswers ? `<div class="empty">You don't have any matching answered questions yet.</div>` : "")}</div>${nav()}`;
  document.querySelector("#reveal-all")?.addEventListener("click", () => { revealed = !revealed; renderApp(); });
  document.querySelector("[data-go-sync]")?.addEventListener("click", () => { currentTab = "sync"; renderApp(); });
}

function renderSettings() {
  const overlay = document.createElement("div"); overlay.className = "sheet-backdrop";
  overlay.innerHTML = `<section class="sheet"><div class="sheet-handle"></div><p class="eyebrow">Settings</p><h2>${escapeHTML(profile.coupleId)}</h2><p class="muted">${escapeHTML(profile.myName)} + ${escapeHTML(profile.partnerName)}</p><div class="divider"></div><div class="privacy-note"><span>☁️</span><span><strong>No account. No database.</strong><br>Everything is stored on this phone. Shared links contain encrypted answers.</span></div><div class="stack" style="margin-top:18px"><button class="button ghost" id="lock">Lock now</button><button class="button danger" id="reset">Erase this phone's data</button><button class="button secondary" id="close-settings">Done</button></div></section>`;
  document.body.appendChild(overlay);
  document.querySelector("#close-settings").addEventListener("click", () => overlay.remove());
  document.querySelector("#lock").addEventListener("click", () => { key = null; answers = {}; partnerAnswers = null; overlay.remove(); profileForm("unlock"); });
  document.querySelector("#reset").addEventListener("click", () => {
    if (!confirm("Erase your profile and all answers stored on this phone? This cannot be undone.")) return;
    localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(VAULT_KEY); localStorage.removeItem(PARTNER_KEY);
    profile = null; key = null; answers = {}; partnerAnswers = null; overlay.remove(); profileForm("create");
  });
}

window.addEventListener("hashchange", async () => {
  pendingShare = getHashShare();
  if (pendingShare && key && await importShare(pendingShare)) { history.replaceState(null, "", location.pathname + location.search); currentTab = "reveal"; renderApp(); toast("Answers received — reveal when you're together"); }
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
renderApp();
