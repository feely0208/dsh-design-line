// 校验层：判据一律【读产物本身】，不看宿主自报成功。
// 只用 Node 内置模块，零依赖 —— 因为校验是护城河，不能押在别人的库上。
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/* ---------- 图片/PDF 头部解析（不依赖任何库） ---------- */

export function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { 宽: buf.readUInt32BE(16), 高: buf.readUInt32BE(20) };
}

export function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { 高: buf.readUInt16BE(i + 5), 宽: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

export function imageSize(buf) {
  return pngSize(buf) || jpegSize(buf);
}

export function pdfPageCount(buf) {
  const s = buf.toString("latin1");
  const m = s.match(/\/Type\s*\/Page(?![s])/g);
  return m ? m.length : 0;
}

/* ---------- PNG 像素统计：抓「文件在、图是黑/白/纯色」的静默失败 ---------- */

export function pngLuma(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8, 宽 = 0, 高 = 0, 位深 = 0, 色型 = 0, 隔行 = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      宽 = data.readUInt32BE(0); 高 = data.readUInt32BE(4);
      位深 = data[8]; 色型 = data[9]; 隔行 = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (!宽 || !高 || 位深 !== 8 || 隔行 !== 0) return null;
  const 通道 = { 0: 1, 2: 3, 4: 2, 6: 4 }[色型];
  if (!通道) return null;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return null; }
  const 行字节 = 宽 * 通道;
  const 前一行 = Buffer.alloc(行字节);
  const 当前 = Buffer.alloc(行字节);
  const 亮 = [];
  let p = 0;
  for (let y = 0; y < 高; y++) {
    const 滤波 = raw[p++];
    raw.copy(当前, 0, p, p + 行字节);
    p += 行字节;
    for (let i = 0; i < 行字节; i++) {
      const a = i >= 通道 ? 当前[i - 通道] : 0;
      const b = 前一行[i];
      const c = i >= 通道 ? 前一行[i - 通道] : 0;
      let v = 当前[i];
      if (滤波 === 1) v += a;
      else if (滤波 === 2) v += b;
      else if (滤波 === 3) v += (a + b) >> 1;
      else if (滤波 === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      当前[i] = v & 0xff;
    }
    if (y % Math.max(1, Math.floor(高 / 40)) === 0) {
      for (let x = 0; x < 宽; x += Math.max(1, Math.floor(宽 / 40))) {
        const i = x * 通道;
        const r = 当前[i], g = 通道 >= 3 ? 当前[i + 1] : r, bl = 通道 >= 3 ? 当前[i + 2] : r;
        亮.push(0.299 * r + 0.587 * g + 0.114 * bl);
      }
    }
    当前.copy(前一行);
  }
  const 均 = 亮.reduce((s, v) => s + v, 0) / 亮.length;
  const 方差 = 亮.reduce((s, v) => s + (v - 均) * (v - 均), 0) / 亮.length;
  return { 宽, 高, 采样数: 亮.length, 均值: +均.toFixed(2), 方差: +方差.toFixed(2) };
}

/* ---------- CSV ---------- */

export function csvRows(file) {
  // ⚠️ ExtendScript 的 File.write 把 "\n" 写成 CR（不是 LF）—— 只按 \r?\n 切会数成 1 行
  const t = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();
  if (!t) return 0;
  return t.split(/\r\n|\r|\n/).length - 1; // 扣掉表头
}

export function writeCsv(file, rows) {
  const body = rows
    .map((r) => r.map((c) => {
      const s = c === null || c === undefined ? "" : String(c);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(","))
    .join("\r\n");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "\uFEFF" + body + "\r\n", "utf8"); // BOM：Excel 打开中文不乱码
}

/* ---------- 简易 glob ---------- */

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export function glob(root, pattern) {
  const rx = new RegExp(
    "^" + pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "\u0000")
      .replace(/\*/g, "[^/]*")
      .split("\u0000").join(".*")
    + "$"
  );
  return walk(root)
    .map((p) => path.relative(root, p).split(path.sep).join("/"))
    .filter((p) => rx.test(p))
    .sort();
}

/* ---------- 检查项执行 ---------- */

// 路径解析：检查项可能给相对运行目录的路径，也可能给绝对路径（适配器声明的「主要产物」就是绝对）
const 解路径 = (dir, p) => (path.isAbsolute(p) ? p : path.join(dir, p));

const 实现 = {
  文件存在: (c, dir) => {
    const ok = fs.existsSync(path.join(dir, c.路径));
    return { ok, 实际: ok ? "存在" : "缺失" };
  },
  字节下限: (c, dir) => {
    const f = 解路径(dir, c.路径);
    const n = fs.existsSync(f) ? fs.statSync(f).size : 0;
    return { ok: n >= c.字节, 实际: n + " 字节" };
  },
  图片尺寸: (c, dir) => {
    const f = 解路径(dir, c.路径);
    if (!fs.existsSync(f)) return { ok: false, 实际: "文件缺失" };
    const s = imageSize(fs.readFileSync(f));
    if (!s) return { ok: false, 实际: "不是可识别的 PNG/JPEG" };
    return { ok: s.宽 === c.宽 && s.高 === c.高, 实际: s.宽 + "×" + s.高 };
  },
  pdf页数: (c, dir) => {
    const f = 解路径(dir, c.路径);
    if (!fs.existsSync(f)) return { ok: false, 实际: "文件缺失" };
    const n = pdfPageCount(fs.readFileSync(f));
    return { ok: n === c.页数, 实际: n + " 页" };
  },
  csv行数: (c, dir) => {
    const f = 解路径(dir, c.路径);
    if (!fs.existsSync(f)) return { ok: false, 实际: "文件缺失" };
    const n = csvRows(f);
    return { ok: n === c.数量, 实际: n + " 行（不含表头）" };
  },
  glob数量: (c, dir) => {
    const n = glob(path.join(dir, c.目录 || "."), c.模式).length;
    return { ok: n === c.数量, 实际: n + " 个" };
  },
  glob至少: (c, dir) => {
    const n = glob(path.join(dir, c.目录 || "."), c.模式).length;
    return { ok: n >= c.至少, 实际: n + " 个（要求 ≥ " + c.至少 + "）" };
  },
  glob存在: (c, dir) => {
    const n = glob(path.join(dir, c.目录 || "."), c.模式).length;
    return { ok: n > 0, 实际: n + " 个（要求 > 0）" };
  },
  非纯色: (c, dir) => {
    const f = 解路径(dir, c.路径);
    if (!fs.existsSync(f)) return { ok: false, 实际: "文件缺失" };
    const r = pngLuma(fs.readFileSync(f));
    if (!r) return { ok: null, 实际: "非 PNG 或非 8 位非隔行，无法判像素（未跑）" };
    return { ok: r.方差 >= (c.最小方差 || 10), 实际: "均值 " + r.均值 + " 方差 " + r.方差 + "（阈值 " + (c.最小方差 || 10) + "）" };
  },
  全部非纯色: (c, dir) => {
    const 基 = path.join(dir, c.目录 || ".");
    const 文件 = glob(基, c.模式);
    if (!文件.length) return { ok: false, 实际: "没有匹配文件" };
    const 结果 = [];
    for (const rel of 文件) {
      const r = pngLuma(fs.readFileSync(path.join(基, rel)));
      结果.push({ 文件: rel, 方差: r ? r.方差 : null });
    }
    const 可疑 = 结果.filter((r) => r.方差 !== null && r.方差 < (c.最小方差 || 10));
    const 未判 = 结果.filter((r) => r.方差 === null);
    return {
      ok: 可疑.length === 0,
      实际: 结果.length + " 张，可疑 " + 可疑.length + " 张，未判（非 PNG）" + 未判.length + " 张"
        + (可疑.length ? "：" + 可疑.map((r) => r.文件 + "(方差 " + r.方差 + ")").slice(0, 3).join(" ") : ""),
    };
  },
  全部图片尺寸: (c, dir) => {
    const 基 = path.join(dir, c.目录 || ".");
    const 文件 = glob(基, c.模式);
    if (!文件.length) return { ok: false, 实际: "没有匹配文件" };
    const 坏 = [];
    for (const rel of 文件) {
      const s2 = imageSize(fs.readFileSync(path.join(基, rel)));
      if (!s2 || s2.宽 !== c.宽 || s2.高 !== c.高) 坏.push(rel + (s2 ? "(" + s2.宽 + "×" + s2.高 + ")" : "(读不出尺寸)"));
    }
    return { ok: 坏.length === 0, 实际: 文件.length + " 张，全部应为 " + c.宽 + "×" + c.高 + (坏.length ? "；不符 " + 坏.length + " 张：" + 坏.slice(0, 3).join(" ") : " ✅") };
  },
  全部字节下限: (c, dir) => {
    const 基 = path.join(dir, c.目录 || ".");
    const 文件 = glob(基, c.模式);
    if (!文件.length) return { ok: false, 实际: "没有匹配文件" };
    const 小 = 文件.filter((rel) => fs.statSync(path.join(基, rel)).size < c.最小字节);
    return { ok: 小.length === 0, 实际: 文件.length + " 个，最小 " + Math.min(...文件.map((rel) => fs.statSync(path.join(基, rel)).size)) + " 字节" + (小.length ? "，过小 " + 小.length + " 个" : "") };
  },
  本次生成: (c, dir, ctx) => {
    const f = 解路径(dir, c.路径);
    if (!fs.existsSync(f)) return { ok: false, 实际: "文件缺失" };
    const 改动 = fs.statSync(f).mtimeMs;
    const 起点 = ctx && ctx.本次开始时间 ? ctx.本次开始时间 : 0;
    return {
      ok: 改动 >= 起点,
      实际: new Date(改动).toISOString() + (改动 >= 起点 ? "（本次生成）" : "（⚠️ 早于本次运行：" + new Date(起点).toISOString() + "，疑似旧文件冒充）"),
    };
  },
  文本包含: (c, dir) => {
    const f = 解路径(dir, c.路径);
    if (!fs.existsSync(f)) return { ok: false, 实际: "文件缺失" };
    const t = fs.readFileSync(f, "utf8");
    return { ok: t.includes(c.文本), 实际: t.includes(c.文本) ? "包含" : "未包含" };
  },
};

export function runChecks(检查项, 运行目录, 跳过类型 = [], ctx = {}) {
  return (检查项 || []).map((c) => {
    const 名称 = c.类型 || Object.keys(c).find((k) => 实现[k]);
    if (跳过类型.includes(名称)) {
      return { 检查: 名称, 参数: c, 结果: "未跑", 说明: "宿主替身不支持此判据，未计入通过" };
    }
    const fn = 实现[名称];
    if (!fn) return { 检查: 名称, 参数: c, 结果: "未跑", 说明: "未知检查类型" };
    const r = fn(c, 运行目录, ctx);
    return { 检查: 名称, 参数: c, 结果: r.ok ? "通过" : "失败", 实际: r.实际 };
  });
}
