// 深鲸工序 · DSH 插件 —— 宿主（服务端）半边
//
// 它做三件事：
//   ① 注册「技能」：Agent 读了就知道这条工序怎么跑、边界在哪
//   ② 挂 `/工序` 命令：会话里的可见入口（打一句就出本机三软件状态）
//   ③ 给面板供数据：`ctx.webServer.register` 开一个自己的 HTTP 出口（与页面同源，无需握手）
//
// 为什么数据走 HTTP：DSH 的命名路由就是为"插件自己的出口"准备的（同源、能轮询、能 SSE）。
// 安全边界：webServer 只接受回环地址请求；这里再限制成"只做本机文件操作、只回产物摘要"。
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFile } from 'node:child_process';

// ⚠️ 必须用 fileURLToPath：用 URL.pathname 的话路径里的空格会变 %20，技能文件直接读不到
//    （我们的工作区叫「DeepSeek Harness」，带空格 —— 这个坑当场踩了）
const 包根 = join(dirname(fileURLToPath(import.meta.url)), '..');
const 技能文件 = join(包根, 'skill', 'design-line.md');
const CLI = join(包根, 'bin', 'cli.mjs');
const 校验器 = join(包根, '回执模块', 'verify.mjs');
const ROUTE = '/dsh-design-line';

export const name = 'design-line';
export const inject = ['skills', 'commands', 'webServer'];

/* ────────────────────────── 小工具 ────────────────────────── */

/** 跑 CLI 收 stdout（异步，不阻塞宿主事件循环太久） */
function 跑CLI(参数, { 超时 = 120000 } = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...参数], { timeout: 超时, windowsHide: true, maxBuffer: 8 << 20 },
      (e, stdout, stderr) => resolve({
        码: e ? (e.code ?? 1) : 0,
        出: String(stdout || ""),
        错: String(stderr || "") + (e && !stderr ? String(e.message) : ""),
      }));
  });
}

/** 后台起长任务（出图/渲染要几分钟），面板靠轮询 /state 看进度 */
function 起后台(参数) {
  // 外接适配器目录通过环境变量传给内核（CLI 里也支持 --适配器目录，这里走环境变量更省事）
  const 外 = 读外接();
  const 环境 = { ...process.env };
  if (外.length) 环境.设计插件_适配器目录 = 外.join(process.platform === "win32" ? ";" : ":");
  const 子 = spawn(process.execPath, [CLI, ...参数], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: 环境 });
  const 尾巴 = [];
  const 收 = (b) => { 尾巴.push(String(b).trim()); if (尾巴.length > 60) 尾巴.shift(); };
  子.stdout.on('data', 收);
  子.stderr.on('data', 收);
  return { 子, 尾巴, 开始: Date.now() };
}

const 读JSON = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

/* ---------------- 外接适配器（「我们是框架」在面板上的入口） ---------------- */
// 别人写一个 <软件名>.mjs（实现 探测/编译/发射/静态校验），指个目录过来就能接入，内核零改动。
// 配置存 ~/.深鲸工序/适配器目录.json —— 不写进插件目录（安装目录可能只读）。
const 外接配置 = join(homedir(), ".深鲸工序", "适配器目录.json");
const 读外接 = () => (读JSON(外接配置) || { 目录: [] }).目录 || [];
function 存外接(目录们) {
  try { mkdirSync(dirname(外接配置), { recursive: true }); writeFileSync(外接配置, JSON.stringify({ 目录: 目录们 }, null, 2), "utf8"); return true; } catch { return false; }
}
/** 扫一个目录里的适配器，并**真的动态加载一次**校验接口齐不齐（不是只看文件名） */
async function 扫适配器(目录) {
  const 出 = [];
  let 文件们 = [];
  try { 文件们 = readdirSync(目录).filter((n) => n.endsWith(".mjs") && !n.includes("替身")); } catch { return { 目录, 存在: false, 适配器: [] }; }
  for (const n of 文件们) {
    const 全 = join(目录, n);
    const 条 = { 文件: n, 软件: n.replace(/\.mjs$/, ""), 可用: false, 说明: "" };
    try {
      const m = await import(pathToFileURL(全).href);   // Windows：file://C:\… 是非法 URL，必须用 pathToFileURL
      const a = m.default || m;
      const 缺 = ["探测", "编译", "发射", "静态校验"].filter((k) => typeof a?.[k] !== "function");
      if (缺.length) 条.说明 = "缺函数：" + 缺.join("/");
      else { 条.可用 = true; 条.名称 = a.名称 || a.id || 条.软件; 条.说明 = "接口齐全"; }
    } catch (e) { 条.说明 = "加载失败：" + String(e.message || e).slice(0, 80); }
    出.push(条);
  }
  return { 目录, 存在: true, 适配器: 出 };
}
function 内置适配器() {
  const 目录 = join(包根, "适配器");
  try { return readdirSync(目录).filter((n) => n.endsWith(".mjs") && !n.includes("替身") && n !== "词法.mjs" && !n.includes("瘦身") && !n.includes("中英映射")).map((n) => n.replace(/\.mjs$/, "")); } catch { return []; }
}

const 有 = (f) => existsSync(f);

/** 列目录（面板里选素材/图纸/场景） */
function 列目录(路径) {
  if (!有(路径)) return { ok: false, 原因: "目录不存在：" + 路径 };
  const 目录 = [];
  const 文件数 = { 图片: 0, 图纸: 0, 场景: 0, 其它: 0 };
  for (const n of readdirSync(路径)) {
    const p = join(路径, n);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (!n.startsWith("_") && !n.startsWith(".")) 目录.push(n); continue; }
    const e = extname(n).toLowerCase();
    if (/\.(jpg|jpeg|png|tif|tiff|psd|bmp)$/.test(e)) 文件数.图片++;
    else if (e === ".dwg" || e === ".dxf") 文件数.图纸++;
    else if (e === ".max") 文件数.场景++;
    else 文件数.其它++;
  }
  return { ok: true, 目录: 目录.slice(0, 80), 文件数 };
}

/** 一条流水线的步骤摘要（面板"先落盘审阅"那一屏要展示四件事） */
function 步骤摘要(步骤们) {
  return (步骤们 || []).map((s) => ({
    编号: s.编号, 名称: s.名称, 做什么: s.做什么,
    接口: (s.接口 || []).map((i) => i.调用),
    验证: s.验证 || [],
    回退: s.回退 || [],
  }));
}

/* ────────────────────────── 路由 ────────────────────────── */

function 建处理器() {
  const 任务表 = new Map();   // 运行目录 → 后台任务
  const 状态缓存 = { 时刻: 0, 数据: null };   // 被动探测结果缓存（60 秒），避免每次开面板都重扫

  const 回 = (res, 码, 数据) => {
    const 体 = JSON.stringify(数据);
    res.writeHead(码, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(体) });
    res.end(体);
  };

  const 读体 = (req) => new Promise((resolve) => {
    let 累 = "";
    req.on('data', (b) => { 累 += b; if (累.length > (1 << 20)) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(累 || "{}")); } catch { resolve({}); } });
  });

  return async function handler(req, res, url) {
    // ⚠️ url.pathname 是**百分号编码**的：中文路由（如 /适配器）拿到的是 %E9%80%82...，
    //    不解码就会 404。老接口全是英文所以一直没暴露 —— 加中文路由才踩到。
    const 全路径 = decodeURIComponent((url && url.pathname) ? url.pathname : String(req.url || ""));
    const 路 = 全路径.replace(ROUTE, "").replace(/^\/api/, "") || "/";
    try {
      // ① 三软件状态（**被动探测：绝不启动任何宿主软件**）
      //
      // ⚠️ 2026-10-15 踩过的坑：原来的探测会真的把探针投递给 Photoshop（open -g -a），
      //    而面板一打开就调 /status → 等于**每开一次面板就把 Photoshop 打开一次**。
      //    用户原话：「我只要选择深鲸工序自动默认打开 ps，神经病啊，一次一次又一次」。
      //    现在：默认被动（只看文件）+ 60 秒缓存 + 三个并行；要实测通道必须用户点「测试通道」走 /probe。
      // ⓪ 外接适配器：列 + 加 + 删（「我们是框架」的面板入口）
      if (路 === "/适配器" && req.method === "GET") {
        const 外 = [];
        for (const d of 读外接()) 外.push(await 扫适配器(d));
        return 回(res, 200, { ok: true, 内置: 内置适配器(), 外接: 外, 配置: 外接配置 });
      }
      if (路 === "/适配器" && req.method === "POST") {
        const 体 = await 读体(req);
        const 动作 = 体.动作 || "加";
        const 目录 = String(体.目录 || "").trim();
        if (!目录) return 回(res, 400, { ok: false, 错误: "没给目录" });
        let 们 = 读外接();
        if (动作 === "删") 们 = 们.filter((x) => x !== 目录);
        else {
          if (!有(目录)) return 回(res, 400, { ok: false, 错误: "目录不存在：" + 目录 });
          if (!们.includes(目录)) 们.push(目录);
        }
        if (!存外接(们)) return 回(res, 500, { ok: false, 错误: "配置写不进去：" + 外接配置 });
        // ⭐ 回读核验（判据在磁盘那边，不是"我写了没报错"）
        const 回读 = 读外接();
        const 扫 = await 扫适配器(目录);
        return 回(res, 200, { ok: true, 外接目录: 回读, 本次: 扫, 已落盘: 回读.includes(目录) === (动作 !== "删") });
      }
      if (路 === "/status") {
        const 强刷 = url && url.searchParams.get("刷") === "1";
        const 现在 = Date.now();
        if (!强刷 && 状态缓存.数据 && 现在 - 状态缓存.时刻 < 60000) {
          return 回(res, 200, { ok: true, 家: homedir(), 软件: 状态缓存.数据, 缓存秒: Math.round((现在 - 状态缓存.时刻) / 1000) });
        }
        const 软件表 = [["photoshop", "Photoshop"], ["autocad", "AutoCAD"], ["threedsmax", "3ds Max"], ["blender", "Blender"]];
        const 出 = await Promise.all(软件表.map(async ([id, 名]) => {
          const r = await 跑CLI(["detect", id], { 超时: 60000 });
          let j = null; try { j = JSON.parse(r.出); } catch { /* 探测失败 */ }
          return { id, 名, 状态: j ? j.状态 : "探测失败", 版本: j ? j.版本 : null,
                   说明: j ? (j.说明 || "") : (r.错 || "").slice(0, 200), 已启动: j ? !!j.已启动 : false };
        }));
        状态缓存.数据 = 出; 状态缓存.时刻 = 现在;
        return 回(res, 200, { ok: true, 家: homedir(), 软件: 出 });
      }

      // ①b 主动探测通道（**会启动宿主软件**）—— 只由用户点「测试通道」触发，绝不自动
      if (路 === "/probe") {
        const 体 = await 读体(req);
        const 软件id = String(体.软件 || "").trim();
        if (!软件id) return 回(res, 400, { ok: false, 原因: "没给软件 id" });
        const r = await 跑CLI(["detect", 软件id, "--深"], { 超时: 180000 });
        let j = null; try { j = JSON.parse(r.出); } catch { /* ignore */ }
        状态缓存.数据 = null;   // 测完清缓存，下次 /status 重新读
        return 回(res, 200, { ok: true, 结果: j || { 状态: "探测失败", 说明: (r.错 || r.出).slice(0, 300) } });
      }

      // ② 内置流水线
      if (路 === "/pipelines") {
        const 目录 = join(包根, "流水线");
        const 列表 = readdirSync(目录).filter((f) => f.endsWith(".json")).map((f) => {
          const j = 读JSON(join(目录, f));
          if (!j) return null;
          return { id: j.id, 文件: f, 软件: j.软件, 标题: j.标题, 替掉: j.替掉的工作量, 步骤数: j.步骤.length, 步骤: 步骤摘要(j.步骤) };
        }).filter(Boolean);
        // 版本号：面板顶部显示，方便一眼确认装的是哪一版
        let 版本 = "";
        try { 版本 = JSON.parse(readFileSync(join(包根, "package.json"), "utf8")).version || ""; } catch { 版本 = ""; }
        return 回(res, 200, { ok: true, 版本, 流水线: 列表 });
      }

      // ③ 目录浏览
      if (路 === "/ls") {
        const p = (url && url.searchParams.get("路径")) || join(homedir(), "Desktop");
        return 回(res, 200, { ok: true, 路径: p, ...列目录(p) });
      }

      // ④ 落盘审阅（不执行）
      if (路 === "/plan") {
        const 体 = await 读体(req);
        const 流水线文件 = String(体.流水线 || "").trim();
        const 意图 = 体.意图 || {};
        if (!流水线文件) return 回(res, 400, { ok: false, 原因: "没给流水线" });
        const 输出目录 = 意图.交付目录 || join(homedir(), "Desktop", "深鲸工序");
        const 时间戳 = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
        const 运行目录 = join(输出目录, "_运行", 时间戳 + "-" + 流水线文件.replace(/\.json$/, ""));
        mkdirSync(运行目录, { recursive: true });
        意图.交付目录 = 输出目录;
        const 意图文件 = join(运行目录, "_意图输入.json");
        writeFileSync(意图文件, JSON.stringify(意图, null, 2), "utf8");
        const r = await 跑CLI(["plan", join(包根, "流水线", 流水线文件), "--intent", 意图文件, "--out", 运行目录]);
        const 计划 = 读JSON(join(运行目录, "计划.json"));
        if (!计划) return 回(res, 500, { ok: false, 原因: "落盘失败", 细节: (r.错 || r.出).slice(-1500) });
        return 回(res, 200, {
          ok: true, 运行目录, 输出目录,
          探测: 计划.探测,
          单元: (计划.单元 || []).map((u) => ({ 单元ID: u.单元ID, 覆盖步骤: u.覆盖步骤, 脚本: u.脚本名, 静态校验: u.静态校验 })),
          步骤: 步骤摘要(计划.步骤),
        });
      }

      // ⑤ 执行（后台，立即返回；面板轮询 /state）
      if (路 === "/run") {
        const 体 = await 读体(req);
        const 运行目录 = 体.运行目录;
        if (!运行目录 || !有(join(运行目录, "计划.json"))) return 回(res, 400, { ok: false, 原因: "运行目录里没有计划 —— 要先「先落盘审阅」" });
        const 旧任务 = 任务表.get(运行目录);
        if (旧任务 && 旧任务.子.exitCode === null) return 回(res, 200, { ok: true, 已在跑: true });
        const 参数 = ["run", 运行目录];
        if (体.步骤) 参数.push("--步骤", 体.步骤);
        if (体.重跑) 参数.push("--重跑");
        任务表.set(运行目录, 起后台(参数));
        return 回(res, 200, { ok: true, 已启动: true });
      }

      // ⑥ 状态（面板轮询这个）
      if (路 === "/state") {
        const 运行目录 = url && url.searchParams.get("运行目录");
        if (!运行目录) return 回(res, 400, { ok: false, 原因: "缺运行目录" });
        const 状态 = 读JSON(join(运行目录, "状态.json"));
        const 回执 = 读JSON(join(运行目录, "回执.json"));
        const 计划 = 读JSON(join(运行目录, "计划.json"));
        const 任务 = 任务表.get(运行目录);
        const 产物 = (回执 && 回执.产物 ? 回执.产物 : []).map((p) => ({ 路径: p.路径, 字节: p.字节, 本次生成: p.本次生成 }));
        return 回(res, 200, {
          ok: true,
          运行中: !!(任务 && 任务.子.exitCode === null),
          单元: 状态 ? 状态.单元 : (计划 ? (计划.单元 || []).map((u) => ({ 单元ID: u.单元ID, 覆盖步骤: u.覆盖步骤, 状态: "待执行" })) : []),
          探测: 状态 ? 状态.探测 : (计划 ? 计划.探测 : null),
          结论: 回执 ? 回执.结论 : null,
          用时秒: 回执 ? 回执.用时秒 : null,
          步骤记录: 回执 ? (回执.步骤 || []).map((s) => ({ 编号: s.编号, 名称: s.名称, 状态: s.状态, 耗时毫秒: s.耗时毫秒, 分支: s.分支 })) : [],
          降级: 回执 ? (回执.降级与跳过 || []) : [],
          产物,
          日志尾巴: 任务 ? 任务.尾巴.slice(-6) : [],
        });
      }

      // ⑦ 独立校验回执（客户视角）
      if (路 === "/verify") {
        const 体 = await 读体(req);
        if (!体.运行目录) return 回(res, 400, { ok: false, 原因: "缺运行目录" });
        const 校验 = await new Promise((resolve) => {
          execFile(process.execPath, [校验器, 体.运行目录, "--json"], { timeout: 120000, maxBuffer: 4 << 20 },
            (e, stdout) => { try { resolve(JSON.parse(stdout)); } catch { resolve({ 结论: "校验器没给出结果", 问题: [String((e && e.message) || e)] }); } });
        });
        return 回(res, 200, { ok: true, 校验 });
      }

      // ⑧ 打开目录
      if (路 === "/open") {
        const 体 = await 读体(req);
        const p = 体.目录;
        if (!p || !有(p)) return 回(res, 400, { ok: false, 原因: "目录不存在" });
        const [f, a] = process.platform === "win32" ? ["cmd", ["/c", "start", "", p]]
          : process.platform === "darwin" ? ["open", [p]]
          : ["xdg-open", [p]];
        spawn(f, a, { detached: true, stdio: "ignore" }).unref();
        return 回(res, 200, { ok: true });
      }

      return 回(res, 404, { ok: false, 原因: "没有这个接口：" + 路 });
    } catch (e) {
      return 回(res, 500, { ok: false, 原因: String((e && e.message) || e) });
    }
  };
}

/* ────────────────────────── 注册 ────────────────────────── */

export function apply(ctx) {
  // ① 技能
  if (ctx.skills && typeof ctx.skills.register === 'function') {
    try {
      const content = readFileSync(技能文件, 'utf-8').split('<cli 路径>').join(CLI);
      ctx.skills.register({
        name: 'design-line',
        source: 'bundled',
        description: '设计工序流水线：PS 出图交付 / AutoCAD 出图标准化 / 3ds Max 批渲染交付 / Blender 批渲染交付 / Blender 场景瘦身 —— 跑完出一条完整工序并出可核对的交付凭证',
        whenToUse: '用户说要“批量出图/统一尺寸加水印/出交付清单/图纸规范化/批量出 PDF/批量渲染/按标准出图”时用这个技能',
        content,
      });
      ctx.logger?.info?.('[design-line] 已注册技能 design-line');
    } catch (e) {
      ctx.logger?.error?.('[design-line] 技能注册失败：' + e);
    }
  } else {
    ctx.logger?.warn?.('[design-line] 没有 skills 服务，跳过技能注册');
  }

  // ② /工序 命令
  if (ctx.commands && typeof ctx.commands.register === 'function') {
    const handler = async () => {
      const 行 = ['深鲸工序 · 本机状态', ''];
      for (const [id, 名] of [['photoshop', 'Photoshop'], ['autocad', 'AutoCAD'], ['threedsmax', '3ds Max'], ['blender', 'Blender']]) {
        const r = await 跑CLI(['detect', id], { 超时: 90000 });
        let j = null; try { j = JSON.parse(r.出); } catch { /* ignore */ }
        const 状态 = j ? j.状态 : '探测失败';
        行.push('  ' + (状态 === '可用' ? '●' : '○') + ' ' + 名.padEnd(12) + ' ' + 状态 + (j && j.版本 ? ' ' + j.版本 : ''));
      }
      行.push('', '可用 = 装了能跑；缺宿主 = 没装（CAD/Max 只有 Windows 版）；受阻 = 装了但通道不通');
      行.push('', '接下来直接说一句就行，例如：「把这批图按客户要的三个尺寸出成交付，右下加水印」');
      行.push('也可以打开左侧「深鲸工序」面板，点着跑。');
      return 行.join('\n');
    };
    for (const 命令名 of ['工序', 'design-line']) {
      try { ctx.commands.register({ name: 命令名, description: '深鲸工序：看本机三软件状态（Photoshop / AutoCAD / 3ds Max）', handler }); }
      catch (e) { ctx.logger?.warn?.('[design-line] 注册命令 ' + 命令名 + ' 失败：' + e); }
    }
    ctx.logger?.info?.('[design-line] 已注册命令 /工序、/design-line');
  } else {
    ctx.logger?.warn?.('[design-line] 没有 commands 服务，跳过 /工序 命令');
  }

  // ③ 面板数据出口
  if (ctx.webServer && typeof ctx.webServer.register === 'function') {
    const handler = 建处理器();
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler }), 'design-line: http 出口');
    ctx.logger?.info?.('[design-line] 已挂 HTTP 出口 ' + ROUTE + '/api');
  } else {
    ctx.logger?.warn?.('[design-line] 没有 webServer 服务，面板会取不到数据');
  }

  // 脚本随包分发可能丢可执行位，补上
  if (有(CLI)) {
    try {
      const m = statSync(CLI).mode;
      if (!(m & 0o111)) chmodSync(CLI, m | 0o755);
    } catch { /* 只读文件系统：忽略 */ }
  }
}

export default { name, inject, apply };
