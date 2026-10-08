import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const module4Root = join(root, "fortune_module4");
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const pythonCandidates = process.platform === "win32"
  ? [join(module4Root, ".venv", "Scripts", "python.exe")]
  : [join(module4Root, ".venv", "bin", "python3"), join(module4Root, ".venv", "bin", "python")];
const python = pythonCandidates.find(existsSync);

if (!existsSync(nextBin)) {
  console.error("Next.js 尚未安装，请先运行 npm install。");
  process.exit(1);
}
if (!python) {
  console.error("Module 4 虚拟环境不存在，请先在 fortune_module4 中运行安装脚本。");
  process.exit(1);
}

const children = [];
let stopping = false;
let exitCode = 0;

function start(label, command, args, options = {}) {
  const child = spawn(command, args, { stdio: "inherit", ...options });
  children.push(child);
  child.on("error", error => {
    console.error(`[${label}] 启动失败：${error.message}`);
    exitCode = 1;
    stop();
  });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`[${label}] 已退出${signal ? `（${signal}）` : `（状态码 ${code ?? 1}）`}，正在关闭其他开发服务。`);
      exitCode = code ?? 1;
      stop();
    }
    if (children.every(item => item.exitCode !== null || item.signalCode !== null)) process.exit(exitCode);
  });
}

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
  setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    process.exit(exitCode);
  }, 5000).unref();
}

console.log("开发环境：Next.js http://localhost:3000 · Module 4 http://127.0.0.1:8001");
start("module4", python, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8001"], { cwd: module4Root });
start("next", process.execPath, [nextBin, "dev"], {
  cwd: root,
  env: { ...process.env, MODULE4_API_BASE_URL: "http://127.0.0.1:8001" },
});

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
