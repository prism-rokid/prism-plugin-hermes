"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createGatewayClient,
  sessionRunActive,
  nativeDetailStateEvent,
} = require("../hermes_gateway");

test("Hermes session starting state locks setup without reporting an active reply", () => {
  assert.equal(sessionRunActive({ status: "starting" }), false);
  assert.equal(sessionRunActive({ status: "idle" }), false);
  assert.equal(sessionRunActive({ status: "working" }), true);
  assert.equal(sessionRunActive({ running: true, status: "idle" }), true);
});

test("Hermes Native wide state events carry a resolvable session and full detail snapshot", () => {
  const detail = { status: "idle", context_window_total: "400000", context_tokens_used: "21415" };
  const event = nativeDetailStateEvent({
    NativeSessionID: "stored-1",
    NativeThreadID: "stored-1",
    Surface: "hermes-native-gateway",
    Endpoint: "hermes://sessions/stored-1",
    Cwd: "/tmp/project",
  }, detail, "live-1", "2026-08-14T15:31:25.000Z");

  assert.equal(event.Type, "desktop.state.changed");
  assert.equal(event.Payload.live_session_id, "live-1");
  assert.equal(event.Payload.detail_snapshot, detail);
  assert.deepEqual(event.Payload.native_session, {
    plugin_id: "hermes",
    native_session_id: "stored-1",
    native_thread_id: "stored-1",
    surface: "hermes-native-gateway",
    endpoint: "hermes://sessions/stored-1",
    cwd: "/tmp/project",
  });
});

test("Hermes active session lookup retries one timeout without resuming a session", async () => {
  const originalWebSocket = global.WebSocket;
  const calls = [];

  class FakeWebSocket {
    static OPEN = 1;

    constructor() {
      this.readyState = FakeWebSocket.OPEN;
      this.listeners = new Map();
      queueMicrotask(() => this.emit("open", {}));
    }

    addEventListener(type, listener, options = {}) {
      const entries = this.listeners.get(type) || [];
      entries.push({ listener, once: options.once === true });
      this.listeners.set(type, entries);
    }

    emit(type, event) {
      const entries = this.listeners.get(type) || [];
      this.listeners.set(type, entries.filter((entry) => !entry.once));
      for (const entry of entries) entry.listener(event);
    }

    send(raw) {
      const request = JSON.parse(raw);
      calls.push(request.method);
      const first = calls.length === 1;
      queueMicrotask(() => this.emit("message", first
        ? { data: JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { message: "session.active_list timed out" } }) }
        : { data: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { sessions: [{ id: "live-1" }] } }) }));
    }

    close() {
      this.readyState = 3;
      this.emit("close", {});
    }
  }

  global.WebSocket = FakeWebSocket;
  try {
    const client = createGatewayClient({
      resolveConnection: async () => ({ wsUrl: "ws://127.0.0.1:1/api/ws" }),
    });
    assert.deepEqual(await client.activeSessions(), [{ id: "live-1" }]);
    assert.deepEqual(calls, ["session.active_list", "session.active_list"]);
    client.close();
  } finally {
    global.WebSocket = originalWebSocket;
  }
});

test("Hermes Native session creation sends only fields supported by the Gateway schema", async () => {
  const originalWebSocket = global.WebSocket;
  let captured;

  class FakeWebSocket {
    static OPEN = 1;

    constructor() {
      this.readyState = FakeWebSocket.OPEN;
      this.listeners = new Map();
      queueMicrotask(() => this.emit("open", {}));
    }

    addEventListener(type, listener, options = {}) {
      const entries = this.listeners.get(type) || [];
      entries.push({ listener, once: options.once === true });
      this.listeners.set(type, entries);
    }

    emit(type, event) {
      const entries = this.listeners.get(type) || [];
      this.listeners.set(type, entries.filter((entry) => !entry.once));
      for (const entry of entries) entry.listener(event);
    }

    send(raw) {
      const request = JSON.parse(raw);
      captured = request;
      queueMicrotask(() => this.emit("message", {
        data: JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { session_id: "live-1", stored_session_id: "stored-1", message_count: 0 },
        }),
      }));
    }

    close() {
      this.readyState = 3;
      this.emit("close", {});
    }
  }

  global.WebSocket = FakeWebSocket;
  try {
    const client = createGatewayClient({
      resolveConnection: async () => ({ wsUrl: "ws://127.0.0.1:1/api/ws" }),
    });
    await client.createSession("/tmp/prism-hermes-native");
    assert.equal(captured.method, "session.create");
    assert.deepEqual(captured.params, {
      cols: 120,
      source: "prism",
      cwd: "/tmp/prism-hermes-native",
    });
    client.close();
  } finally {
    global.WebSocket = originalWebSocket;
  }
});

test("Hermes Native advertises server requests and answers an inbound approval RPC", async () => {
  const originalWebSocket = global.WebSocket;
  const sent = [];
  let answerApproval;

  class FakeWebSocket {
    static OPEN = 1;

    constructor() {
      this.readyState = FakeWebSocket.OPEN;
      this.listeners = new Map();
      FakeWebSocket.latest = this;
      queueMicrotask(() => {
        this.emit("open", {});
        this.emit("message", { data: JSON.stringify({
          jsonrpc: "2.0", method: "event", params: { type: "gateway.ready" },
        }) });
      });
    }

    addEventListener(type, listener, options = {}) {
      const entries = this.listeners.get(type) || [];
      entries.push({ listener, once: options.once === true });
      this.listeners.set(type, entries);
    }

    emit(type, event) {
      const entries = this.listeners.get(type) || [];
      this.listeners.set(type, entries.filter((entry) => !entry.once));
      for (const entry of entries) entry.listener(event);
    }

    send(raw) {
      const request = JSON.parse(raw);
      sent.push(request);
      if (request.method === "client.capabilities") {
        queueMicrotask(() => this.emit("message", { data: JSON.stringify({
          jsonrpc: "2.0", id: request.id, result: { server_requests: ["approval"] },
        }) }));
      }
    }

    close() {
      this.readyState = 3;
      this.emit("close", {});
    }
  }

  global.WebSocket = FakeWebSocket;
  try {
    const client = createGatewayClient({
      advertiseServerRequests: true,
      onServerRequest: (request) => new Promise((resolve) => {
        assert.equal(request.method, "approval");
        assert.equal(request.params.request_id, "native-approval-1");
        answerApproval = resolve;
      }),
      resolveConnection: async () => ({ wsUrl: "ws://127.0.0.1:1/api/ws" }),
    });
    await client.ensureReady();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(sent.find((request) => request.method === "client.capabilities")?.params, {
      server_requests: true,
    });
    FakeWebSocket.latest.emit("message", { data: JSON.stringify({
      jsonrpc: "2.0",
      id: "server-request-1",
      method: "approval",
      params: { session_id: "live-1", request_id: "native-approval-1", command: "touch qa-marker" },
    }) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(typeof answerApproval, "function");
    answerApproval({ choice: "once" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(sent.some((request) => request.id === "server-request-1" && request.result?.choice === "once"));
    client.close();
  } finally {
    global.WebSocket = originalWebSocket;
  }
});
