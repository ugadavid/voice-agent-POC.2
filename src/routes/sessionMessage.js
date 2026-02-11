import { SCHEMA, MEMORY, MODELS } from "../constants.js";
import { sanitizeEmotion, sanitizeIntent } from "../utils/sanitize.js";
import { toHttpError } from "../utils/errors.js";
import { synthesizeMp3Base64 } from "../services/tts.js";
import { appendTurn, getMemory, getOrCreateSession } from "../services/sessionStore.js";

/**
 * Storyline-friendly endpoint.
 * Keeps session memory server-side (RAM) and returns a structured JSON response.
 *
 * Request:
 *  { sessionId?: string, text: string, noAudio?: boolean }
 * Response:
 *  { sessionId, intent, emotion, confidence, replyText, audioMp3Base64? }
 */
export function registerSessionMessageRoute(app, { openai, SYSTEM_PROMPT, STRUCTURED_INSTRUCTIONS }) {
  app.post("/api/session/message", async (req, res) => {
    try {
      const incomingSessionId = String(req.body?.sessionId || "").trim();
      const userText = String(req.body?.text || "").trim();
      const noAudio = !!req.body?.noAudio;

      const session = getOrCreateSession(incomingSessionId || null);
      const sessionId = session.sessionId;

      // Store user turn
      appendTurn(sessionId, "user", userText || "(silence)");

      const mem = getMemory(sessionId);

      // Build messages
      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: STRUCTURED_INSTRUCTIONS },
      ];

      if (mem.summary) {
        messages.push({ role: "system", content: `Résumé de conversation (contexte) :\n${mem.summary}` });
      }

      for (const t of mem.turns) {
        if (!t) continue;
        if (t.role !== "user" && t.role !== "assistant") continue;
        const content = String(t.content || "").slice(0, MEMORY.MAX_CONTENT_CHARS);
        messages.push({ role: t.role, content });
      }

      // Always ensure the last user message is present
      if (userText) messages.push({ role: "user", content: userText });

      const completion = await openai.chat.completions.create({
        model: MODELS.CHAT,
        messages,
        response_format: { type: "json_object" },
      });

      const raw = completion.choices?.[0]?.message?.content || "{}";

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = {
          intent: "redirect_to_humans",
          emotion: "neutral",
          confidence: 0.2,
          replyText:
            "Je n'ai pas réussi à produire une réponse structurée. Pouvez-vous reformuler, ou demander à un membre de l'équipe ?",
        };
      }

      const allowedIntents = new Set(SCHEMA.ALLOWED_INTENTS);
      const allowedEmotions = new Set(SCHEMA.ALLOWED_EMOTIONS);

      if (!allowedIntents.has(parsed.intent)) parsed.intent = sanitizeIntent(parsed.intent);
      if (!allowedEmotions.has(parsed.emotion)) parsed.emotion = sanitizeEmotion(parsed.emotion);

      // Safety / out-of-scope handling
      if (parsed.intent === "refuse_out_of_scope") {
        parsed.replyText =
          String(parsed.replyText || "").trim() ||
          "Cette question ne concerne pas directement le projet que je présente. Mon rôle est limité à l’explication du dispositif. Pour ce sujet, je vous invite à vous adresser à un membre de l’équipe humaine.";
        parsed.replyText = parsed.replyText.replace(/^./, (c) => c.toUpperCase());
      }

      // Store assistant turn
      appendTurn(sessionId, "assistant", parsed.replyText);

      let audioMp3Base64 = null;
      if (!noAudio) {
        audioMp3Base64 = await synthesizeMp3Base64(openai, parsed.replyText);
      }

      res.json({
        sessionId,
        intent: parsed.intent,
        emotion: parsed.emotion,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        replyText: parsed.replyText,
        audioMp3Base64,
      });
    } catch (err) {
      const { status, message } = toHttpError(err);
      res.status(status).json({ error: message });
    }
  });
}
