#!/usr/bin/env node
// 回执校验器（独立）：**不信任产出方**，只读磁盘 + 回执声明，重新算一遍。
// 用途：客户 / 审计 / 我们自己复核一份交付，不问"脚本说它跑成功了吗"。
//
//   node 回执模块/verify.mjs <运行目录> [--json]
//
// 退出码：0 通过 ｜ 1 有问题 ｜ 2 用不了（没有回执）
import fs from "node:fs";
import path from "node:path";
import { 指纹 } from "./module.mjs";

const 运行目录 = process.argv[2];
const 要JSON = process.argv.includes("--json");
if (!运行目录 || !fs.existsSync(运行目录)) {
  console.error("用法：node 回执模块/verify.mjs <运行目录> [--json]");
  process.exit(2);
}

const 回执文件 = path.join(运行目录, "回执.json");
if (!fs.existsSync(回执文件)) {
  console.error("❌ 这里没有 回执.json —— 没有凭证就没有可核对的东西");
  process.exit(2);
}
const 回执 = JSON.parse(fs.readFileSync(回执文件, "utf8"));
const 问题 = [];
const 提示 = [];

/* 1. 回执自身完整性 */
for (const 必填 of ["回执版本", "运行ID", "产品", "开始时间", "结论"]) {
  if (!回执[必填]) 问题.push(`回执缺必填字段：${必填}`);
}
if (!Array.isArray(回执.步骤) || 回执.步骤.length === 0) 问题.push("回执里没有步骤记录（无法回答「怎么来的」）");
if (!Array.isArray(回执.产物) || 回执.产物.length === 0) 问题.push("回执里没有产物清单");

/* 2. 步骤状态与结论是否自相矛盾 */
const 失败步骤 = (回执.步骤 || []).filter((s) => !/已完成|跳过|受阻/.test(s.状态 || ""));
if (失败步骤.length && /全部执行并校验通过/.test(回执.结论 || "")) {
  问题.push(`结论说「全部通过」，但步骤 ${失败步骤.map((s) => s.编号).join("、")} 状态是「${失败步骤[0].状态}」`);
}
const 检查失败 = [];
for (const s of 回执.步骤 || []) {
  for (const c of s.检查 || []) if (c.结果 === "失败") 检查失败.push(`${s.编号}/${c.检查}`);
}
if (检查失败.length && /全部执行并校验通过/.test(回执.结论 || "")) {
  问题.push(`结论说「全部通过」，但有失败的校验：${检查失败.slice(0, 3).join("、")}`);
}

/* 3. 逐个产物：存在 / 字节 / 指纹 / 是不是这次生成的 */
const 起点 = Date.parse(回执.开始时间 || 0);
// 产物路径可能是相对运行目录的，也可能是绝对的（交付到运行目录之外时）—— 两种都要吃
const 解路径 = (p) => (path.isAbsolute(p) ? p : path.join(运行目录, p));
const 已报 = new Set();
for (const p of 回执.产物 || []) {
  const 绝对 = 解路径(p.路径);
  const 报一次 = (m) => { if (!已报.has(p.路径 + m)) { 问题.push(m); 已报.add(p.路径 + m); } };
  if (!fs.existsSync(绝对)) { 报一次(`产物缺失：${p.路径}`); continue; }
  const st = fs.statSync(绝对);
  if (st.size !== p.字节) 报一次(`字节数不符：${p.路径} 回执 ${p.字节} / 实际 ${st.size}`);
  const 实际指纹 = 指纹(绝对);
  if (实际指纹 !== p.sha256) 报一次(`指纹不符（内容被改过）：${p.路径} 回执 ${p.sha256.slice(0, 12)} / 实际 ${实际指纹.slice(0, 12)}`);
  if (起点 && st.mtimeMs < 起点) { 报一次(`不是这次生成的（mtime 早于产出时间）：${p.路径}（${st.mtime.toISOString()} < ${回执.开始时间}）`); continue; }
  if (p.本次生成 === false) 报一次(`回执自己标了「非本次生成」却仍在产物清单里：${p.路径}`);
}

/* 4. 反向：磁盘上有、回执里没申报的产物（防"偷偷多塞东西"） */
const 申报 = new Set((回执.产物 || []).map((p) => p.路径));
const 疑似产物目录 = ["交付包", "出图", "渲染"];
for (const 目录 of 疑似产物目录) {
  const 根 = path.join(运行目录, 目录);
  if (!fs.existsSync(根)) continue;
  const 走 = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      // 过程文件（下划线开头）与过程目录不属于「交付物」，不要求申报
      if (e.isDirectory()) { if (!/^(工作区|_过程|_原图备份)$/.test(e.name)) 走(p); }
      else if (!e.name.startsWith("_")) {
        const rel = path.relative(运行目录, p).split(path.sep).join("/");
        if (!申报.has(rel)) 提示.push(`存在但未申报：${rel}`);
      }
    }
  };
  走(根);
}
if (提示.length > 20) 提示.splice(20, 0, `…另有 ${提示.length - 20} 个未申报文件`);

const 通过 = 问题.length === 0;
const 结果 = {
  运行目录: path.resolve(运行目录),
  运行ID: 回执.运行ID,
  产品: 回执.产品,
  结论: 通过 ? "✅ 回执与磁盘一致，可以采信" : `❌ 有 ${问题.length} 处对不上`,
  问题,
  提示,
};

if (要JSON) {
  console.log(JSON.stringify(结果, null, 2));
} else {
  console.log(`校验：${回执.产品} 运行 ${回执.运行ID}`);
  console.log(`步骤 ${回执.步骤.length} 个 ｜ 申报产物 ${回执.产物.length} 个`);
  for (const p of 问题) console.log("  ❌ " + p);
  for (const t of 提示.slice(0, 8)) console.log("  ⚠️ " + t);
  console.log("");
  console.log(结果.结论);
}
process.exit(通过 ? 0 : 1);
