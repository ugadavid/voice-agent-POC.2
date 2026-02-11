import { randomUUID } from "crypto";
import { MEMORY } from "../constants.js";

/**
 * Simple in-memory session store.
 * - Keeps a rolling window of turns in RAM
 * - Moves oldest turns into a lightweight textual summary when exceeding limits
 *
 * NOTE: This is intentionally minimal for the POC. Tomorrow we can move this to Postgres.
 */

const sessions = new Map();

// Defaults (POC-friendly)
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_TURNS_IN_RAM = 18; // rolling window (user+assistant)
const MAX_SUMMARY_CHARS = 4000;

function now() {
  return Date.now();
}

function normalizeTurn(role, content) {
  if (role !== "user" && role !== "assistant") return null;
  const safe = String(content || "").trim();
  if (!safe) return null;
  return {
    role,
    content: safe.slice(0, MEMORY.MAX_CONTENT_CHARS),
    ts: now(),
  };
}

function appendToSummary(summary, turn) {
  const line = `${turn.role === "user" ? "U" : "A"}: ${turn.content}`;
  const next = (summary ? `${summary}\n` : "") + line;
  if (next.length <= MAX_SUMMARY_CHARS) return next;
  // Keep the end (most recent) if we overflow
  return next.slice(next.length - MAX_SUMMARY_CHARS);
}

export function createSession() {
  const sessionId = randomUUID();
  const s = {
    sessionId,
    createdAt: now(),
    updatedAt: now(),
    summary: "",
    turns: [],
  };
  sessions.set(sessionId, s);
  return s;
}

export function getOrCreateSession(sessionId) {
  if (sessionId && sessions.has(sessionId)) {
    const s = sessions.get(sessionId);
    // TTL refresh
    s.updatedAt = now();
    return s;
  }
  return createSession();
}

export function appendTurn(sessionId, role, content) {
  const s = getOrCreateSession(sessionId);
  const t = normalizeTurn(role, content);
  if (!t) return s;

  s.turns.push(t);
  s.updatedAt = now();

  // If too many turns, move oldest into summary
  while (s.turns.length > MAX_TURNS_IN_RAM) {
    const oldest = s.turns.shift();
    if (oldest) s.summary = appendToSummary(s.summary, oldest);
  }

  return s;
}

export function getMemory(sessionId) {
  const s = getOrCreateSession(sessionId);
  return {
    sessionId: s.sessionId,
    summary: s.summary,
    turns: s.turns.map(({ role, content }) => ({ role, content })),
  };
}

export function cleanupSessions() {
  const t = now();
  for (const [id, s] of sessions.entries()) {
    if (t - s.updatedAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

// Best-effort cleanup every 10 minutes (doesn't keep Node alive)
const interval = setInterval(cleanupSessions, 10 * 60 * 1000);
interval.unref?.();
