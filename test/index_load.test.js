"use strict";

const { execFile } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

// 冒烟测试：index.js 必须能完整加载。子模块测试不执行 index.js 顶层代码，
// 运行时引用错误（如拼错的函数名）只有加载才会暴露——0.1.13 曾因
// createDesktopRunWatch({ readRowsAfter }) 引用不存在的名字导致插件进程
// 启动即崩溃。在子进程中加载并立即退出：index.js 加载后会留下活跃句柄，
// 不能在测试进程内直接 require。
test("index.js loads without undefined references", async () => {
  const entry = path.join(__dirname, "..", "index.js");
  await new Promise((resolve, reject) => {
    const child = execFile(process.execPath, ["-e", `require(${JSON.stringify(entry)}); process.exit(0)`], {
      timeout: 15000,
      killSignal: "SIGKILL",
    }, (error) => {
      if (error) {
        reject(new Error(`index.js failed to load: ${error.message}`));
        return;
      }
      resolve();
    });
    child.stdout?.resume();
    child.stderr?.resume();
  });
});

test("Hermes Native 缺少 CLI 时通过 stdio 返回结构化诊断", () => {
  const assert = require("node:assert/strict");
  const { spawnSync } = require("node:child_process");
  const entry = path.join(__dirname, "..", "index.js");
  const isolatedProbe = `
const fs = require("node:fs");
const path = require("node:path");
const exists = fs.existsSync;
fs.existsSync = value => {
  const name = path.win32.basename(String(value)).toLowerCase();
  return name === "hermes" || name === "hermes.exe" ? false : exists(value);
};
require(${JSON.stringify(entry)});
`;
  const result = spawnSync(process.execPath, ["-e", isolatedProbe], {
    input: JSON.stringify({ id: "probe", method: "adapter.probe" }) + "\n",
    env: { ...process.env, PATH: "", PRISM_PLUGIN_MODE: "native", HERMES_BIN: path.join(__dirname, "不存在的-hermes") },
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  const { payload } = JSON.parse(result.stdout.trim());
  assert.equal(payload.available, false);
  assert.equal(payload.diagnostics.code, "dependency_not_installed");
  assert.equal(payload.diagnostics.facts.transport, "websocket");
  assert.ok(payload.unavailable_reason);
});
