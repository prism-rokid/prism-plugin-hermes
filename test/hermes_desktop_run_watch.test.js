"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DESKTOP_RUN_TRACK_TIMEOUT_MS,
  createDesktopRunWatch,
  desktopTerminalClassify,
} = require("../hermes_desktop_run_watch");

function assistantRow(id, finishReason = "stop") {
  return { id, role: "assistant", content: `回复 ${id}`, finish_reason: finishReason, timestamp: 0 };
}

test("finish_reason classifies into completed, failed, and interrupted", () => {
  assert.equal(desktopTerminalClassify("stop"), "completed");
  assert.equal(desktopTerminalClassify(""), "completed");
  assert.equal(desktopTerminalClassify("tool_calls"), "completed");
  assert.equal(desktopTerminalClassify("aborted by user"), "interrupted");
  assert.equal(desktopTerminalClassify("cancelled"), "interrupted");
  assert.equal(desktopTerminalClassify("api_error"), "failed");
  assert.equal(desktopTerminalClassify("failure: timeout"), "failed");
});

test("tracker settles when an assistant row lands after the baseline", async () => {
  let clock = 1000;
  let landed = false;
  const watch = createDesktopRunWatch({
    readRowsAfter: async (sessionID, afterID) => {
      if (sessionID !== "sess-1" || !landed) return [];
      return [assistantRow(100)].filter((row) => row.id > afterID);
    },
    now: () => clock,
  });

  assert.equal(watch.start("sess-1", 90), true);
  // 重复登记被忽略
  assert.equal(watch.start("sess-1", 95), false);

  // 基线之后还没有 assistant 行 → 不结算
  let events = await watch.drain();
  assert.equal(events.length, 0);
  assert.equal(watch.activeCount(), 1);

  // 出现 assistant 行 → 结算一次并注销
  landed = true;
  events = await watch.drain();
  assert.equal(events.length, 1);
  assert.equal(events[0].sessionID, "sess-1");
  assert.equal(events[0].status, "completed");
  assert.equal(events[0].evidence, 100);
  assert.equal(watch.activeCount(), 0);

  // 已注销，不再重复结算
  events = await watch.drain();
  assert.equal(events.length, 0);
});

test("tracker times out silently and never emits for unobserved sessions", async () => {
  let clock = 1000;
  const watch = createDesktopRunWatch({
    readRowsAfter: async () => [],
    now: () => clock,
  });
  watch.start("sess-2", 5);

  clock += DESKTOP_RUN_TRACK_TIMEOUT_MS + 1;
  const events = await watch.drain();
  assert.equal(events.length, 0);
  assert.equal(watch.activeCount(), 0);
});

test("emitted map suppresses duplicate settles of the same run", async () => {
  let clock = 1000;
  const watch = createDesktopRunWatch({
    readRowsAfter: async (sessionID, afterID) => [assistantRow(100), assistantRow(200)]
      .filter((row) => row.id > afterID),
    now: () => clock,
  });

  watch.start("sess-3", 0);
  let events = await watch.drain();
  assert.equal(events.length, 1);
  assert.equal(events[0].status, "completed");

  // UI 滞后导致同基线再登记：同状态同证据不重发
  watch.start("sess-3", 0);
  events = await watch.drain();
  assert.equal(events.length, 0);

  // 更高证据（新一轮完成）→ 重发
  clock += 1000;
  watch.start("sess-3", 100);
  events = await watch.drain();
  assert.equal(events.length, 1);
  assert.equal(events[0].evidence, 200);
});

test("interrupted finish_reason settles as run.interrupted", async () => {
  const watch = createDesktopRunWatch({
    readRowsAfter: async () => [assistantRow(50, "aborted by user")],
    now: () => 1000,
  });
  watch.start("sess-4", 10);
  const events = await watch.drain();
  assert.equal(events.length, 1);
  assert.equal(events[0].status, "interrupted");
});
