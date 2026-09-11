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
