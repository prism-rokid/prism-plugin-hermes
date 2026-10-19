"use strict";

// Desktop-initiated Hermes runs never pass through the Hub's forward-run
// waiter, so their terminal push needs explicit detection here. The desktop
// watcher observes page state only (foreground composer); run completion is
// data state and is read from the session DB, which records every session
// regardless of which conversation is foreground.

const DESKTOP_RUN_TRACK_TIMEOUT_MS = 30 * 60 * 1000;

// finish_reason values are Hermes/LLM passthrough strings. Tool handoffs and
// rows without a finish reason are intermediate steps, not terminal turns.
function desktopTerminalClassify(finishReason, row = null) {
  const normalized = String(finishReason || "").trim().toLowerCase();
  if (/(tool_calls?|function_call|tool_use)/.test(normalized)) return null;
  if (!normalized) {
    const content = String((row && (row.content || row.api_content)) || "").trim();
    return content ? "interrupted" : null;
  }
  if (/(abort|cancel|interrupt)/.test(normalized)) return "interrupted";
  if (/(error|fail)/.test(normalized)) return "failed";
  return "completed";
}

function createDesktopRunWatch({ readRowsAfter, now = () => Date.now() } = {}) {
  if (typeof readRowsAfter !== "function") {
    throw new Error("readRowsAfter required");
  }
  const trackers = new Map(); // sessionID -> { baselineID, startedAt }
  const emitted = new Map(); // sessionID -> { status, evidence }

  function start(sessionID, baselineID) {
    const id = String(sessionID || "").trim();
    if (!id || trackers.has(id)) return false;
    trackers.set(id, { baselineID: Math.max(0, Number(baselineID) || 0), startedAt: now() });
    return true;
  }

  function stop(sessionID) {
    trackers.delete(String(sessionID || "").trim());
  }

  // One poll tick of the desktop watcher. A tracked run settles when the
  // session DB contains an assistant row newer than the registration
  // baseline; the resulting event is returned once per settled run.
  async function drain() {
    const events = [];
    const currentTime = now();
    for (const [sessionID, tracker] of [...trackers.entries()]) {
      if (currentTime - tracker.startedAt >= DESKTOP_RUN_TRACK_TIMEOUT_MS) {
        trackers.delete(sessionID);
        continue;
      }
      let rows = [];
      try {
        rows = await readRowsAfter(sessionID, tracker.baselineID);
      } catch {
        continue; // transient DB failure: retry on the next tick
      }
      const assistant = (Array.isArray(rows) ? rows : []).find((row) => (
        String((row && row.role) || "").trim().toLowerCase() === "assistant"
        && desktopTerminalClassify(row.finish_reason, row) !== null
      ));
      if (!assistant) continue;
      trackers.delete(sessionID);
      const status = desktopTerminalClassify(assistant.finish_reason, assistant);
      const evidence = Math.max(0, Number(assistant.id) || 0);
      const recorded = emitted.get(sessionID);
      if (recorded && recorded.status === status && evidence <= recorded.evidence) continue;
      emitted.set(sessionID, { status, evidence });
      events.push({ sessionID, status, evidence, rows });
    }
    return events;
  }

  function activeCount() {
    return trackers.size;
  }

  return { start, stop, drain, activeCount };
}

module.exports = {
  DESKTOP_RUN_TRACK_TIMEOUT_MS,
  createDesktopRunWatch,
  desktopTerminalClassify,
};
