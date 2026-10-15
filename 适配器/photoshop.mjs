// 适配器：Adobe Photoshop（ExtendScript / .jsx）
// 只负责三件事：探测能力、把工序编译成脚本、告诉内核怎么把脚本送进去跑。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { 是Win, 是Mac, 找目录, 等文件 } from "../内核/平台.mjs";
import { 括号配平 } from "./词法.mjs";

const APP = process.env.PS_APP || "Adobe Photoshop 2024";
const 模式 = process.env.PS_模式 || "open"; // open（默认，本机唯一可用通道）| applescript（需 macOS 自动化授权）| 打印

/* ---------------- 探测 ---------------- */

export function 找PS() {
  if (是Mac) {
    const 路径 = "/Applications/" + APP + "/" + APP + ".app";
    return fs.existsSync(路径) ? { 路径, 方式: "open" } : null;
  }
  if (是Win) {
    for (const 根 of [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"]]) {
      if (!根) continue;
      const 目录 = 找目录(path.join(根, "Adobe"), "Adobe Photoshop");
      if (目录) {
        const exe = path.join(目录, "Photoshop.exe");
        if (fs.existsSync(exe)) return { 路径: exe, 方式: "com" };
      }
    }
    return null;
  }
  return null;
}

/** 把一份探针 .jsx 真正投递给 Photoshop，并等它的磁盘产物 —— 判据永远在产物那边 */
function 投递并等(探针路径, 标记路径, 毫秒 = 30000) {
  const host = 找PS();
  if (!host) return null;
  if (host.方式 === "open") {
    // ⚠️ -g = 不要激活到前台。不带它每跑一次就把 Photoshop 拽到最前面，会打断用户正在做的事
    spawnSync("open", ["-g", "-a", APP, 探针路径], { encoding: "utf8", timeout: 20000 });
  } else {
    // Windows：走官方 COM 通道（Photoshop.Application.DoJavaScript）
    spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
      `$ErrorActionPreference='Stop'; $p = New-Object -ComObject Photoshop.Application; ` +
      `$t = $p.DoJavaScript([IO.File]::ReadAllText('${探针路径.replace(/'/g, "''")}'))`,
    ], { encoding: "utf8", timeout: 120000 });
  }
  return 等文件(标记路径, 毫秒);
}

export function 探测() {
  const host = 找PS();
  if (!host) {
    return {
      状态: "缺宿主", 版本: null, 宿主: APP, 能力: [],
      说明: "没找到 " + APP + "（装了才有得跑）",
      在哪跑: "装了 Photoshop 的 Windows / macOS 机器",
    };
  }
  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-ps-"));
  const 标记 = path.join(目录, "ok.txt");
  const 探针 = path.join(目录, "探针.jsx");
  fs.writeFileSync(探针, `#target photoshop
var f = new File(${JSON.stringify(标记)});
f.encoding = "UTF-8"; f.open("w");
f.write(app.name + "|" + app.version + "|" + $.engineName);
f.close();
`, "utf8");

  // 通道会偶发抖动（宿主忙/首次冷启动慢）→ 退避重试两次，别让一次抖动就判"不可用"
  let 内容 = null;
  for (const 等待 of [20000, 30000, 45000]) {
    内容 = 投递并等(探针, 标记, 等待);
    if (内容) break;
  }
  if (!内容) {
    return {
      状态: "受阻", 版本: null, 宿主: APP, 能力: [],
      说明: "找到 " + APP + "（" + host.路径 + "），但 30 秒内没等到探针产物。"
        + (是Mac ? "注意：本机若未授予自动化权限，osascript 通道会 -1712；可用的只有 open -a 投递 odoc。" : "Windows 侧走 COM（Photoshop.Application.DoJavaScript），若报错请看标准错误。"),
      在哪跑: "同机",
    };
  }
  const [名, 版本, 引擎] = 内容.split("|");
  return {
    状态: "可用", 版本, 宿主: APP, 引擎, 通道: host.方式 === "open" ? "open -a 投递 .jsx（odoc）" : "COM Photoshop.Application.DoJavaScript",
    能力: ["#target photoshop", "File/Folder", "app.open", "documents.add", "resizeImage/resizeCanvas", "saveAs", "exportDocument", "图层/文字水印", "doc.info"],
    说明: "通道 = " + (host.方式 === "open" ? "open -a 投递 .jsx（odoc 由系统受信进程投递，不需要 AppleEvent 授权）" : "Windows COM Photoshop.Application.DoJavaScript（官方通道）")
      + "。拿不到脚本返回值，一切结果走文件 —— 内核本来就是这么设计的（完成标记 + 产物校验）。",
  };
}

/* ---------------- 脚本生成 ---------------- */

const 头 = (意图, 步骤编号) => `#target photoshop
// 由「设计插件线」内核生成 · 步骤 ${步骤编号} · ${new Date().toISOString()}
// 落盘可审阅：本文件可直接双击/File > Scripts > Browse 运行
app.displayDialogs = DialogModes.NO;
var 意图 = ${JSON.stringify(意图, null, 2)};

// ⭐ 便携版：相对路径一律以【本脚本所在文件夹】为基准
//    （双击 .jsx 时当前工作目录不可预测，用相对路径会静默写错地方 —— 本机实测踩过）
var 脚本夹 = null;
try { if ($.fileName) 脚本夹 = new Folder($.fileName).parent; } catch (e) {}
function 绝对(p){
  var s = String(p === undefined || p === null ? "" : p);
  if (s === "") return s;
  var 是绝对 = (s.charAt(0) === "/") || (s.charAt(1) === ":") || (s.indexOf("\\\\") === 0);
  return 是绝对 ? s : (脚本夹 ? (脚本夹.fullName + "/" + s) : s);
}
if (意图.便携) {
  意图.素材目录 = 绝对(意图.素材目录);
  意图.交付目录 = 绝对(意图.交付目录);
  意图.水印文件 = 绝对(意图.水印文件);
}
var 交付 = 意图.交付目录;
var 运行 = new File(交付 + "/_运行日志.txt");
function 记(s){ 运行.encoding="UTF-8"; 运行.open("a"); 运行.write(s + "\\n"); 运行.close(); }
function 建(d){ var f = new Folder(d); if (!f.exists) f.create(); return f; }
// 幂等基石：工作区是我们自己的派生目录，重跑前先清空（否则每次重跑都会堆出 -02 副本）
function 清空(d){
  var f = new Folder(d);
  if (!f.exists) return;
  var 项 = f.getFiles();
  for (var i = 0; i < 项.length; i++) {
    if (项[i] instanceof Folder) { 清空(项[i].fullName); 项[i].remove(); }
    else 项[i].remove();
  }
}
function 转义(s){ return String(s).replace(/\\x22/g, "\\x22\\x22"); }
function 写表(路径, 行){
  var f = new File(路径); f.encoding = "UTF-8"; f.open("w");
  f.write("\\uFEFF"); // BOM：Excel 打开中文不乱码
  for (var i = 0; i < 行.length; i++) {
    var cells = [];
    for (var j = 0; j < 行[i].length; j++) {
      var v = 行[i][j] === undefined || 行[i][j] === null ? "" : String(行[i][j]);
      var 要引 = v.indexOf(",") >= 0 || v.indexOf("\\n") >= 0 || v.indexOf("\\x22") >= 0;
      cells.push(要引 ? "\\x22" + 转义(v) + "\\x22" : v);
    }
    f.write(cells.join(",") + "\\r\\n");
  }
  f.close();
}
function 渲染名(模板, 序号, 原名, 后缀){
  return 模板.replace("{客户}", 意图.客户 || "").replace("{项目}", 意图.项目 || "")
             .replace(/\\{序号(?::0?(\\d+))?\\}/g, function(m, n){ var w = n ? parseInt(n, 10) : 3; return ("000000" + 序号).slice(-w); })
             .replace("{原文件名}", 原名 || "").replace("{后缀}", 后缀 || "");
}
function 异常(line){ var f = new File(交付 + "/异常.md"); f.encoding="UTF-8"; f.open("a"); f.write(line + "\\n"); f.close(); }

// 完成标记：open -a 拿不到返回值，用文件告诉内核「这一步跑完了」（成功/失败都写）
function 标记(编号, 结果){
  if (!意图.运行目录) return;   // 便携版没有内核在等标记
  var f = new File(意图.运行目录 + "/_完成-" + 编号 + ".txt");
  f.encoding = "UTF-8"; f.open("w"); f.write(String(结果)); f.close();
}
// macOS 上 ExtendScript 对非 ASCII 文件名返回百分号编码（本机实测：微信图片_2026.jpg → %E5%BE%AE…）
// ⚠️ ExtendScript 实测：new JPEGSaveOptions({...}) 这种「对象字面量传参」**不生效**（属性根本没设上），
//    结果 SaveForWeb 用了默认 PNG-8 → 导出成索引色 PNG，后面连文字图层都加不了。必须逐个属性赋值。
function PNG选项(){
  var o = new ExportOptionsSaveForWeb();
  o.format = SaveDocumentType.PNG; o.PNG8 = false; o.transparency = true; o.quality = 100;
  return o;
}
function JPG选项(质量){
  var o = new JPEGSaveOptions();
  o.quality = 质量 || 11; o.embedColorProfile = true;
  return o;
}
function TIF选项(){ var o = new TiffSaveOptions(); o.imageCompression = TIFFEncoding.TIFFLZW; return o; }
function PDF选项(){
  var o = new PDFSaveOptions();
  o.PDFCompatibility = PDFCompatibility.PDF14; o.embedColorProfile = true;
  return o;
}
// 索引色/灰度文档加不了文字图层（实测报「命令"建立:"当前不可用」）—— 统一流程前先转 RGB
function 保证RGB(d){
  try { if (d.mode !== DocumentMode.RGB) d.changeMode(ChangeMode.RGB); return true; }
  catch (e) { 异常("- 转 RGB 失败：" + e.message); return false; }
}

function 真名(名){
  var s = String(名);
  return /%[0-9A-Fa-f]{2}/.test(s) ? decodeURI(s) : s;
}
// 能力探测：BICUBICSHARPER 不是所有老版本都有，探测不到就退回官方确证过的 BICUBIC（Research: 官方 Reference）
var 重采样 = (typeof ResampleMethod.BICUBICSHARPER !== "undefined") ? ResampleMethod.BICUBICSHARPER : ResampleMethod.BICUBIC;
`;

const 步骤生成 = {
  // S1 收料与建档
  S1(意图) {
    return `
建(交付);
var 素材夹 = new Folder(意图.素材目录);
if (!素材夹.exists) { 记("FATAL 素材目录不存在: " + 意图.素材目录); throw new Error("素材目录不存在"); }
var 全部 = 素材夹.getFiles();
var 素材 = [];
for (var i = 0; i < 全部.length; i++) {
  if (全部[i] instanceof File && /\\.(jpg|jpeg|png|tif|tiff|psd|bmp)$/i.test(全部[i].name)) 素材.push(全部[i]);
}
记("扫描到候选文件 " + 素材.length + " 个");
// 上限：一批几十张是常态，几千张多半是选错目录了 —— 别让一个没边界的循环把机器拖死
var 上限 = 意图.最大文件数 || 500;
if (素材.length > 上限) throw new Error("素材太多（" + 素材.length + " 张 > 上限 " + 上限 + "）—— 请缩小目录，或把 意图.最大文件数 调大");
var 行 = [["文件", "宽", "高", "分辨率", "色彩模式", "字节"]];
var 坏 = 0;
for (var i = 0; i < 素材.length; i++) {
  try {
    var d = app.open(素材[i]);
    var w = d.width.value, h = d.height.value;
    var res = d.resolution;   // 官方：ppi 只读；实测同一版本不同文档给数字或 UnitValue，两种都要吃
    if (res && res.value !== undefined) res = res.value;
    if (typeof res !== "number" || isNaN(res)) res = 72;
    var 名 = 真名(素材[i].name);
    行.push([名, Math.round(w), Math.round(h), Math.round(res), String(d.mode).replace("DocumentMode.", ""), 素材[i].length]);
    d.close(SaveOptions.DONOTSAVECHANGES);
  } catch (e) {
    坏++;
    异常("- 打不开：" + 真名(素材[i].name) + " | " + e.message);
    记("SKIP " + 真名(素材[i].name) + " : " + e.message);
  }
}
写表(交付 + "/00-收料清单.csv", 行);
记("建档 " + (行.length - 1) + " 张，异常 " + 坏 + " 张");
if (素材.length === 0) throw new Error("目录里没有可识别的素材，停下不生成空交付包");
"OK S1 " + (行.length - 1);
`;
  },

  // S2 规范命名（复制到工作区）
  S2(意图) {
    return `
清空(交付 + "/工作区");   // 幂等：重跑不产生 -02 副本
建(交付 + "/工作区");
var 素材夹 = new Folder(意图.素材目录);
var 全部 = 素材夹.getFiles();
var 素材 = [];
for (var i = 0; i < 全部.length; i++) if (全部[i] instanceof File) 素材.push(全部[i]);
var 序号 = 0, 复制 = 0, 冲突 = 0;
var 对照 = [["原文件", "新文件"]];
for (var i = 0; i < 素材.length; i++) {
  var f = 素材[i];
  if (!/\\.(jpg|jpeg|png|tif|tiff|psd|bmp)$/i.test(f.name)) continue;
  序号++;
  var 原名 = 真名(f.name);
  var 基 = 原名.replace(/\.[^.]+$/, "");
  var 后缀 = 原名.match(/\.[^.]+$/) ? 原名.match(/\.[^.]+$/)[0] : "";
  var 名 = 渲染名(意图.命名模板 || "{客户}_{项目}_{序号:03}{后缀}", 序号, 基, 后缀);
  名 = 名.replace(/[\\\\\\/:*?\\x22<>|]/g, "_");
  var 目标 = new File(交付 + "/工作区/" + 名);
  var n = 1;
  while (目标.exists) { 冲突++; n++; 目标 = new File(交付 + "/工作区/" + 名.replace(/(\\.[^.]*)$/, "-0" + n + "$1")); }
  var r = f.copy(目标);
  if (!r) { 异常("- 复制失败：" + 原名); 记("FAIL copy " + 原名); }
  else { 复制++; 对照.push([原名, 真名(目标.name)]); }
}
写表(交付 + "/00-命名对照.csv", 对照);
记("命名复制完成 " + 复制 + " 个，冲突消解 " + 冲突 + " 次");
"OK S2 " + 复制;
`;
  },

  // S3 尺寸/画布统一
  S3(意图) {
    return `
建(交付 + "/工作区/统一");
var 工作 = new Folder(交付 + "/工作区").getFiles();
var 目标宽 = 意图.基准宽 || (意图.规格 && 意图.规格[0] ? 意图.规格[0].宽 : 2000);
var 目标高 = 意图.基准高 || (意图.规格 && 意图.规格[0] ? 意图.规格[0].高 : 2000);
var 处理 = 0, 留白 = 0, 裁切 = 0, 降级 = 0;
for (var i = 0; i < 工作.length; i++) {
  var f = 工作[i];
  if (!(f instanceof File) || !/\\.(jpg|jpeg|png|tif|tiff|psd|bmp)$/i.test(f.name)) continue;
  try {
    var d = app.open(f);
    保证RGB(d);   // 索引色/灰度会让后面的文字图层直接失败（实测）
    d.resizeImage(UnitValue(目标宽, "px"), UnitValue(目标高, "px"), (意图.分辨率 || 300), 重采样);
    var 比 = d.width.value / d.height.value, 目比 = 目标宽 / 目标高;
    if (Math.abs(比 - 目比) > 0.001) {
      if ((意图.比例策略 || "留白") === "裁切") { d.resizeCanvas(UnitValue(目标宽, "px"), UnitValue(目标高, "px"), AnchorPosition.MIDDLECENTER); 裁切++; }
      else {
        var 补宽 = Math.max(目标宽, Math.round(目标高 * 比)), 补高 = Math.max(目标高, Math.round(目标宽 / 比));
        d.resizeCanvas(UnitValue(补宽, "px"), UnitValue(补高, "px"), AnchorPosition.MIDDLECENTER);
        留白++;
      }
    }
    var 出 = new File(交付 + "/工作区/统一/" + f.name.replace(/\\.[^.]+$/, "") + ".png");
    d.exportDocument(出, ExportType.SAVEFORWEB, PNG选项(), true, Extension.LOWERCASE);
    d.close(SaveOptions.DONOTSAVECHANGES);
    处理++;
  } catch (e) { 降级++; 异常("- 统一尺寸失败：" + f.name + " | " + e.message); }
}
记("尺寸统一 " + 处理 + " 张（留白 " + 留白 + "，裁切 " + 裁切 + "，失败 " + 降级 + "）");
"OK S3 " + 处理;
`;
  },

  // S4 水印与版权
  S4(意图) {
    return `
建(交付 + "/工作区/水印");
var 统一 = new Folder(交付 + "/工作区/统一").getFiles();
var 水印文件 = 意图.水印文件;
var 已加水印 = 0, 降级 = 0;
for (var i = 0; i < 统一.length; i++) {
  var f = 统一[i];
  if (!(f instanceof File) || !/\\.png$/i.test(f.name)) continue;
  try {
    var d = app.open(f);
    保证RGB(d);   // ⭐ 实测：S3 导出的 PNG 可能是索引色，索引色文档加不了文字图层
    if (水印文件 && new File(水印文件).exists) {
      var w = app.open(new File(水印文件));
      w.activeLayer.duplicate(d, ElementPlacement.PLACEATEND);
      w.close(SaveOptions.DONOTSAVECHANGES);
      var 层 = d.activeLayer;
      层.name = "水印";
      层.opacity = 意图.水印不透明度 || 60;
      var 比 = Math.min(d.width.value * 0.25 / 层.bounds[2].value, 1);
      层.resize(比 * 100, 比 * 100, AnchorPosition.TOPLEFT);
      var dx = d.width.value - 层.bounds[2].value - d.width.value * 0.03;
      var dy = d.height.value - 层.bounds[3].value - d.height.value * 0.03;
      层.translate(UnitValue(dx, "px"), UnitValue(dy, "px"));
      if (意图.版权) {
        d.info.copyrighted = CopyrightedType.COPYRIGHTEDWORK;
        d.info.copyright = 意图.版权.版权 || "";
        d.info.author = 意图.版权.作者 || "";
        d.info.ownerUrl = 意图.版权.网址 || "";
      }
    } else {
      降级++;
      var t = d.artLayers.add();
      t.kind = LayerKind.TEXT;
      t.name = "水印";
      t.textItem.contents = (意图.版权 && 意图.版权.作者) ? 意图.版权.作者 : (意图.客户 || "");
      t.textItem.size = 48;
      t.opacity = 55;
      t.translate(UnitValue(d.width.value * 0.6, "px"), UnitValue(d.height.value * 0.88, "px"));
      异常("- 水印文件缺失，已降级为文字水印：" + 真名(f.name));
    }
    var 出 = new File(交付 + "/工作区/水印/" + f.name);
    d.exportDocument(出, ExportType.SAVEFORWEB, PNG选项(), true, Extension.LOWERCASE);
    d.close(SaveOptions.DONOTSAVECHANGES);
    已加水印++;
  } catch (e) { 异常("- 加水印失败：" + 真名(f.name) + " | " + e.message); }
}
记("水印处理 " + 已加水印 + " 张，降级 " + 降级 + " 张");
"OK S4 " + 已加水印;
`;
  },

  // S5 按规格导出
  S5(意图) {
    return `
var 源 = new Folder(交付 + "/工作区/水印").getFiles();
var 规格 = 意图.规格 || [{ 名: "默认", 宽: 1080, 高: 1080, 格式: "jpg" }];
var 行 = [["规格", "文件", "宽", "高", "格式", "字节"]];
var 导出 = 0, 失败 = 0;
for (var s = 0; s < 规格.length; s++) {
  var sp = 规格[s];
  建(交付 + "/" + sp.名);
  for (var i = 0; i < 源.length; i++) {
    var f = 源[i];
    if (!(f instanceof File)) continue;
    try {
      var d = app.open(f);
      d.resizeImage(UnitValue(sp.宽, "px"), UnitValue(sp.高, "px"), (意图.分辨率 || 300), 重采样);
      var 基 = f.name.replace(/\\.[^.]+$/, "");
      var 格式 = (sp.格式 || "jpg").toLowerCase();
      var 出 = new File(交付 + "/" + sp.名 + "/" + 基 + "." + 格式);
      if (格式 === "jpg" || 格式 === "jpeg") {
        d.saveAs(出, JPG选项(意图.JPG质量), true, Extension.LOWERCASE);
      } else if (格式 === "png") {
        d.exportDocument(出, ExportType.SAVEFORWEB, PNG选项(), true, Extension.LOWERCASE);
      } else if (格式 === "tif" || 格式 === "tiff") {
        d.saveAs(出, TIF选项(), true, Extension.LOWERCASE);
      } else if (格式 === "pdf") {
        d.saveAs(出, PDF选项()  /* 属性名 PDF 全大写，写成 pdfCompatibility 会静默不生效 */, true, Extension.LOWERCASE);
      } else {
        格式 = "png";
        出 = new File(交付 + "/" + sp.名 + "/" + 基 + ".png");
        d.exportDocument(出, ExportType.SAVEFORWEB, PNG选项(), true, Extension.LOWERCASE);
      }
      d.close(SaveOptions.DONOTSAVECHANGES);
      if (出.exists && 出.length > 0) { 行.push([sp.名, 真名(出.name), sp.宽, sp.高, 格式, 出.length]); 导出++; }
      else { 失败++; 异常("- 导出产物为空：" + sp.名 + "/" + 真名(出.name)); }
    } catch (e) { 失败++; 异常("- 导出失败：" + sp.名 + " | " + 真名(f.name) + " | " + e.message); }
  }
}
写表(交付 + "/交付清单.csv", 行);
记("导出 " + 导出 + " 个，失败 " + 失败 + " 个");
"OK S5 " + 导出;
`;
  },

  // S6 交付说明
  S6(意图) {
    return `
var f = new File(交付 + "/交付说明.md"); f.encoding = "UTF-8"; f.open("w");
f.write("# " + (意图.项目 || "") + " 交付说明\\n\\n");
f.write("- 客户：" + (意图.客户 || "") + "\\n");
f.write("- 生成时间：" + new Date().toString() + "\\n");
f.write("- 规格：\\n");
for (var i = 0; i < (意图.规格 || []).length; i++) {
  var s = 意图.规格[i];
  f.write("  - " + s.名 + "：" + s.宽 + "×" + s.高 + " @ " + (意图.分辨率 || 300) + "ppi · " + s.格式 + "\\n");
}
if (意图.版权) f.write("- 版权：" + (意图.版权.版权 || "") + "　作者：" + (意图.版权.作者 || "") + "\\n");
f.close();
"OK S6";
`;
  },
};

/* ---------------- 编译 ---------------- */

export function 编译(ctx) {
  const 意图 = 标准化意图(ctx.意图, ctx.运行目录);
  const 单元 = [];
  if (意图.便携) {
    // 便携版只给一份「双击就跑」：设计师不会双击六个文件
    单元.push({
      单元ID: "PS-双击跑",
      覆盖步骤: ctx.流水线.步骤.map((s) => s.编号),
      脚本名: "出图交付.jsx",
      标记名: "ALL",
      主要产物: path.join(意图.交付目录, "交付清单.csv"),
      语言: "extendscript",
      代码: 便携头(意图) + 合并脚本(意图),
      检查: [{ 类型: "文件存在", 路径: (意图.交付目录 || "交付包") + "/交付清单.csv" }],
      回退: ctx.流水线.步骤.map((s) => s.编号 + "：" + (s.回退 || [])[0]).filter(Boolean),
    });
    return 单元;
  }
  for (const s of ctx.流水线.步骤) {
    const gen = 步骤生成[s.编号];
    if (!gen) continue;
    const 代码 = 头(意图, s.编号)
      + "try {\n" + gen(意图) + "\n标记(\"" + s.编号 + "\", \"ok\");\n"
      + "} catch (e) { 异常(\"- 步骤 " + s.编号 + " 异常：\" + e.message); 标记(\"" + s.编号 + "\", \"fail:\" + e.message); }\n";
    单元.push({
      单元ID: "PS-" + s.编号,
      覆盖步骤: [s.编号],
      脚本名: "步骤" + s.编号 + "-" + s.名称.replace(/[\/\\:*?"<>|\s]/g, "") + ".jsx",
      标记名: s.编号,
      主要产物: s.编号 === "S1" ? path.join(意图.交付目录, "00-收料清单.csv") : (s.编号 === "S5" ? path.join(意图.交付目录, "交付清单.csv") : undefined),
      语言: "extendscript",
      代码,
      检查: 由检查生成(s, 意图, ctx.运行目录),
      回退: s.回退,
    });
  }
  // ⭐ 单文件「双击就跑」：设计师不会双击六个分步脚本
  单元.push({
    单元ID: "PS-双击跑",
    覆盖步骤: ["S1", "S2", "S3", "S4", "S5", "S6"],
    脚本名: "双击跑-出图交付.jsx",
    标记名: "ALL",
    等待秒: 600,
    语言: "extendscript",
    代码: 合并脚本(意图),
    检查: [
      ...由检查生成({ 编号: "S5" }, 意图, ctx.运行目录),
      // 脚本自己写的回执必须说「失败数=0」—— 堵死「文件在就算通过」的口子
      { 类型: "文本包含", 路径: (由检查生成({ 编号: "S1" }, 意图, ctx.运行目录)[0].路径.replace(/00-收料清单\.csv$/, "")) + "_双击跑回执.txt", 文本: "失败数=0" },
    ],
    回退: ["单步失败不中断其余步骤；报告同时进弹窗与 异常.md", "重跑幂等（工作区每次重建）"],
  });

  return 单元;
}

// 便携版头部：把「要改哪里」写在最前面，设计师照着改 4 个地方就能跑
function 便携头(意图) {
  return `// ============================================================
// 深鲸工序 · PS 出图交付（在 Photoshop 里运行）
// ============================================================
// 怎么用：把本文件放进任意文件夹，然后在 Photoshop 里走
//         【文件 > 脚本 > 浏览…】选本文件；它会读【素材】文件夹里的图，产出到【交付包】。
// ⚠️ Windows 用户不要双击本文件：.jsx 这个扩展名可能被「Windows 脚本宿主」接管，
//    双击会跑成另一套东西并报莫名其妙的错。一定要在 Photoshop 里「文件 > 脚本 > 浏览」。
//    （macOS 双击是安全的，会交给 Photoshop。）
//
// ⚠️ 只有下面这段需要改（路径可以写相对本文件的文件夹名，也可以写完整路径）：
//   素材目录  —— 原始素材放哪（只读，不会被改动）
//   交付目录  —— 成品放哪
//   客户/项目 —— 进文件名和清单
//   规格      —— 要做几个尺寸、什么格式
// ============================================================
`;
}

// 把六个步骤合成一份脚本：一次双击跑完全程，末尾弹窗给回执
function 合并脚本(意图) {
  const 体 = Object.keys(步骤生成).map((k) => "function 步骤_" + k + "(){\n" + 步骤生成[k](意图) + "\n}").join("\n");
  return 头(意图, "一次性（双击跑）") + 体 + `
// 存函数引用而不是名字字符串：ExtendScript 里字符串可调不动
var 步骤表 = [["S1", 步骤_S1], ["S2", 步骤_S2], ["S3", 步骤_S3], ["S4", 步骤_S4], ["S5", 步骤_S5], ["S6", 步骤_S6]];
var 成功数 = 0, 失败数 = 0;
for (var i = 0; i < 步骤表.length; i++) {
  try { 记("OK " + 步骤表[i][0] + " " + 步骤表[i][1]()); 成功数++; }
  catch (e) { 异常("- 步骤 " + 步骤表[i][0] + " 失败：" + e.message); 记("FAIL " + 步骤表[i][0] + " : " + e.message); 失败数++; }
}
var 报告 = "出图交付完成：" + 成功数 + " 步成功，" + 失败数 + " 步失败。" + String.fromCharCode(10) + "产物目录：" + 交付 + String.fromCharCode(10) + "详情见 交付清单.csv 与 异常.md";
记(报告);
// ⭐ 机器可读回执：脚本自己说失败，内核就必须看到失败（不许"文件在就算过"）
var 回执文件 = new File(交付 + "/_双击跑回执.txt");
回执文件.encoding = "UTF-8"; 回执文件.open("w");
回执文件.write("成功数=" + 成功数 + String.fromCharCode(10) + "失败数=" + 失败数 + String.fromCharCode(10));
回执文件.close();
标记("ALL", 失败数 === 0 ? "ok" : ("fail:" + 失败数));
alert(报告);
报告;`;
}

function 标准化意图(意图, 运行目录) {
  const i = { ...意图 };
  if (i.便携) {
    // 便携版：路径交给用户自己填（相对 .jsx 所在文件夹），内核不参与
    i.运行目录 = "";
    i.交付目录 = i.交付目录 || "交付包";
    i.素材目录 = i.素材目录 || "素材";
    return 补齐默认(i);
  }
  // ⭐ 一律绝对路径：.jsx 被双击运行时 cwd 不可预测，相对路径是隐形雷
  i.运行目录 = path.resolve(运行目录);
  i.交付目录 = path.resolve(i.交付目录 || path.join(运行目录, "交付包"));
  if (i.素材目录) i.素材目录 = path.resolve(i.素材目录);
  if (i.水印文件) i.水印文件 = path.resolve(i.水印文件);
  i.命名模板 = i.命名模板 || "{客户}_{项目}_{序号:03}{后缀}";
  i.规格 = i.规格 || [{ 名: "默认", 宽: 1080, 高: 1080, 格式: "jpg" }];
  i.分辨率 = i.分辨率 || 300;
  i.比例策略 = i.比例策略 || "留白";
  return 补齐默认(i);
}

function 补齐默认(i) {
  i.命名模板 = i.命名模板 || "{客户}_{项目}_{序号:03}{后缀}";
  i.规格 = i.规格 || [{ 名: "朋友圈", 宽: 1080, 高: 1080, 格式: "jpg" }];
  i.分辨率 = i.分辨率 || 300;
  i.比例策略 = i.比例策略 || "留白";
  i.基准宽 = i.规格[0].宽;
  i.基准高 = i.规格[0].高;
  return i;
}

function 由检查生成(步骤, 意图, 运行目录) {
  const c = [];
  const 相对 = (p) => {
    const r = path.relative(运行目录, p).split(path.sep).join("/");
    return r.startsWith("..") ? null : r;
  };
  // 交付目录可能在运行目录之外（用户指定到别处）→ 那就用绝对路径，校验层支持
  const 交付 = 相对(意图.交付目录) || path.resolve(意图.交付目录);
  void 交付;
  if (步骤.编号 === "S1") c.push({ 类型: "文件存在", 路径: 交付 + "/00-收料清单.csv" });
  if (步骤.编号 === "S2") c.push({ 类型: "glob至少", 目录: 交付 + "/工作区", 模式: "*", 至少: 1 });
  if (步骤.编号 === "S3") c.push({ 类型: "glob至少", 目录: 交付 + "/工作区/统一", 模式: "*.png", 至少: 1 });
  if (步骤.编号 === "S4") c.push({ 类型: "glob至少", 目录: 交付 + "/工作区/水印", 模式: "*.png", 至少: 1 });
  if (步骤.编号 === "S5") {
    for (const sp of 意图.规格) {
      c.push({ 类型: "glob至少", 目录: 交付 + "/" + sp.名, 模式: "*", 至少: 1 });
      // ⭐ 流水线承诺的「逐项核对宽高」必须真跑，不能只查文件在不在
      c.push({ 类型: "全部图片尺寸", 目录: 交付 + "/" + sp.名, 模式: "*", 宽: sp.宽, 高: sp.高 });
    }
    c.push({ 类型: "文件存在", 路径: 交付 + "/交付清单.csv" });
    if (意图.素材数) c.push({ 类型: "csv行数", 路径: 交付 + "/交付清单.csv", 数量: 意图.素材数 * 意图.规格.length });
    else c.push({ 类型: "glob至少", 目录: 交付 + "/" + 意图.规格[0].名, 模式: "*", 至少: 1 });
  }
  if (步骤.编号 === "S6") c.push({ 类型: "文件存在", 路径: 交付 + "/交付说明.md" });
  return c;
}

/* ---------------- 发射 ---------------- */

export function 发射(单元, ctx) {
  const 运行目录 = path.resolve(ctx.运行目录);
  const 脚本绝对 = path.join(运行目录, "脚本", 单元.脚本名);
  const 标记名 = 单元.标记名 || 单元.单元ID;
  const 标记 = path.join(运行目录, "_完成-" + 标记名 + ".txt");
  const 超时 = 单元.等待秒 || 180;
  const host = 找PS();

  if (模式 === "打印") return { 命令: ["node", "-e", "console.log('只打印不执行：" + 脚本绝对 + "')"], 超时秒: 5 };
  if (!host) return null;

  // Windows：官方 COM 通道（PS 没开会自动拉起；投递后由内核等标记）
  if (host.方式 === "com" && 模式 !== "open") {
    const ps = `$ErrorActionPreference='Stop'; $p = New-Object -ComObject Photoshop.Application; ` +
      `$t = $p.DoJavaScript([IO.File]::ReadAllText('${脚本绝对.replace(/'/g, "''")}')); ` +
      `if ($t) { [IO.File]::WriteAllText('${标记.replace(/'/g, "''")}', [string]$t, [Text.Encoding]::UTF8) }`;
    return { 命令: ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], 等待文件: 标记, 超时秒: 超时, 说明: "Windows COM 投递" };
  }

  // macOS：open -a 投递 odoc（本机唯一可用；AppleEvent 那条在本机永久 -1712）
  if (模式 === "applescript") {
    const as = `with timeout of ${超时} seconds
tell application "${APP}" to do javascript (read (POSIX file "${脚本绝对}") as «class utf8»)
end timeout`;
    return { 命令: ["osascript", "-e", as], 等待文件: 标记, 超时秒: 超时, 说明: "AppleScript do javascript（需自动化授权）" };
  }
  // -g：后台投递，绝不抢前台（用户可能正在别的窗口干活）
  return { 命令: ["open", "-g", "-a", APP, 脚本绝对], 等待文件: 标记, 超时秒: 超时, 说明: "open -g -a 投递 .jsx（后台，不抢焦点）" };
}

/* ---------------- 静态校验 ---------------- */

export function 静态校验(代码) {
  const 问题 = 括号配平(代码, "extendscript");
  if (!/^#target\s+photoshop/m.test(代码)) 问题.push("缺 #target photoshop");
  if (/\bUXP\b|require\(["']photoshop/.test(代码)) 问题.push("出现 UXP 写法，违反「只用 ExtendScript」");
  if (!/app\.displayDialogs\s*=\s*DialogModes\.NO/.test(代码)) 问题.push("未关模态对话框（批处理必须先关 DialogModes.NO）");
  // 助手函数必须真的定义过 —— 曾出现「调用 标记() 但定义没插进去」的静默失败，内核照样判过
  for (const 助手名 of ["记", "建", "清空", "写表", "渲染名", "异常", "标记", "真名"]) {
    const 被调用 = 代码.includes(助手名 + "(");
    const 已定义 = 代码.includes("function " + 助手名 + "(") || 代码.includes("function " + 助手名 + " (");
    if (被调用 && !已定义) 问题.push("调用了助手「" + 助手名 + "」但没有定义它");
  }
  if (!代码.includes("标记(")) 问题.push("缺完成标记调用（open -a 通道靠它判断跑完没有）");
  // 去掉注释再查（注释里举例说明这个坑，本身不是违规 —— 这里踩过一次误报）
  const 代码无注 = 代码.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  if (/new\s+(JPEGSaveOptions|TiffSaveOptions|PDFSaveOptions|ExportOptionsSaveForWeb)\s*\(\s*\{/.test(代码无注)) {
    问题.push("用对象字面量喂 ExtendScript 构造器（实测不生效，属性根本没设上）");
  }
  return { ok: 问题.length === 0, 问题 };
}

export default { id: "photoshop", 名称: "Adobe Photoshop", 探测, 编译, 发射, 静态校验 };
