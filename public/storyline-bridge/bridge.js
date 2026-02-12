/*
 * Storyline Bridge
 * - Receives: { type: 'AGENT_REQUEST', payload: { text, noAudio?, sessionId? } }
 * - Sends:    { type: 'AGENT_RESULT', payload: { sessionId, replyText, intent, emotion, confidence, transcript? } }
 */

let sessionId = null;

const $ = (id) => document.getElementById(id);
const logEl = $("log");
const audioEl = $("audio");

const playBtn = $("playFallback");
let lastAudioUrl = null;

if (playBtn) {
  playBtn.addEventListener("click", () => {
    if (!lastAudioUrl) return;
    audioEl.play().catch(() => {});
    playBtn.style.display = "none";
  });
}




function log(...args) {
  const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2))).join(" ");
  logEl.textContent = line + "\n" + logEl.textContent;
}

function mp3Base64ToBlobUrl(b64) {
  if (!b64) return null;
  const bytes = atob(b64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  const blob = new Blob([buf], { type: "audio/mpeg" });
  return URL.createObjectURL(blob);
}

async function sendToAgent(text, { noAudio = false } = {}) {
  const r = await fetch("/api/session/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, text, noAudio }),
  });

  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${r.status}`);
  }

  const data = await r.json();
  sessionId = data.sessionId || sessionId;
  return data;
}

function sendToStoryline(payload) {
  // Storyline is the parent when used as a WebObject
  parent.postMessage({ type: "AGENT_RESULT", payload }, "*");
}

async function handleRequest(text, opts = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return;

  const data = await sendToAgent(trimmed, opts);
  log("AGENT_RESULT:", data);

  const url = mp3Base64ToBlobUrl(data.audioMp3Base64);
  if (url) {
    lastAudioUrl = url;
    audioEl.src = url;

    // Tentative autoplay
    const p = audioEl.play?.();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        // Bloqué → on montre un bouton Play dans l’iframe
        if (playBtn) playBtn.style.display = "inline-block";
      });
    }
  }


  sendToStoryline({
    sessionId: data.sessionId,
    replyText: data.replyText,
    intent: data.intent,
    emotion: data.emotion,
    confidence: data.confidence,
    audioUrl: data.audioUrl,
  });
}

// UI for manual testing
$("send").addEventListener("click", async () => {
  try {
    await handleRequest($("text").value, { noAudio: false });
    $("text").value = "";
  } catch (e) {
    log("ERROR:", String(e.message || e));
  }
});

$("text").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("send").click();
});

$("reset").addEventListener("click", () => {
  sessionId = null;
  log("Session reset.");
});

// Storyline postMessage API
window.addEventListener("message", async (event) => {
  const msg = event.data;
  if (!msg || msg.type !== "AGENT_REQUEST") return;

  try {
    const p = msg.payload || {};
    if (p.sessionId) sessionId = String(p.sessionId);
    await handleRequest(p.text, { noAudio: !!p.noAudio });
  } catch (e) {
    const errPayload = { error: String(e.message || e), sessionId };
    log("ERROR:", errPayload);
    parent.postMessage({ type: "AGENT_ERROR", payload: errPayload }, "*");
  }
});

log("Bridge ready. sessionId=null");
