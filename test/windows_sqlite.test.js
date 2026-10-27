"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");
const { readRows } = require("../windows_sqlite");

test("SQLite 读取器可读取含中文路径的 WAL 会话数据库", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "prism-hermes-sqlite-"));
  const file = path.join(directory, "中文 会话.db");
  const writer = new Database(file);
  try {
    writer.pragma("journal_mode = WAL");
    writer.exec("CREATE TABLE sessions (title TEXT); INSERT INTO sessions VALUES ('测试会话');");
    assert.deepEqual(readRows(file, "SELECT title FROM sessions"), [{ title: "测试会话" }]);
  } finally {
    writer.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
