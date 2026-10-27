"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const [handoffFile, bin, cwd] = process.argv.slice(2);
let wsUrl = "";
try {
  wsUrl = fs.readFileSync(handoffFile, "utf8").trim();
} catch {
  console.error("Hermes 终端连接信息不可用；请重新打开终端。");
  process.exit(1);
} finally {
  try { fs.unlinkSync(handoffFile); } catch {}
  try { fs.rmdirSync(path.dirname(handoffFile)); } catch {}
}

if (!wsUrl || !bin) {
  console.error("Hermes 终端未就绪；请检查安装并重试。");
  process.exit(1);
}
const result = spawnSync(bin, ["--tui"], {
  cwd,
  env: { ...process.env, HERMES_TUI_GATEWAY_URL: wsUrl },
  stdio: "inherit",
  shell: /\.(cmd|bat)$/i.test(bin),
});
if (result.error) console.error("无法启动 Hermes 终端；请检查 HERMES_BIN。");
process.exitCode = result.status ?? 1;
