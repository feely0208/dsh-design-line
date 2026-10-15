// 平台助手：跨平台要用的东西集中在这里，别在适配器里散着写 if(win)
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const 是Win = process.platform === "win32";
export const 是Mac = process.platform === "darwin";
export const 是Linux = process.platform === "linux";

/** 在 PATH 与候选路径里找一个可执行文件，返回绝对路径或 null（跨平台，不依赖 which/where） */
export function 找可执行(名, 候选 = []) {
  for (const p of 候选) {
    if (p && fs.existsSync(p)) return p;
  }
  const 探测命令 = 是Win ? ["where", [名]] : ["which", [名]];
  const r = spawnSync(探测命令[0], 探测命令[1], { encoding: "utf8" });
  if (r.status === 0 && r.stdout && r.stdout.trim()) return r.stdout.trim().split(/\r?\n/)[0].trim();
  return null;
}

/** 在若干目录里按通配找第一个匹配（用于 "Adobe Photoshop 20XX" 这种版本目录） */
export function 找目录(根, 前缀) {
  try {
    const 命中 = fs.readdirSync(根).filter((n) => n.startsWith(前缀)).sort().reverse(); // 新版优先
    return 命中.length ? path.join(根, 命中[0]) : null;
  } catch { return null; }
}

/** Windows 批处理的行尾必须是 CRLF；内核按适配器声明转换 */
export function 转行尾(内容, 行尾) {
  if (!行尾 || 行尾 === "lf") return 内容;
  return 内容.replace(/\r\n/g, "\n").split("\n").join("\r\n");
}

/** 同步等待（不依赖 bash/cmd）：轮询直到文件出现或超时 */
export function 等文件(文件, 毫秒, 轮询毫秒 = 500) {
  const 睡 = (ms) => {
    try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
    catch { const t = Date.now(); while (Date.now() - t < ms) { /* 退化轮询 */ } }
  };
  const 截止 = Date.now() + 毫秒;
  while (Date.now() < 截止) {
    if (fs.existsSync(文件)) return fs.readFileSync(文件, "utf8");
    if (Date.now() + 轮询毫秒 > 截止) break;
    睡(轮询毫秒);
  }
  return fs.existsSync(文件) ? fs.readFileSync(文件, "utf8") : null;
}
