// 回执模块：给「自动化产出的交付物」发一份可核对的凭证。
// 概念只有两个：**回执**（一次运行的凭证）与**校验器**（任何人都能拿去复核，不信任产出方）。
//
// 它回答三个问题：
//   ① 是这次的？   → 每个产物的 mtime ≥ 本次运行开始时间
//   ② 怎么来的？   → 每步的状态/耗时/走了哪条分支/哪些降级
//   ③ 边界在哪？   → 上限、备份、跳过与降级，一条不藏
//
// 用法（产出方）：
//   import { 新建回执, 记步骤, 采产物, 落盘 } from "../回执模块/module.mjs";
//   const r = 新建回执({ 产品, 流水线, 宿主, 意图摘要, 边界, 运行目录 });
//   记步骤(r, { 编号:"S1", 名称:"收料", 状态:"已完成", 耗时毫秒:120, 检查:[...] });
//   采产物(r, 运行目录, ["交付包/交付清单.csv"], 开始时间);
//   落盘(r, 运行目录);   // → 回执.json + 回执.md
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const 回执版本 = "1.0";

/** 算文件指纹（流式，大文件也不吃内存） */
export function 指纹(文件) {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(文件, "r");
  const buf = Buffer.alloc(1 << 20);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

export function 新建回执({ 产品 = "未命名", 流水线 = "", 宿主 = {}, 意图摘要 = {}, 边界 = {}, 运行目录 = ".", 开始时间 = null } = {}) {
  return {
    回执版本,
    运行ID: new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 6),
    产品,
    流水线,
    宿主,
    开始时间: 开始时间 || new Date().toISOString(),
    结束时间: null,
    用时秒: null,
    意图摘要,
    边界,
    步骤: [],
    产物: [],
    降级与跳过: [],
    结论: "",
    运行目录: path.resolve(运行目录),
  };
}

export function 记步骤(回执, { 编号, 名称, 状态, 耗时毫秒, 分支, 降级 = [], 检查 = [], 回退 = [] }) {
  回执.步骤.push({
    编号, 名称, 状态,
    耗时毫秒: 耗时毫秒 === undefined ? null : 耗时毫秒,
    分支: 分支 || "",
    降级,
    检查: 检查.map((c) => ({ 检查: c.检查, 结果: c.结果, 实际: c.实际 === undefined ? "" : String(c.实际).slice(0, 300) })),
    回退,
  });
  for (const d of 降级) if (!回执.降级与跳过.includes(d)) 回执.降级与跳过.push(d);
  return 回执;
}

/** 采集产物指纹；相对路径存进回执，绝对路径用于读盘 */
export function 采产物(回执, 运行目录, 路径们, 本次开始时间 = 0) {
  for (const 相对 of 路径们) {
    const 绝对 = path.isAbsolute(相对) ? 相对 : path.join(运行目录, 相对);
    if (!fs.existsSync(绝对)) continue;
    const st = fs.statSync(绝对);
    回执.产物.push({
      路径: (() => {
        const rel = path.relative(运行目录, 绝对).split(path.sep).join("/");
        return rel.startsWith("..") ? 绝对.split(path.sep).join("/") : rel;   // 在运行目录之外就存绝对路径
      })(),
      字节: st.size,
      sha256: 指纹(绝对),
      mtime: st.mtime.toISOString(),
      本次生成: st.mtimeMs >= 本次开始时间,
    });
  }
  return 回执;
}

export function 收尾(回执, 结论) {
  回执.结束时间 = new Date().toISOString();
  回执.用时秒 = +( (Date.parse(回执.结束时间) - Date.parse(回执.开始时间)) / 1000 ).toFixed(2);
  回执.结论 = 结论;
  return 回执;
}

/** 落盘：回执.json（机器）+ 回执.md（人，可以直接给客户） */
export function 落盘(回执, 运行目录 = 回执.运行目录) {
  fs.mkdirSync(运行目录, { recursive: true });
  fs.writeFileSync(path.join(运行目录, "回执.json"), JSON.stringify(回执, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(运行目录, "回执.md"), 渲染(回执), "utf8");
  return 回执;
}

export function 渲染(回执) {
  const L = [];
  L.push("# 交付凭证（过程回执）");
  L.push("");
  L.push(`**${回执.产品}** ｜ 流水线：\`${回执.流水线 || "—"}\` ｜ 运行 ID：\`${回执.运行ID}\``);
  L.push("");
  L.push(`| 项 | 内容 |`);
  L.push(`|---|---|`);
  L.push(`| 开始 | ${回执.开始时间} |`);
  L.push(`| 结束 | ${回执.结束时间}（用时 ${回执.用时秒} 秒） |`);
  if (回执.宿主 && Object.keys(回执.宿主).length) {
    L.push(`| 宿主 | ${[回执.宿主.软件, 回执.宿主.版本, 回执.宿主.通道].filter(Boolean).join(" / ")} |`);
  }
  for (const [k, v] of Object.entries(回执.意图摘要 || {})) {
    L.push(`| ${k} | ${typeof v === "object" ? JSON.stringify(v) : v} |`);
  }
  L.push("");
  L.push("## 这一趟做了什么");
  L.push("");
  L.push("| 步骤 | 状态 | 耗时 | 走的哪条路 | 校验 |");
  L.push("|---|---|---|---|---|");
  for (const s of 回执.步骤) {
    const 校验 = s.检查.length ? s.检查.map((c) => (c.结果 === "通过" ? "✅" : c.结果 === "失败" ? "❌" : "➖")).join("") : "—";
    L.push(`| ${s.编号} ${s.名称} | ${s.状态} | ${s.耗时毫秒 === null ? "—" : s.耗时毫秒 + " ms"} | ${s.分支 || "—"} | ${校验} |`);
  }
  L.push("");
  L.push(`## 产物清单（${回执.产物.length} 个）`);
  L.push("");
  L.push("| 产物 | 字节 | 指纹（SHA-256 前 12 位） | 本次生成 |");
  L.push("|---|---|---|---|");
  for (const p of 回执.产物) {
    L.push(`| \`${p.路径}\` | ${p.字节} | \`${p.sha256.slice(0, 12)}\` | ${p.本次生成 ? "✅" : "❌"} |`);
  }
  L.push("");
  if (回执.降级与跳过.length) {
    L.push("## 降级与跳过（一条不藏）");
    L.push("");
    for (const d of 回执.降级与跳过) L.push("- " + d);
    L.push("");
  }
  if (回执.边界 && Object.keys(回执.边界).length) {
    L.push("## 边界");
    L.push("");
    for (const [k, v] of Object.entries(回执.边界)) L.push(`- ${k}：${v}`);
    L.push("");
  }
  L.push("## 结论");
  L.push("");
  L.push(`**${回执.结论}**`);
  L.push("");
  L.push("## 怎么自己验（不信任产出方也能验）");
  L.push("");
  L.push("```bash");
  L.push(`node 回执模块/verify.mjs "${回执.运行目录}"`);
  L.push("```");
  L.push("");
  L.push("校验器只读磁盘与这份回执：逐项重算 SHA-256、核对字节数、核对「是不是这次生成的」，并列出**存在但没申报**的产物。");
  return L.join("\n");
}

export function 读回执(运行目录) {
  const f = path.join(运行目录, "回执.json");
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, "utf8"));
}
