#!/usr/bin/env node
// 设计插件线 · 最小内核
// 概念只有四个：意图 / 工序 / 落盘 / 回放。适配器是内部零件，不是用户概念。
//
//   node 内核/run.mjs detect  <软件>
//   node 内核/run.mjs plan    <流水线.json> --intent <意图.json> --out <运行目录>
//   node 内核/run.mjs run     <运行目录> [--步骤 S1,S3]
//   node 内核/run.mjs replay  <运行目录>
//   node 内核/run.mjs status  <运行目录>
//   node 内核/run.mjs doc     <流水线.json>
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runChecks, writeCsv, glob } from "./verify.mjs";
import { 新建回执, 记步骤, 采产物, 收尾, 落盘 } from "./回执.mjs";
import { 等文件, 转行尾 } from "./平台.mjs";

const 根 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 适配器目录 = path.join(根, "适配器");

const 读JSON = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const 写JSON = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + "\n", "utf8"); };
const 时间 = () => new Date().toISOString();

const 日志上限字节 = 8 * 1024 * 1024;   // 上限：写日志也要有边界（DSec 案例 #8 就是没上限把日志撑到几十 GB）
function 记日志(运行目录, 事件) {
  fs.mkdirSync(运行目录, { recursive: true });
  const f = path.join(运行目录, "日志.ndjson");
  try {
    if (fs.existsSync(f) && fs.statSync(f).size > 日志上限字节) return;   // 到顶就停，不无限长
  } catch { /* 忽略 */ }
  fs.appendFileSync(f, JSON.stringify({ 时间: 时间(), ...事件 }) + "\n", "utf8");
}

/**
 * 外接适配器目录 —— **这是我们"是框架"的第一条兑现**。
 * 别人想接入一个新软件（SketchUp / Rhino / 某个内部工具链），
 * 只要往自己的目录里放一个 <软件名>.mjs（实现 探测/编译/发射/静态校验），
 * 用 `--适配器目录 <目录>` 或环境变量 `设计插件_适配器目录`（多个用 : 分隔）指过来即可，**不用改内核一行**。
 * 查找顺序：内置适配器 → 外接目录（按声明顺序，先命中先用）。
 */
function 外接适配器目录() {
  const 出 = [];
  const av = process.argv.slice(2);
  for (let i = 0; i < av.length; i++) if (av[i] === "--适配器目录" && av[i + 1]) 出.push(path.resolve(av[i + 1]));
  const 环境 = process.env.设计插件_适配器目录 || process.env.DESIGNLINE_ADAPTER_DIRS || "";
  for (const d of 环境.split(/[:;]/).map((x) => x.trim()).filter(Boolean)) 出.push(path.resolve(d));
  return 出;
}

async function 载适配器(软件, 计划里的目录) {
  const 找过 = [];
  const 候选 = [适配器目录, ...(计划里的目录 || []), ...外接适配器目录()];
  for (const 目录 of 候选) {
    const f = path.join(目录, 软件 + ".mjs");
    找过.push(f);
    if (fs.existsSync(f)) {
      // ⚠️ 必须转成 file:// URL 再 import：Windows 上 import('C:\\...') 会被当成
      //    协议 c: → "Only URLs with a scheme in: file, data, node, and electron are supported…
      //    Received protocol 'c:'"。POSIX 绝对路径恰好能解析，所以本机（mac）测不出来。
      const m = await import(pathToFileURL(f).href);
      const a = m.default || m;
      if (!a || typeof a !== "object") throw new Error("适配器格式不对（要 export default {id, 名称, 探测, 编译, 发射, 静态校验}）：" + f);
      if (!a.id) a.id = 软件;
      a.内部路径 = f;                       // 便于日志里说清"这条线是从哪加载的"
      return a;
    }
  }
  throw new Error("没有适配器：" + 软件 + "（找过：" + 找过.join(" ｜ ") + "）");
}

/* ============ plan：落盘可审阅（不执行） ============ */

async function plan(流水线路径, 意图路径, 运行目录, 适配器覆盖) {
  const 流水线 = 读JSON(流水线路径);
  const 意图 = 读JSON(意图路径);
  if (适配器覆盖) 流水线.适配器 = 适配器覆盖;       // 允许临时换适配器（如宿主替身自检），不改流水线定义
  const 适配器 = await 载适配器(流水线.适配器 || 流水线.软件);

  const 步骤 = (流水线.步骤 || []).map((s) => ({
    编号: s.编号, 名称: s.名称, 参数: { ...(s.参数 || {}), ...(意图[s.编号] || {}) },
  }));
  const ctx = { 运行目录, 意图, 流水线, 步骤, 步骤原文: 流水线.步骤 };

  const 探测 = 适配器.探测 ? 适配器.探测(ctx) : { 状态: "可用", 版本: "未知", 能力: [], 说明: "" };
  const 单元 = (适配器.编译 ? 适配器.编译(ctx) : []).map((j) => ({ ...j, 状态: "待执行" }));

  // 脚本先落盘（护城河：执行前可审阅）
  const 脚本目录 = path.join(运行目录, "脚本");
  fs.mkdirSync(脚本目录, { recursive: true });
  for (const j of 单元) {
    fs.writeFileSync(path.join(脚本目录, j.脚本名), 转行尾(j.代码, j.行尾), "utf8");
    for (const 附 of j.附属文件 || []) fs.writeFileSync(path.join(脚本目录, 附.名), 转行尾(附.内容, 附.行尾 || j.行尾), "utf8");
    if (适配器.静态校验) {
      j.静态校验 = 适配器.静态校验(j.代码, j.语言);
    }
  }

  const 计划 = {
    生成时间: 时间(),
    流水线: { 路径: path.relative(根, path.resolve(流水线路径)), id: 流水线.id, 标题: 流水线.标题, 软件: 流水线.适配器 || 流水线.软件 },
    意图: 意图,
    步骤: 流水线.步骤,
    探测,
    单元,
    // ⭐ 外接适配器的出处也要落盘：否则 plan 找得到、run 找不到（真踩过）
    适配器目录: 外接适配器目录(),
    适配器来源: 适配器.内部路径 || null,
  };
  写JSON(path.join(运行目录, "意图.json"), 意图);
  写JSON(path.join(运行目录, "计划.json"), 计划);
  写JSON(path.join(运行目录, "状态.json"), { 更新: 时间(), 单元: 单元.map((j) => ({ 单元ID: j.单元ID, 覆盖步骤: j.覆盖步骤, 状态: j.状态 })) });
  记日志(运行目录, { 事件: "plan", 探测: 探测.状态, 单元数: 单元.length });

  console.log("已落盘：" + 运行目录);
  console.log("  宿主：" + 探测.状态 + "  " + (探测.版本 || "") + "  " + (探测.说明 || ""));
  for (const j of 单元) {
    const s = j.静态校验 ? (j.静态校验.ok ? "静态校验通过" : "静态校验失败：" + j.静态校验.问题.join(" / ")) : "无静态校验";
    console.log("  [" + j.单元ID + "] " + j.覆盖步骤.join(",") + " → 脚本/" + j.脚本名 + "  " + s);
  }
  if (探测.状态 !== "可用") {
    console.log("\n⚠ 宿主" + 探测.状态 + "：脚本已生成并落盘可审阅，执行需在 " + (探测.在哪跑 || "有宿主的机器") + " 上进行。");
  }
  return 计划;
}

/* ============ run / replay：执行已落盘的脚本 ============ */

async function run(运行目录, 选项 = {}) {
  const 本次开始时间 = Date.now();
  const 计划路径 = path.join(运行目录, "计划.json");
  if (!fs.existsSync(计划路径)) throw new Error("没找到 计划.json —— 先 plan（执行前必须先落盘可审阅）");
  const 计划 = 读JSON(计划路径);
  const 适配器 = await 载适配器(计划.流水线.软件, 计划.适配器目录);
  const 探测 = 适配器.探测 ? 适配器.探测({ 运行目录, 意图: 计划.意图, 流水线: 计划.流水线, 步骤: 计划.步骤 }) : 计划.探测;

  // 跑之前先看盘：产物可能很大，写满用户的盘就是「搞坏环境」
  if (!选项.忽略空间检查) {
    const 需要 = 选项.需要空间GB || 1;
    let 可用GB = null;
    try {
      const st = fs.statfsSync(path.resolve(运行目录));
      可用GB = (st.bavail * st.bsize) / 1024 / 1024 / 1024;
    } catch { /* 平台不支持就不拦 */ }
    if (可用GB !== null && 可用GB < 需要) {
      throw new Error("磁盘可用空间只剩 " + 可用GB.toFixed(2) + " GB，低于安全线 " + 需要 + " GB —— 拒绝开跑（要硬来加 --忽略空间检查）");
    }
    if (可用GB !== null) 记日志(运行目录, { 事件: "preflight", 可用GB: +可用GB.toFixed(2) });
  }

  const 只跑 = 选项.步骤 ? 选项.步骤.split(",").map((s) => s.trim()) : null;
  const 记录 = [];
  let 需要人工 = false;

  for (const j of 计划.单元) {
    if (只跑 && !j.覆盖步骤.some((s) => 只跑.includes(s))) continue;
    if (j.状态 === "已完成" && !选项.重跑) {
      // ⭐ 跳过也要重新核对产物：状态说完成、产物却没了，必须当场揭穿
      const 检查项2 = (j.检查 || []).concat(j.主要产物 ? [{ 类型: "本次生成", 路径: j.主要产物 }] : []);
      const 复查 = runChecks(检查项2, 运行目录, j.替身跳过检查 || [], { 本次开始时间 });
      const 坏 = 复查.filter((c) => c.结果 === "失败");
      j.执行 = { ...(j.执行 || {}), 检查: 复查 };
      if (坏.length) {
        j.状态 = "产物缺失（与状态不符）";
        记日志(运行目录, { 事件: "verify-skip", 单元: j.单元ID, 失败: 坏.length });
        记录.push({ ...j, 结果: j.状态 });
      } else {
        记录.push({ ...j, 结果: "跳过（已完成，产物复核通过）" });
      }
      continue;
    }

    if (探测.状态 !== "可用" && !j.替身) {
      需要人工 = true;
      j.状态 = "受阻";
      j.受阻原因 = 探测.说明 || "本机没有宿主";
      记日志(运行目录, { 事件: "blocked", 单元: j.单元ID, 原因: j.受阻原因 });
      记录.push({ ...j, 结果: "受阻" });
      continue;
    }

    // 执行单元自己的发射命令（没有则由适配器现给）
    const 发射 = j.发射 || (适配器.发射 ? 适配器.发射(j, { 运行目录, 意图: 计划.意图 }) : null);
    if (!发射) { j.状态 = "受阻"; j.受阻原因 = "适配器没有给出执行方式"; 记录.push({ ...j, 结果: "受阻" }); continue; }

    const 超时 = (发射.超时秒 || 300) * 1000;
    const 命令超时 = (发射.命令超时秒 || 发射.超时秒 || 300) * 1000;
    const t0 = Date.now();
    const r = spawnSync(发射.命令[0], 发射.命令.slice(1), {
      cwd: 发射.工作目录 || 运行目录,
      encoding: "utf8",
      timeout: 命令超时,
      maxBuffer: 32 * 1024 * 1024,
    });
    let 等待结果 = null;
    // ⭐ 「等脚本跑完」放在内核里做（轮询一个标记文件），不依赖 bash 循环 —— Windows 上没有 bash。
    //    发射命令只负责「把脚本投递给宿主」，完成与否一律看标记/or产物。
    if (发射.等待文件) {
      // ⚠️ 2026-10-16 踩：进程已经失败退出时，**不该再空等标记**。
      //    当时 Blender 因脚本语法错误秒退，内核却照等 2 小时（超时值），白占一晚上。
      //    规则：进程非 0 退出且没有标记 → 直接判失败；进程 0 退出但标记还没出现 → 才等（宿主可能延迟落标记）。
      const 进程正常退出 = r.status === 0;
      const 标记已存在 = fs.existsSync(发射.等待文件);
      // ⚠️ 2026-10-16 第二个教训：宿主分两类，等待策略必须不同 ——
      //   ① 进程即工作（Blender / 3dsmaxbatch / accoreconsole）：进程退出 = 活干完了，
      //      标记此刻就该在；没在就只再等一小段宽限，**绝不能按超时值傻等**（那天白等过 2 小时）。
      //   ② 投递完就返回（Photoshop 的 open -g -a）：进程秒退，但宿主还在后台干活，
      //      必须按超时值等标记。适配器用 `进程即工作: false` 声明这一类。
      const 进程即工作 = 发射.进程即工作 !== false;
      const 宽限毫秒 = 进程即工作 ? Math.min(超时, 20000) : 超时;
      if (!进程正常退出 && !标记已存在) {
        等待结果 = null;
        记日志(运行目录, { 事件: "wait", 单元: j.单元ID, 标记: 发射.等待文件,
          内容: "进程已退出（状态码 " + r.status + "）且无标记 —— 不再空等，直接判失败" });
      } else {
        if (进程即工作) 记日志(运行目录, { 事件: "wait", 单元: j.单元ID,
          内容: "进程已结束（状态码 " + r.status + "），标记未出现 → 只等 20 秒宽限（进程即工作型宿主）" });
        等待结果 = 等文件(发射.等待文件, 宽限毫秒);
      }
          if (等待结果 !== null) 记日志(运行目录, { 事件: "wait", 单元: j.单元ID, 标记: 发射.等待文件, 内容: String(等待结果).slice(0, 200) });
    }
    const 耗时 = Date.now() - t0;
    const 输出 = {
      状态码: r.status,
      超时: r.error && r.error.code === "ETIMEDOUT",
      等待标记: 发射.等待文件 ? (等待结果 === null ? "超时未见标记" : String(等待结果).slice(0, 200)) : undefined,
      标准输出: (r.stdout || "").slice(-4000),
      标准错误: (r.stderr || "").slice(-4000),
    };
    记日志(运行目录, { 事件: "exec", 单元: j.单元ID, 命令: 发射.命令.join(" "), 耗时毫秒: 耗时, ...输出 });

    // 判据在产物那边：不管命令报什么，一律读产物核对
    // ⭐ 自动补一条「本次生成」：产物必须是这一次跑出来的，防旧文件冒充（端到端校验不可靠的堵法）
    const 检查项 = (j.检查 || []).concat(j.主要产物 ? [{ 类型: "本次生成", 路径: j.主要产物 }] : []);
    const 检查 = runChecks(检查项, 运行目录, j.替身跳过检查 || [], { 本次开始时间 });
    const 通过 = 检查.filter((c) => c.结果 === "通过").length;
    const 失败 = 检查.filter((c) => c.结果 === "失败").length;
    j.状态 = 失败 === 0 && 检查.length > 0 ? "已完成" : (失败 === 0 ? "已完成(未校验)" : "校验失败");
    j.执行 = { 耗时毫秒: 耗时, ...输出, 检查 };
    记日志(运行目录, { 事件: "verify", 单元: j.单元ID, 状态: j.状态, 通过, 失败 });
    记录.push({ ...j, 结果: j.状态 });
  }

  // 先算清「产物是哪一次跑出来的」——状态落盘要用它
  const 状态路径 = path.join(运行目录, "状态.json");
  const 旧状态 = fs.existsSync(状态路径) ? JSON.parse(fs.readFileSync(状态路径, "utf8")) : {};
  const 本次有产出 = 记录.some((j) => !/^跳过/.test(j.结果 || "") && /已完成/.test(j.状态 || ""));
  // 取「最早一次产出」而不是「最近一次」：部分重跑（只补 S5）不该让更早产出的产物变成"过期"
  const 本次ISO = new Date(本次开始时间).toISOString();
  const 产出运行开始 = 本次有产出
    ? (旧状态.产出运行开始 && 旧状态.产出运行开始 < 本次ISO ? 旧状态.产出运行开始 : 本次ISO)
    : (旧状态.产出运行开始 || 本次ISO);
  const 产出用时秒 = 本次有产出 ? null : (旧状态.产出用时秒 || null);

  写JSON(计划路径, 计划);
  写JSON(path.join(运行目录, "状态.json"), {
    更新: 时间(),
    产出运行开始,
    产出用时秒: 本次有产出 ? (记录.reduce((m, j) => Math.max(m, (j.执行 && j.执行.耗时毫秒) || 0), 0) / 1000) : 产出用时秒,
    探测,
    单元: 计划.单元.map((j) => ({ 单元ID: j.单元ID, 覆盖步骤: j.覆盖步骤, 状态: j.状态, 受阻原因: j.受阻原因, 静态校验: j.静态校验 })),
  });

  // 交付清单
  const 行 = [["步骤", "单元", "状态", "检查通过", "检查失败", "备注"]];
  for (const j of 记录) {
    const 检查 = (j.执行 && j.执行.检查) || j.检查 || [];
    行.push([
      j.覆盖步骤.join(" "),
      j.单元ID,
      j.结果 || j.状态,
      String(检查.filter((c) => c.结果 === "通过").length),
      String(检查.filter((c) => c.结果 === "失败").length),
      j.受阻原因 || (j.执行 && j.执行.超时 ? "命令超时" : "") || (j.静态校验 && !j.静态校验.ok ? "静态校验未过" : ""),
    ]);
  }
  writeCsv(path.join(运行目录, "交付清单.csv"), 行);

  const 成功结果 = new Set(["已完成", "已完成(未校验)", "跳过（已完成，产物复核通过）"]);

  // ⭐ 回执：把「是这次的 / 怎么来的 / 边界在哪」写成人能看、机器能验的一份凭证
  const 结论 = 记录.every((j) => 成功结果.has(j.结果))
    ? "全部执行并校验通过"
    : (需要人工 ? "脚本已生成并落盘；本机宿主不可用，需在宿主机器执行" : "存在未通过项，见交付清单.csv");
  const 回执 = 新建回执({
    产品: "深鲸工序",
    流水线: 计划.流水线 && 计划.流水线.id ? 计划.流水线.id : "",
    宿主: { 软件: 探测.宿主 || "", 版本: 探测.版本 || "", 通道: 探测.通道 || 探测.说明 || "" },
    意图摘要: {
      软件: 计划.流水线 ? 计划.流水线.软件 : "",
      意图: JSON.stringify(计划.意图 || {}).slice(0, 300),
    },
    边界: {
      日志上限: "8 MB",
      磁盘预检: "可用空间 < 1 GB 拒绝开跑",
      产物校验: "文件头尺寸 / 行数 / 像素方差 / 本次生成",
    },
    运行目录,
    开始时间: 产出运行开始,   // ⭐ 产物是哪一次跑出来的就记哪一次（跳过式重跑不冒充）
  });

  // 降级与跳过：从 异常.md 去重收集（一条不藏）
  const 异常集 = new Set();
  for (const 交付目录 of ["交付包", "出图", "渲染"]) {
    const f = path.join(运行目录, 交付目录, "异常.md");
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split(/\r\n|\r|\n/)) {
      const t = line.trim().replace(/^-\s*/, "");
      if (t && !异常集.has(t) && 异常集.size < 40) 异常集.add(t);
    }
  }

  for (const j of 记录) {
    记步骤(回执, {
      编号: j.覆盖步骤.join("+"),
      名称: j.单元ID,
      状态: j.结果 || j.状态,
      耗时毫秒: j.执行 ? j.执行.耗时毫秒 : null,
      分支: j.执行 && j.执行.等待标记 ? "宿主完成标记：" + j.执行.等待标记 : "",
      降级: [...异常集],
      检查: (j.执行 && j.执行.检查) || j.检查 || [],
      回退: (j.回退 || []).slice(0, 3),
    });
  }

  // 产物清单：交付目录里属于「交付物」的文件（过程文件以下划线开头，不申报）
  const 产物根集合 = new Set();
  for (const j of 计划.单元) if (j.主要产物) 产物根集合.add(path.dirname(j.主要产物));   // 适配器声明的产物目录（可能是绝对路径）
  for (const 名 of ["交付包", "出图", "渲染"]) 产物根集合.add(path.join(运行目录, 名));
  const 产物相对 = [];
  for (const 绝对根 of 产物根集合) {
    if (!fs.existsSync(绝对根)) continue;
    const 命中 = [...new Set([...glob(绝对根, "*"), ...glob(绝对根, "**/*")])];   // 根目录下的文件也要收（清单/说明就在根上）
    for (const rel of 命中) {
      if (/^(工作区|_原图备份|_过程)\//.test(rel)) continue;
      if (path.basename(rel).startsWith("_")) continue;
      产物相对.push(path.join(绝对根, rel));
    }
  }
  采产物(回执, 运行目录, 产物相对.slice(0, 2000), Date.parse(产出运行开始));
  收尾(回执, 结论);
  if (产出用时秒 !== null) 回执.用时秒 = 产出用时秒;   // 跳过式重跑：沿用上次的真实用时
  落盘(回执, 运行目录);

  const 回执绝对 = path.resolve(运行目录, "回执.md");
  console.log("回执：" + 回执绝对 + "（客户可自己验：node 回执模块/verify.mjs \"" + 运行目录 + "\"）");
  return 回执;
}

/* ============ doc：从流水线定义直接渲染中文工序文档（单一事实源） ============ */

function doc(流水线路径) {
  const p = 读JSON(流水线路径);
  const L = [];
  L.push("# " + p.标题);
  L.push("");
  L.push("> 软件适配器：`" + p.软件 + "` ｜ v1 判据：**" + (p.替掉的工作量 || "") + "**");
  L.push("");
  if (p.背景) { L.push("## 它解决什么"); L.push(""); L.push(p.背景); L.push(""); }
  if (p.输入) { L.push("## 输入"); L.push(""); p.输入.forEach((x) => L.push("- " + x)); L.push(""); }
  if (p.产出) { L.push("## 产出"); L.push(""); p.产出.forEach((x) => L.push("- " + x)); L.push(""); }
  if (p.上线形态) { L.push("## 上线形态"); L.push(""); p.上线形态.forEach((x) => L.push("- " + x)); L.push(""); }

  if (p.意图参数) {
    L.push("## 意图参数（用户只需回答这些）");
    L.push("");
    L.push("| 参数 | 键 | 类型 | 必填 | 默认 | 说明 |");
    L.push("|---|---|---|---|---|---|");
    for (const a of p.意图参数) {
      const 默认 = a.默认 === undefined ? "—" : (typeof a.默认 === "object" ? "见示例" : String(a.默认));
      L.push("| " + a.名 + " | `" + a.键 + "` | " + a.类型 + " | " + (a.必填 ? "是" : "否") + " | " + 默认 + " | " + (a.说明 || "") + " |");
    }
    L.push("");
  }

  L.push("## 工序（每步：做什么 / 调什么接口 / 怎么验证 / 失败怎么回退）");
  L.push("");
  for (const s of p.步骤) {
    L.push("### " + s.编号 + " · " + s.名称);
    L.push("");
    L.push("**做什么**　" + s.做什么);
    L.push("");
    L.push("**调什么接口**");
    L.push("");
    for (const i of s.接口 || []) {
      L.push("- `" + i.调用 + "`" + (i.说明 ? " —— " + i.说明 : "") + (i.回退版本 ? "　〔版本回退：" + i.回退版本 + "〕" : ""));
    }
    L.push("");
    L.push("**怎么验证（判据在产物那边）**");
    L.push("");
    for (const v of s.验证 || []) L.push("- " + v);
    L.push("");
    L.push("**失败怎么回退**");
    L.push("");
    for (const f of s.回退 || []) L.push("- " + f);
    L.push("");
  }
  if (p.版本策略) { L.push("## 版本策略"); L.push(""); p.版本策略.forEach((x) => L.push("- " + x)); L.push(""); }
  if (p.不做什么) { L.push("## 明确不做"); L.push(""); p.不做什么.forEach((x) => L.push("- " + x)); L.push(""); }
  L.push("---");
  L.push("");
  L.push("*本文件由 `node 内核/run.mjs doc " + path.relative(根, path.resolve(流水线路径)) + "` 从流水线定义渲染，改定义即改文档，不存在两份事实。*");
  return L.join("\n");
}

/* ============ status / detect ============ */

function status(运行目录) {
  const f = path.join(运行目录, "状态.json");
  if (!fs.existsSync(f)) throw new Error("没有 状态.json");
  const s = 读JSON(f);
  console.log("更新：" + s.更新 + "　宿主：" + (s.探测 ? s.探测.状态 + " " + (s.探测.版本 || "") : "?"));
  for (const u of s.单元) {
    console.log("  [" + u.单元ID + "] " + u.覆盖步骤.join(",") + "　" + u.状态 + (u.受阻原因 ? "　← " + u.受阻原因 : ""));
  }
  const 清单 = path.join(运行目录, "交付清单.csv");
  if (fs.existsSync(清单)) { console.log("\n交付清单.csv："); console.log(fs.readFileSync(清单, "utf8").trim()); }
}

/**
 * 探测宿主。
 * 默认**被动**（只看磁盘，零副作用）；`--深` 才真投递探针 ——
 * 因为「深」会启动宿主软件（Photoshop 会被打开），绝不能由界面自动触发。
 */
async function detect(软件, 深 = false) {
  const 适配器 = await 载适配器(软件, []);
  const fn = 深 && 适配器.探测通道 ? 适配器.探测通道 : 适配器.探测;
  const r = fn ? fn({ 运行目录: "/tmp", 意图: {}, 流水线: {}, 步骤: [] }) : {};
  console.log(JSON.stringify({ 适配器: 适配器.id, 名称: 适配器.名称, ...r }, null, 2));
  return r;
}

/* ============ 命令行 ============ */

function 取参数(av, 名) { const i = av.indexOf(名); return i >= 0 ? av[i + 1] : undefined; }

const [cmd, ...av] = process.argv.slice(2);
try {
  if (cmd === "plan") await plan(av[0], 取参数(av, "--intent"), 取参数(av, "--out"), 取参数(av, "--适配器"));
  else if (cmd === "run") await run(av[0], { 步骤: 取参数(av, "--步骤"), 重跑: av.includes("--重跑"), 忽略空间检查: av.includes("--忽略空间检查") });
  else if (cmd === "replay") await run(av[0], { 重跑: true });
  else if (cmd === "status") status(av[0]);
  else if (cmd === "doc") process.stdout.write(doc(av[0]));
  else if (cmd === "detect") await detect(av[0], av.includes("--深"));
  else {
    console.log("用法：\n  run.mjs detect <软件> [--深]（--深 会真的启动宿主软件一次，默认不启动）\n  run.mjs plan <流水线.json> --intent <意图.json> --out <运行目录>\n  run.mjs run <运行目录> [--步骤 S1,S3] [--重跑]\n  run.mjs replay <运行目录>\n  run.mjs status <运行目录>\n  run.mjs doc <流水线.json>");
    process.exit(1);
  }
} catch (e) {
  console.error("出错：" + e.message);
  process.exit(2);
}
