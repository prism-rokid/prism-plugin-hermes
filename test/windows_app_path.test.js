"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { hermesAppPath } = require("../hermes_cdp");

test("Windows 在每用户安装缺失时使用系统目录中的 Hermes", { skip: process.platform !== "win32" }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "prism-hermes-app-"));
  const previousLocal = process.env.LOCALAPPDATA;
  const previousProgram = process.env.ProgramFiles;
  const previousOverride = process.env.PRISM_HERMES_APP_EXECUTABLE;
  const previousPath = process.env.PRISM_HERMES_APP_PATH;
  try {
    process.env.LOCALAPPDATA = path.join(directory, "local");
    process.env.ProgramFiles = path.join(directory, "programs");
    delete process.env.PRISM_HERMES_APP_EXECUTABLE;
    delete process.env.PRISM_HERMES_APP_PATH;
    const executable = path.join(process.env.ProgramFiles, "Hermes", "Hermes.exe");
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, "");
    assert.equal(hermesAppPath(), executable);
  } finally {
    for (const [key, value] of [
      ["LOCALAPPDATA", previousLocal], ["ProgramFiles", previousProgram],
      ["PRISM_HERMES_APP_EXECUTABLE", previousOverride], ["PRISM_HERMES_APP_PATH", previousPath],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
