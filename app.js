import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  runTransaction,
  onSnapshot,
  query,
  orderBy,
  deleteField,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const BUILTIN_QUESTIONS = [
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

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const provider = new GoogleAuthProvider();
const app = document.querySelector("#app");

let currentUser = null;
let userProfile = null;
let coupleId = null;
let couple = null;
let questions = [];
let ownAnswers = {};
let currentTab = "answer";
let syncState = "connecting";
let roomUnsubs = [];
let answerUnsubs = new Map();
let publishing = new Set();
const joinId = new URLSearchParams(location.hash.slice(1)).get("join");

function escapeHTML(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function toast(message) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2800);
}

function randomToken(bytes = 12) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  values.forEach((value) => binary += String.fromCharCode(value));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function roomIdFrom(code) {
  const bytes = new TextEncoder().encode(`${currentUser.uid}:${code.trim().toLowerCase()}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  digest.forEach((value) => binary += String.fromCharCode(value));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "").slice(0, 22);
}

function cleanupRoom() {
  roomUnsubs.forEach((unsubscribe) => unsubscribe());
  roomUnsubs = [];
  answerUnsubs.forEach((unsubscribe) => unsubscribe());
  answerUnsubs.clear();
  questions = [];
  ownAnswers = {};
  couple = null;
}

function renderLoading(message = "Opening your space…") {
  app.innerHTML = `<main class="welcome"><div class="brand"><span class="brand-mark">♥</span> Twogether</div><div class="sync-card" style="margin-top:35vh"><div class="sync-icon">⏳</div><h2>${escapeHTML(message)}</h2></div></main>`;
}

function renderLogin() {
  app.innerHTML = `<main class="welcome">
    <div class="brand"><span class="brand-mark">♥</span> Twogether</div>
    <div class="heart-pair"><div class="heart one">💌</div><div class="heart two">☁️</div></div>
    <p class="eyebrow">Private answers · saved together</p>
    <h1>Your questions, always here.</h1>
    <p class="welcome-copy">Sign in once, invite your person, and answer whenever you feel like it.</p>
    <section class="card stack"><button id="google-login" class="button primary"><span style="margin-right:8px">G</span> Continue with Google</button><div class="privacy-note"><span>🔒</span><span>Private answers can only be read by the person who wrote them until reveal.</span></div></section>
  </main>`;
  document.querySelector("#google-login").addEventListener("click", async () => {
    try {
      await setPersistence(auth, browserLocalPersistence);
      await signInWithPopup(auth, provider);
    } catch (error) {
      toast(error.code === "auth/unauthorized-domain" ? "Add this website to Firebase Authorized domains" : "Google sign-in did not finish");
    }
  });
}

async function loadAccount() {
  renderLoading();
  try {
    const snapshot = await getDoc(doc(db, "users", currentUser.uid));
    userProfile = snapshot.exists() ? snapshot.data() : null;
    if (joinId && userProfile?.coupleId !== joinId) return renderJoin();
    if (userProfile?.coupleId) return subscribeRoom(userProfile.coupleId);
    renderCreate();
  } catch (error) {
    renderSetupError(error);
  }
}

function defaultName() {
  return userProfile?.displayName || currentUser?.displayName || "";
}

function accountChip() {
  const photo = currentUser?.photoURL ? `<img src="${escapeHTML(currentUser.photoURL)}" alt="">` : "";
  return `<span class="account-chip">${photo}${escapeHTML(defaultName() || currentUser?.email || "Signed in")}</span>`;
}

function renderCreate() {
  app.innerHTML = `<main class="welcome">
    <div class="topbar"><div class="brand"><span class="brand-mark">♥</span> Twogether</div>${accountChip()}</div>
    <p class="eyebrow">Create your shared space</p><h1>Start with one link.</h1>
    <p class="welcome-copy">Choose how your name appears and make a private code to generate the invitation.</p>
    <form id="create-room" class="card stack">
      <div class="field"><label for="name">Your name</label><input id="name" required maxlength="24" value="${escapeHTML(defaultName())}" placeholder="Your name"></div>
      <div class="field"><label for="share-code">Private share code</label><input id="share-code" required minlength="6" maxlength="40" placeholder="Something memorable"></div>
      <button class="button primary" type="submit">Create our space</button>
      <button class="button ghost" id="sign-out" type="button">Use another Google account</button>
    </form>
  </main>`;
  document.querySelector("#sign-out").addEventListener("click", () => signOut(auth));
  document.querySelector("#create-room").addEventListener("submit", createRoom);
}

async function createRoom(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  button.textContent = "Creating…";
  const name = document.querySelector("#name").value.trim();
  const roomId = await roomIdFrom(document.querySelector("#share-code").value);
  try {
    const coupleRef = doc(db, "couples", roomId);
    const existing = await getDoc(coupleRef);
    if (!existing.exists()) {
      await setDoc(coupleRef, { memberIds: [currentUser.uid], names: { [currentUser.uid]: name }, createdBy: currentUser.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      const batch = writeBatch(db);
      BUILTIN_QUESTIONS.forEach((text, index) => {
        batch.set(doc(db, "couples", roomId, "questions", `builtin-${index + 1}`), {
          text, order: index, builtIn: true, createdBy: currentUser.uid, authorName: name,
          ready: {}, revealRequested: false, revealedAnswers: {}, createdAt: serverTimestamp()
        });
      });
      await batch.commit();
    }
    await setDoc(doc(db, "users", currentUser.uid), { displayName: name, email: currentUser.email || "", photoURL: currentUser.photoURL || "", coupleId: roomId, updatedAt: serverTimestamp() }, { merge: true });
    userProfile = { displayName: name, coupleId: roomId };
    subscribeRoom(roomId);
  } catch (error) {
    button.disabled = false;
    button.textContent = "Create our space";
    toast(friendlyError(error));
  }
}

function renderJoin() {
  app.innerHTML = `<main class="welcome">
    <div class="topbar"><div class="brand"><span class="brand-mark">♥</span> Twogether</div>${accountChip()}</div>
    <div class="heart-pair"><div class="heart one">👋</div><div class="heart two">💞</div></div>
    <p class="eyebrow">You're invited</p><h1>Join your person.</h1>
    <p class="welcome-copy">Choose the name they will see beside your answers.</p>
    <form id="join-room" class="card stack"><div class="field"><label for="name">Your name</label><input id="name" required maxlength="24" value="${escapeHTML(defaultName())}" placeholder="Your name"></div><button class="button primary" type="submit">Join and start answering</button><button class="button ghost" id="sign-out" type="button">Use another Google account</button></form>
  </main>`;
  document.querySelector("#sign-out").addEventListener("click", () => signOut(auth));
  document.querySelector("#join-room").addEventListener("submit", joinRoom);
}

async function joinRoom(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  button.textContent = "Joining…";
  const name = document.querySelector("#name").value.trim();
  try {
    await runTransaction(db, async (transaction) => {
      const coupleRef = doc(db, "couples", joinId);
      const snapshot = await transaction.get(coupleRef);
      if (!snapshot.exists()) throw new Error("invite-not-found");
      const data = snapshot.data();
      const members = data.memberIds || [];
      if (!members.includes(currentUser.uid) && members.length >= 2) throw new Error("room-full");
      if (!members.includes(currentUser.uid)) {
        transaction.update(coupleRef, { memberIds: [...members, currentUser.uid], [`names.${currentUser.uid}`]: name, updatedAt: serverTimestamp() });
      }
      transaction.set(doc(db, "users", currentUser.uid), { displayName: name, email: currentUser.email || "", photoURL: currentUser.photoURL || "", coupleId: joinId, updatedAt: serverTimestamp() }, { merge: true });
    });
    userProfile = { displayName: name, coupleId: joinId };
    subscribeRoom(joinId);
  } catch (error) {
    button.disabled = false;
    button.textContent = "Join and start answering";
    toast(friendlyError(error));
  }
}

function subscribeRoom(id) {
  cleanupRoom();
  coupleId = id;
  syncState = "connecting";
  renderLoading("Syncing your questions…");
  roomUnsubs.push(onSnapshot(doc(db, "couples", id), (snapshot) => {
    if (!snapshot.exists()) return renderSetupError(new Error("Room not found"));
    couple = snapshot.data();
    syncState = snapshot.metadata.fromCache ? "offline" : "live";
    renderApp();
  }, (error) => renderSetupError(error)));
  const questionsQuery = query(collection(db, "couples", id, "questions"), orderBy("order"));
  roomUnsubs.push(onSnapshot(questionsQuery, (snapshot) => {
    questions = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    syncState = snapshot.metadata.fromCache ? "offline" : "live";
    syncAnswerListeners();
    questions.forEach(maybePublishReveal);
    renderApp();
  }, (error) => renderSetupError(error)));
}

function syncAnswerListeners() {
  const active = new Set(questions.map((question) => question.id));
  answerUnsubs.forEach((unsubscribe, id) => {
    if (!active.has(id)) { unsubscribe(); answerUnsubs.delete(id); delete ownAnswers[id]; }
  });
  questions.forEach((question) => {
    if (answerUnsubs.has(question.id)) return;
    const answerRef = doc(db, "couples", coupleId, "questions", question.id, "privateAnswers", currentUser.uid);
    const unsubscribe = onSnapshot(answerRef, (snapshot) => {
      if (snapshot.exists()) ownAnswers[question.id] = snapshot.data().text || "";
      else delete ownAnswers[question.id];
      const freshQuestion = questions.find((item) => item.id === question.id);
      if (freshQuestion) maybePublishReveal(freshQuestion);
      renderApp();
    });
    answerUnsubs.set(question.id, unsubscribe);
  });
}

async function maybePublishReveal(question) {
  if (!question.revealRequested || !question.ready?.[currentUser.uid] || question.revealedAnswers?.[currentUser.uid] || publishing.has(question.id)) return;
  publishing.add(question.id);
  try {
    const answerRef = doc(db, "couples", coupleId, "questions", question.id, "privateAnswers", currentUser.uid);
    const snapshot = await getDoc(answerRef);
    if (snapshot.exists() && snapshot.data().text) {
      await updateDoc(doc(db, "couples", coupleId, "questions", question.id), { [`revealedAnswers.${currentUser.uid}`]: snapshot.data().text, updatedAt: serverTimestamp() });
    }
  } catch (error) { toast(friendlyError(error)); }
  finally { publishing.delete(question.id); }
}

function partnerId() { return couple?.memberIds?.find((id) => id !== currentUser.uid) || null; }
function myName() { return couple?.names?.[currentUser.uid] || userProfile?.displayName || currentUser.displayName || "You"; }
function partnerName() { const id = partnerId(); return id ? couple?.names?.[id] || "Partner" : "Your person"; }

function statusMarkup() {
  const waiting = !partnerId();
  const label = syncState === "offline" ? "Offline" : waiting ? "Waiting for partner" : "Saved live";
  const className = syncState === "offline" ? "offline" : waiting ? "waiting" : "live";
  return `<span class="live-pill ${className}"><span class="live-dot"></span>${label}</span>`;
}

function header(title, subtitle) {
  return `<header class="topbar"><div class="brand"><span class="brand-mark">♥</span> Twogether</div>${statusMarkup()}</header><section class="hero-row"><div><p class="eyebrow">${escapeHTML(subtitle)}</p><h2>${escapeHTML(title)}</h2></div></section>`;
}

function nav() {
  return `<nav class="bottom-nav" aria-label="Main navigation">${[["answer","✎","Answer"],["together","♥","Together"],["invite","↗","Invite"]].map(([id, icon, label]) => `<button class="nav-item ${currentTab === id ? "active" : ""}" data-tab="${id}"><span class="nav-icon">${icon}</span>${label}</button>`).join("")}</nav>`;
}

function renderApp() {
  if (!currentUser) return renderLogin();
  if (!coupleId || !couple) return;
  if (currentTab === "answer") renderQuestions();
  if (currentTab === "together") renderTogether();
  if (currentTab === "invite") renderInvite();
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { currentTab = button.dataset.tab; renderApp(); }));
}

function renderQuestions() {
  const count = questions.filter((question) => ownAnswers[question.id]).length;
  app.innerHTML = `${header(`Hi, ${myName()}`, "Your private answers")}<section class="hero-row"><p class="muted" style="margin:0">Saved to your account. Hidden until reveal.</p><div class="progress-ring" style="--progress:${questions.length ? count / questions.length * 360 : 0}deg"><span>${count}/${questions.length}</span></div></section><button id="add-question" class="button secondary add-question">＋ Add your own question</button><div class="question-list">${questions.map((question, index) => `<button class="question ${ownAnswers[question.id] ? "done" : ""}" data-question="${question.id}"><span class="question-number">${ownAnswers[question.id] ? "✓" : index + 1}</span><span class="question-title">${escapeHTML(question.text)}${question.builtIn ? "" : `<small>Added by ${escapeHTML(question.authorName || "Partner")}</small>`}</span><span class="question-status">›</span></button>`).join("")}</div>${nav()}`;
  document.querySelector("#add-question").addEventListener("click", addCustomQuestion);
  document.querySelectorAll("[data-question]").forEach((button) => button.addEventListener("click", () => editAnswer(button.dataset.question)));
}

function addCustomQuestion() {
  const overlay = document.createElement("div");
  overlay.className = "sheet-backdrop";
  overlay.innerHTML = `<section class="sheet"><div class="sheet-handle"></div><p class="eyebrow">Ask something personal</p><h2>Add your own question</h2><div class="field" style="margin-top:18px"><label for="custom-question">Question</label><textarea id="custom-question" maxlength="180" placeholder="What would you love to ask each other?"></textarea></div><div class="sheet-actions"><button class="button ghost" id="cancel">Cancel</button><button class="button primary" id="add">Add for both</button></div></section>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  document.querySelector("#cancel").addEventListener("click", close);
  document.querySelector("#add").addEventListener("click", async () => {
    const text = document.querySelector("#custom-question").value.trim();
    if (!text) return toast("Write a question first");
    const id = `custom-${randomToken(9)}`;
    try {
      await setDoc(doc(db, "couples", coupleId, "questions", id), { text, order: Date.now(), builtIn: false, createdBy: currentUser.uid, authorName: myName(), ready: {}, revealRequested: false, revealedAnswers: {}, createdAt: serverTimestamp() });
      close(); toast("Question added for both of you");
    } catch (error) { toast(friendlyError(error)); }
  });
  document.querySelector("#custom-question").focus();
}

function editAnswer(id) {
  const question = questions.find((item) => item.id === id);
  if (!question) return;
  const number = questions.findIndex((item) => item.id === id) + 1;
  const overlay = document.createElement("div");
  overlay.className = "sheet-backdrop";
  overlay.innerHTML = `<section class="sheet"><div class="sheet-handle"></div><p class="eyebrow">${escapeHTML(myName())} · Question ${number}</p><h2>${escapeHTML(question.text)}</h2><div class="field" style="margin-top:18px"><label for="answer">Your answer</label><textarea id="answer" maxlength="600" placeholder="Write what feels true…">${escapeHTML(ownAnswers[id] || "")}</textarea></div><div class="sheet-actions"><button class="button ghost" id="cancel">Cancel</button><button class="button primary" id="save">Save privately</button></div></section>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  document.querySelector("#cancel").addEventListener("click", close);
  document.querySelector("#save").addEventListener("click", async () => {
    const value = document.querySelector("#answer").value.trim();
    const answerRef = doc(db, "couples", coupleId, "questions", id, "privateAnswers", currentUser.uid);
    const questionRef = doc(db, "couples", coupleId, "questions", id);
    try {
      if (value) await setDoc(answerRef, { text: value, ownerId: currentUser.uid, updatedAt: serverTimestamp() });
      else await deleteDoc(answerRef);
      await updateDoc(questionRef, { [`ready.${currentUser.uid}`]: Boolean(value), [`revealedAnswers.${currentUser.uid}`]: deleteField(), revealRequested: false, updatedAt: serverTimestamp() });
      close(); toast("Saved privately to your account");
    } catch (error) { toast(friendlyError(error)); }
  });
  document.querySelector("#answer").focus();
}

function renderTogether() {
  const otherId = partnerId();
  const matching = questions.filter((question) => otherId && question.ready?.[currentUser.uid] && question.ready?.[otherId]);
  app.innerHTML = `${header("Reveal together", "Updates automatically")}<section class="card sync-card"><div class="sync-icon">${otherId ? "✨" : "⏳"}</div><h2>${otherId ? `${matching.length} ready` : "Waiting for your person"}</h2><p class="muted">You can answer at different times. When either person reveals, both answers appear here.</p></section><div class="reveal-grid">${questions.map((question) => {
    const mineReady = Boolean(question.ready?.[currentUser.uid]);
    const theirsReady = Boolean(otherId && question.ready?.[otherId]);
    const mine = question.revealedAnswers?.[currentUser.uid];
    const theirs = otherId ? question.revealedAnswers?.[otherId] : null;
    const open = Boolean(mine && theirs);
    return `<article class="reveal-card"><p class="reveal-question">${escapeHTML(question.text)}</p><div class="ready-row"><span>${mineReady ? "✓" : "○"} ${escapeHTML(myName())}</span><span>${theirsReady ? "✓" : "○"} ${escapeHTML(partnerName())}</span></div>${open ? `<div class="answers"><div class="answer"><div class="answer-name">${escapeHTML(myName())}</div><div class="answer-text">${escapeHTML(mine)}</div></div><div class="answer partner"><div class="answer-name">${escapeHTML(partnerName())}</div><div class="answer-text">${escapeHTML(theirs)}</div></div></div>` : `<button class="button ${mineReady && theirsReady ? "primary" : "ghost"}" data-reveal="${question.id}" ${mineReady && theirsReady ? "" : "disabled"}>${mineReady && theirsReady ? (question.revealRequested ? "Revealing…" : "Reveal this answer") : "Waiting for both answers"}</button>`}</article>`;
  }).join("")}</div>${nav()}`;
  document.querySelectorAll("[data-reveal]").forEach((button) => button.addEventListener("click", async () => {
    try { await updateDoc(doc(db, "couples", coupleId, "questions", button.dataset.reveal), { revealRequested: true, updatedAt: serverTimestamp() }); }
    catch (error) { toast(friendlyError(error)); }
  }));
}

function inviteLink() { return `${location.origin}${location.pathname}#join=${coupleId}`; }

function renderInvite() {
  app.innerHTML = `${header("Your shared space", "Google account + Firestore")}<section class="card sync-card"><div class="sync-icon">🔗</div><h2>${partnerId() ? `${escapeHTML(myName())} + ${escapeHTML(partnerName())}` : "Invite your person"}</h2><p class="muted">${partnerId() ? "Your questions and answers are saved and will synchronize whenever either of you returns." : "Send this link. They sign in with Google, choose their name, and join your room."}</p><div class="stack"><button id="share-link" class="button primary">Share invite link</button><button id="copy-link" class="button ghost">Copy invite link</button></div></section><section class="card account-card"><div>${accountChip()}<p class="muted small">${escapeHTML(currentUser.email || "")}</p></div><button id="sign-out" class="button ghost inline">Sign out</button></section>${nav()}`;
  document.querySelector("#share-link").addEventListener("click", shareInvite);
  document.querySelector("#copy-link").addEventListener("click", copyInvite);
  document.querySelector("#sign-out").addEventListener("click", () => signOut(auth));
}

async function shareInvite() {
  const url = inviteLink();
  if (navigator.share) {
    try { await navigator.share({ title: "Join me on Twogether", text: `${myName()} invited you to answer together 💌`, url }); return; }
    catch (error) { if (error.name === "AbortError") return; }
  }
  copyInvite();
}

async function copyInvite() {
  try { await navigator.clipboard.writeText(inviteLink()); toast("Invite link copied"); }
  catch { toast("Press and hold the address bar to copy this link"); }
}

function friendlyError(error) {
  const value = `${error?.code || ""} ${error?.message || ""}`;
  if (value.includes("permission-denied")) return "Firebase permissions are not configured yet";
  if (value.includes("invite-not-found")) return "This invitation was not found";
  if (value.includes("room-full")) return "This room already has two people";
  if (value.includes("unauthorized-domain")) return "Add this website to Firebase Authorized domains";
  return "Could not save that change. Please try again.";
}

function renderSetupError(error) {
  app.innerHTML = `<main class="welcome"><div class="brand"><span class="brand-mark">♥</span> Twogether</div><section class="card sync-card"><div class="sync-icon">⚙️</div><h2>Firebase setup needed</h2><p class="muted">${escapeHTML(friendlyError(error))}</p><button id="retry" class="button primary">Try again</button></section></main>`;
  document.querySelector("#retry").addEventListener("click", loadAccount);
}

onAuthStateChanged(auth, (user) => {
  cleanupRoom();
  currentUser = user;
  userProfile = null;
  coupleId = null;
  if (user) loadAccount();
  else renderLogin();
});

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
