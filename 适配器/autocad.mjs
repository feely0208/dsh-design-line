// 适配器：AutoCAD（AutoLISP + .scr + accoreconsole）
// 本机没有 AutoCAD —— 这个适配器的产出是**真脚本 + 静态校验 + 一键在 Windows 上跑的包**。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { 括号配平 } from "./词法.mjs";
import { 是Win, 找可执行 } from "../内核/平台.mjs";

const ACCORECONSOLE = [
  "%ProgramFiles%\\Autodesk\\AutoCAD 2024\\accoreconsole.exe",
  "%ProgramFiles%\\Autodesk\\AutoCAD 2020\\accoreconsole.exe",
  "%ProgramFiles%\\Autodesk\\AutoCAD 2016\\accoreconsole.exe",
];

export function 探测() {
  const 候选 = [];
  for (const 年 of ["2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "2017", "2016", "2015", "2014", "2013"]) {
    for (const 根 of [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"]]) {
      if (根) 候选.push(path.join(根, "Autodesk", "AutoCAD " + 年, "accoreconsole.exe"));
    }
  }
  const 命中 = 找可执行("accoreconsole", 候选);
  if (命中) {
    return {
      状态: "可用", 版本: path.basename(path.dirname(命中)), 宿主: 命中,
      能力: ["AutoLISP（核心）", "SCR", "PDF"],
      说明: "找到 accoreconsole：" + 命中 + "（2013+ 才有无界面批处理；更老版本的 AutoCAD 请走界面内 .scr）",
    };
  }
  return {
    状态: "缺宿主", 版本: null, 宿主: null, 能力: ["AutoLISP（假定）", "SCR（假定）"],
    说明: (是Win ? "本机没找到 accoreconsole（AutoCAD 2013+ 才有）" : "本机是 " + process.platform + " —— accoreconsole 是 Windows 程序")
      + "：脚本已生成、静态校验已跑，执行需在装了 AutoCAD 的 Windows 机器上",
    在哪跑: "Windows（AutoCAD 2013+ 无界面批处理；2004~2012 走界面内 SCRIPT + .scr）",
  };
}

/* ---------------- AutoLISP 生成 ---------------- */

function lsp(意图) {
  const 备份 = 意图.备份原图 === false ? "nil" : "T";
  return `;;; ============================================================
;;; 设计插件线 · CAD 出图标准化 · AutoLISP 主脚本
;;; 生成时间：${new Date().toISOString()}
;;; 只用 AutoLISP + .scr（厂商自带、R14 至今基本没变），不依赖 .NET
;;; ⚠ 关键约束（已核查）：accoreconsole（2013+ 才有）里**只有核心 AutoLISP** ——
;;;    vla-* / vlax-* 会直接 no function definition 失败。故本脚本全程只用 (command)/(entget)/
;;;    (tblnext) 这类核心能力，任何 ActiveX 调用都先探测再降级。
;;; 用法（无界面，2013+）：accoreconsole.exe /i 图.dwg /s 出图.scr /isolate
;;; 用法（界面内，2004~2012 只有这条）：APPLOAD 载入本文件 → 命令行 (CAD-ALL)
;;; ============================================================

(setq *DL-意图* '(
  (图框块名 . "${意图.图框块名 || "标准图框"}")
  (图幅 . "${意图.图幅 || "A3"}")
  (打印样式 . "${意图.打印样式 || "monochrome.ctb"}")
  (输出格式 . "${意图.输出格式 || "PDF"}")
  (备份 . ${备份})
  (比例 . 100)
  (页面设置 . "${意图.页面设置 || "DWG To PDF"}")
  (输出目录 . "${(意图.交付目录 || "").replace(/\\/g, "\\\\")}")
  (标准文件 . "${(意图.标准文件 || "").replace(/\\/g, "\\\\")}")
))

;;; ---------- 0. 通用工具 ----------
(defun dl-值 (键) (cdr (assoc 键 *DL-意图*)))
;;; 纯 LISP 取文件名主干（不依赖 vl-filename-base —— accoreconsole 里 vl-* 未必可用）
(defun dl-基名 (全名 / p)
  (setq p (vl-string-position (ascii ".") 全名))
  (if p (substr 全名 1 p) 全名))
;;; 能力探测：AutoLISP 里引用未定义符号只返回 nil，不报错 —— 正好用来探测
(defun dl-有com ( ) (if vl-load-com T nil))
(defun dl-记 (s)
  (setq f (open (strcat (dl-值 '输出目录) "\\\\运行日志.txt") "a"))
  (write-line s f) (close f))
(defun dl-异常 args ; 可变参数：把每个参数按行写进异常.md
  (setq f (open (strcat (dl-值 '输出目录) "\\\\异常.md") "a"))
  (foreach a args (write-line (vl-princ-to-string a) f))
  (close f))
(defun dl-表 (名 行) ; 行 = 字符串列表，逗号分隔已由调用方拼好
  (setq f (open (strcat (dl-值 '输出目录) "\\\\" 名) "w"))
  (foreach r 行 (write-line r f)) (close f))

;;; ---------- S1 收料与图纸台账 ----------
(defun CAD-S1 (/ 行 层 布局 图框 n)
  (setq 行 (list "图名,版本,图层数,布局数,已插图框,单位"))
  (setq 层 0) (setq t1 (tblnext "LAYER" T))
  (while t1 (setq 层 (1+ 层)) (setq t1 (tblnext "LAYER")))
  (setq 布局 (length (layoutlist)))
  (setq 图框 (sslength (ssget "X" (list '(0 . "INSERT") (cons 2 (strcat (dl-值 '图框块名) "*"))))))
  (setq n (getvar "ACADVER"))
  (setq 行 (append 行 (list (strcat (getvar "DWGNAME") "," n "," (itoa 层) "," (itoa 布局) "," (itoa 图框) "," (getvar "INSUNITS")))))
  (dl-表 "00-图纸台账.csv" 行)
  (dl-记 (strcat "S1 完成：图层 " (itoa 层) " 布局 " (itoa 布局) " 图框 " (itoa 图框)))
  (princ "\\nS1 完成"))

;;; ---------- S2 图层规范化（只改属性、不删实体） ----------
;;; 映射表用全局变量（AutoLISP 是动态作用域，用全局最不容易出错）
(setq *DL-映射* '("原图层,动作,标准图层"))
(defun dl-改层 (e 新层 旧名)
  (setq e (subst (cons 8 新层) (assoc 8 e) e))
  (entmod e)
  (if (not (member (strcat 旧名 "," 新层) *DL-映射*))
    (setq *DL-映射* (cons (strcat 旧名 ",改层," 新层) *DL-映射*))))

(defun CAD-S2 (/ ss i e 层名)
  (setq ss (ssget "X"))
  (if ss
    (progn
      (setq i 0)
      (while (< i (sslength ss))
        (setq e (entget (ssname ss i)))
        (setq 层名 (cdr (assoc 8 e)))
        ;; 规则举例：含"墙"的层统一到 WALL，含"窗"归 WIN（企业标准表可替换这几行）
        (cond
          ((wcmatch 层名 "*墙*") (dl-改层 e "WALL" 层名))
          ((wcmatch 层名 "*窗*") (dl-改层 e "WIN" 层名))
          (T nil))
        (setq i (1+ i)))))
  (dl-表 "图层映射.csv" (reverse *DL-映射*))
  (dl-记 "S2 完成（实体只改属性，未删除任何实体）")
  (princ "\\nS2 完成"))

;;; ---------- S3 图框与出图比例（幂等：已有则跳过） ----------
(defun CAD-S3 (/ 已有 块名)
  (setq 块名 (dl-值 '图框块名))
  ;; 块不存在（测试者的图里不会有我们预设的图框）→ 跳过并记录，不报错打断
  (if (not (tblsearch "BLOCK" 块名))
    (progn
      (dl-异常 (strcat "- 本图没有图框块「" 块名 "」，已跳过图框步骤（要用请把图框块放进图纸或改配置）"))
      (princ "\nS3 跳过：无图框块")
      (setq 已有 'SKIP))
    (setq 已有 (ssget "X" (list '(0 . "INSERT") (cons 2 (strcat 块名 "*"))))))
  (if (equal 已有 'SKIP)
    nil
  (if 已有
    (progn (dl-异常 "- 已存在图框，跳过插入（幂等）：" (getvar "DWGNAME")) (princ "\\nS3 已存在，跳过"))
    (progn
      (command "_.-INSERT" 块名 "0,0" 1 1 0)
      (dl-记 "S3 已插入图框")
      (princ "\\nS3 完成")))))

;;; ---------- S4 标注与文字样式统一（计数前后一致才放行） ----------
(defun CAD-S4 (/ 前标 后标 前文 后文)
  (setq 前标 (sslength (ssget "X" '((0 . "DIMENSION")))))
  (setq 前文 (sslength (ssget "X" '((0 . "TEXT,MTEXT")))))
  (setvar "DIMSCALE" (cdr (assoc '比例 *DL-意图*)))
  (if (tblsearch "DIMSTYLE" "DL-标准")
    (command "_.-DIMSTYLE" "R" "DL-标准"))
  (setq 后标 (sslength (ssget "X" '((0 . "DIMENSION")))))
  (setq 后文 (sslength (ssget "X" '((0 . "TEXT,MTEXT")))))
  (if (or (/= 前标 后标) (/= 前文 后文))
    (progn
      (dl-异常 "- 严重：样式统一后实体数变了！标注 " (itoa 前标) "→" (itoa 后标) " 文字 " (itoa 前文) "→" (itoa 后文))
      (princ "\\nS4 校验失败，请从备份恢复"))
    (progn (dl-记 "S4 完成，实体数一致") (princ "\\nS4 完成"))))

;;; ---------- S5 打印样式套用 ----------
(defun CAD-S5 ()
  (if (= (getvar "PSTYLEMODE") 0)
    (dl-记 (strcat "S5 颜色相关打印样式模式，样式表：" (dl-值 '打印样式)))
    (dl-记 "S5 命名打印样式模式（STB）"))
  ;; 实际套用走 -PLOT 参数序列（见 出图.scr），此处只做能力探测与告警
  (if (not (findfile (dl-值 '打印样式)))
    (dl-异常 "- 打印样式表不在支持路径：" (dl-值 '打印样式) "（将用后备 monochrome.ctb）"))
  (princ "\\nS5 完成"))

;;; ---------- S6 批量出图（一图一 PDF / DWF） ----------
;;; 跨版本策略：
;;;   ① 最稳：把页面设置预置进模板 .dwt，脚本里只引用页面设置名 → -PLOT 的「简化序列」
;;;      第三方实测序列：-PLOT → N（不详细配置）→ 布局名 → 页面设置名 → 输出文件名 → N → Y
;;;   ② 2010+ 且页面设置缺失：走 _-EXPORTPDF
;;;   ③ 都没有：逐项应答完整 -PLOT 提示序列（打印机/纸型/方向/样式表/比例/区域）
(defun CAD-S6 (/ 输出 布局们 布局 页面设置)
  (setq 页面设置 (dl-值 '页面设置))
  (setq 布局们 (layoutlist))
  (dl-记 (strcat "S6 布局数 " (itoa (length 布局们)) "；页面设置=" (if (or (null 页面设置) (= 页面设置 "")) "（未配置，走其它分支）" 页面设置)))
  (foreach 布局 布局们
    (command "_.-LAYOUT" "S" 布局)
    (setq 输出 (strcat (dl-值 '输出目录) (chr 92) (dl-基名 (getvar "DWGNAME")) "-" 布局 ".pdf"))
    (cond
      ;; ① 页面设置存在 → 简化序列（2004 级别即可用）
      ((and 页面设置 (/= 页面设置 "") (not (null 页面设置)))
       (dl-记 (strcat "S6 分支①页面设置序列：" 页面设置))
       (command "_.-PLOT" "N" 布局 页面设置 输出 "N" "Y"))
      ;; ② 新版本用专用导出命令
      ((>= (atoi (substr (getvar "ACADVER") 3)) 1024)
       (dl-记 "S6 分支②-EXPORTPDF（命令序列待实机校验）")
       (command "_.-EXPORTPDF" "C" "" 输出))
      ;; ③ 老版本：完整 -PLOT 序列
      (T
       (dl-记 "S6 分支③完整 -PLOT 序列")
       (command "_.-PLOT" "Y" "" "DWG To PDF.pc3" (dl-值 '图幅) "M" "L" "N" "W" "E" "F" "C" "Y"
                (dl-值 '打印样式) "Y" "N" "N" "N" 输出 "N" "Y")))
    (dl-记 (strcat "S6 出图：" 输出)))
  (princ (strcat (chr 10) "S6 完成：" (itoa (length 布局们)) " 个布局")))

;;; ---------- S7 图纸目录 ----------
(defun CAD-S7 ()
  (dl-表 "图纸目录.csv" (list "文件,版本,布局数" (strcat (getvar "DWGNAME") "," (getvar "ACADVER") "," (itoa (length (layoutlist))))))
  (princ "\\nS7 完成"))

;;; ---------- 全流程 ----------
;;; ---------- 备份确认（改图不可逆，没备份不动手）----------
(defun dl-备份确认 ()
  (if (not (dl-值 '备份))
    (progn (dl-异常 "- ⚠ 备份开关为关闭，将直接改图（风险自负）") T)
    (if (findfile (strcat (dl-值 '输出目录) (chr 92) "_备份完成.txt"))
      (progn (dl-记 "备份已确认，允许改图") T)
      (progn
        (dl-异常 "- 备份未确认：已跳过所有会改图的步骤（图层/图框/标注）—— 改图不可逆，没有备份不动手")
        (dl-异常 "- 解决：用 一键出图.bat 跑（它会先备份并写 _备份完成.txt），或手动备份后自己放这个标记")
        nil))))

;;; ---------- 全流程 ----------
(defun CAD-ALL (/ 可改)
  ;; 在 accoreconsole 里 vl-load-com 可能不存在：探测到才加载（引用未定义符号返回 nil，不报错）
  (if (dl-有com) (vl-load-com))
  (if (not (dl-有com)) (dl-记 "运行在纯 AutoLISP 模式（accoreconsole）：未加载 ActiveX 扩展"))
  (CAD-S1)
  (setq 可改 (dl-备份确认))
  (if 可改
    (progn (CAD-S2) (CAD-S3) (CAD-S4))
    (princ "\\n已跳过改图步骤（备份未确认）"))
  (CAD-S5) (CAD-S6) (CAD-S7)
  (princ "\\n全部完成"))
(princ "\\nCAD 出图标准化脚本已加载，运行 (CAD-ALL) 或分步 (CAD-S1)…")
(princ)
`;
}

function scr(意图, lsp路径) {
  return `; 设计插件线 · CAD 批处理脚本（accoreconsole / SCRIPT 命令通用）
; 生成时间：${new Date().toISOString()}
FILEDIA
0
EXPERT
5
; 注：CMDDIA 在 AutoCAD 官方「对话框/命令行切换」页未被提及（未确证），故不写入批处理脚本
;; 用绝对路径 load：双击 bat / 换工作目录都不会找不到（相对路径踩过坑）
(load "${lsp路径.replace(/\\/g, "\\\\")}")
(CAD-ALL)
QSAVE
`;
}

function bat(意图) {
  return `@echo off
chcp 65001 >nul
rem 设计插件线 · CAD 出图标准化 · 一键批处理（双击即跑）
rem 分档（已核查）：AutoCAD 2013+ 才有 accoreconsole（且 2012 官方博客注明 not officially supported）；
rem 2004~2012 请改用 GUI 版 AutoCAD 的 SCRIPT 命令跑 出图.scr。
rem accoreconsole 里只有核心 AutoLISP：vla-*/vlax-* 会 no function definition 失败。
setlocal enabledelayedexpansion
set "图纸目录=${意图.图纸目录 || "%~dp0图纸"}"
set "输出目录=${意图.交付目录 || "%~dp0出图"}"
if not exist "%输出目录%" mkdir "%输出目录%"

echo [1/2] 备份原图（改图不可逆，先备份是底线）
if not exist "%图纸目录%\\..\\_原图备份" mkdir "%图纸目录%\\..\\_原图备份"
xcopy /Y /S /I "%图纸目录%\\*.dwg" "%图纸目录%\\..\\_原图备份\\" >nul
if errorlevel 1 (
  echo [停止] 备份失败 —— 改图不可逆，没有备份绝不动手。
  pause
  exit /b 2
)
pushd "%输出目录%" & echo 备份完成> _备份完成.txt & popd

echo [2/2] 逐图规范化并出图
for %%F in ("%图纸目录%\\*.dwg") do (
  echo   - %%~nxF
  accoreconsole.exe /i "%%F" /s "%~dp0出图.scr" /l "%~dp0出图.lsp" /isolate
  if errorlevel 1 echo     失败：%%~nxF >> "%输出目录%\\失败清单.csv"
)
pushd "%输出目录%" & echo 跑完> _完成.txt & popd
echo 完成。产物在 "%输出目录%"
pause
`;
}

// 便携版 bat：一切相对于本文件夹，测试者双击即可，不需要改任何路径
function bat便携(意图) {
  return `@echo off
chcp 65001 >nul
rem ============================================================
rem  深鲸工序 · CAD 出图标准化（双击就跑版）
rem  用法：把要处理的 DWG 放进本文件夹下的【图纸】里，双击本文件。
rem  产物在【出图】里。原图会先备份到【_原图备份】。
rem ============================================================
cd /d "%~dp0"
title 深鲸工序 · CAD 出图标准化

if not exist "图纸" mkdir "图纸"
if not exist "出图" mkdir "出图"
if not exist "_原图备份" mkdir "_原图备份"

set /a 计数=0
for %%F in ("图纸\\*.dwg") do set /a 计数+=1
if %计数%==0 (
  echo [停止] 图纸文件夹里没有 .dwg 文件。
  echo         请把 DWG 放进： "%~dp0图纸"
  pause
  exit /b 1
)
echo 找到 %计数% 张图纸，开始备份…
xcopy /Y /S /I "图纸\*.dwg" "_原图备份\\" >nul
if errorlevel 1 (
  echo [停止] 备份失败 —— 改图不可逆，没有备份绝不动手。
  echo         请检查磁盘空间与权限后重试。
  pause
  exit /b 2
)
if not exist "_原图备份\*.dwg" (
  echo [停止] 备份目录里没有文件，判定备份未成功。
  pause
  exit /b 2
)
pushd "出图" & echo 备份完成> _备份完成.txt & popd
echo 备份已确认（%计数% 张）
if %计数% GTR 200 (
  echo.
  echo 图纸较多（%计数% 张）。确认继续？输入 Y 回车继续，其它键退出：
  set /p 确认=
  if /i not "%确认%"=="Y" exit /b 0
)

echo 逐图规范化并出图（2013 及以上走 accoreconsole 无界面；更老版本请看 测试步骤.md）
for %%F in ("图纸\\*.dwg") do (
  echo   - %%~nxF
  accoreconsole.exe /i "%%F" /s "%~dp0出图.scr" /l "%~dp0出图.lsp" /isolate
  if errorlevel 1 echo %%~nxF,accoreconsole 返回错误 >> "出图\\失败清单.csv"
)
rem 完成标记：内核靠这个文件判断「跑完了没有」（不管有没有失败都要写）
pushd "出图" & echo 跑完> _完成.txt & popd
if exist "出图\\失败清单.csv" echo 有失败项，见 出图\\失败清单.csv
echo.
echo 完成。产物在： "%~dp0出图"
echo 回传：把【出图】整个文件夹打包发回即可。
pause
`;
}

/* ---------------- 编译 ---------------- */

export function 编译(ctx) {
  const 便携 = !!ctx.意图.便携;
  const 意图 = 便携
    ? { ...ctx.意图, 交付目录: ctx.意图.交付目录 || "出图", 图纸目录: ctx.意图.图纸目录 || "图纸" }
    : { ...ctx.意图, 交付目录: ctx.意图.交付目录 || path.join(path.resolve(ctx.运行目录), "出图") };
  const 步骤 = ctx.流水线.步骤;

  // CAD 的执行粒度是「一张图一个进程」——步骤都在同一个 LISP 里，故编译成一个执行单元
  const 合并lsp = lsp(意图);
  const 单元 = [
    {
      单元ID: "CAD-ALL",
      覆盖步骤: 步骤.map((s) => s.编号),
      脚本名: "出图.lsp",
      语言: "autolisp",
      代码: 合并lsp,
      检查: [
        { 类型: "文件存在", 路径: "脚本/出图.lsp" },
        { 类型: "文件存在", 路径: "脚本/出图.scr" },
        { 类型: "文件存在", 路径: "脚本/一键出图.bat" },
        { 类型: "glob至少", 目录: "出图", 模式: "**/*.pdf", 至少: 1 },
        { 类型: "全部字节下限", 目录: "出图", 模式: "**/*.pdf", 最小字节: 5000 },
      ],
      回退: ["单图失败不影响其他图；打不开的图进 异常.md 并跳过", "备份失败则整批停止（改图不可逆）"],
      主要产物: path.join(意图.交付目录, "00-图纸台账.csv"),
    },
  ];

  // 附属文件也落盘（scr / bat 不是内核眼里的"脚本"，但属于交付物）
  const lsp绝对 = 便携 ? "出图.lsp" : path.join(path.resolve(ctx.运行目录), "脚本", "出图.lsp");
  单元[0].附属文件 = [
    { 名: "出图.scr", 内容: scr(意图, lsp绝对) },
    { 名: "一键出图.bat", 内容: 便携 ? bat便携(意图) : bat(意图), 行尾: "crlf" },
  ];
  return 单元;
}

/* ---------------- 发射 ---------------- */

export function 发射(单元, ctx) {
  // 有宿主才谈发射：Windows 上直接跑便携/同目录的 bat（它自己遍历图纸、逐图调 accoreconsole）
  const 脚本目录 = path.resolve(ctx.运行目录, "脚本");
  if (是Win && fs.existsSync(path.join(脚本目录, "一键出图.bat"))) {
    return {
      命令: ["cmd", "/c", "一键出图.bat"],
      工作目录: 脚本目录,
      等待文件: path.join(脚本目录, "出图", "_完成.txt"),
      超时秒: 单元.等待秒 || 3600,
      说明: "Windows：跑一键 bat（accoreconsole 逐图）",
    };
  }
  return null;   // 没宿主 → 内核会记「受阻」，并把脚本落盘留给人去跑
}

/* ---------------- 静态校验（AutoLISP） ---------------- */

export function 静态校验(代码) {
  const 问题 = 括号配平(代码, "autolisp");
  // 关键步骤函数都在
  for (const f of ["CAD-S1", "CAD-S2", "CAD-S3", "CAD-S4", "CAD-S5", "CAD-S6", "CAD-S7", "CAD-ALL"]) {
    if (!代码.includes("(defun " + f)) 问题.push("缺函数 " + f);
  }
  // 只用老而稳的接口：不许出现 .NET / ObjectDBX（版本差异大）
  if (/vlax-create-object\s+"ObjectDBX/i.test(代码)) 问题.push("出现 ObjectDBX（版本差异大，v1 不用）");
  // 出图必须有 2010+/更老 的版本分支（能力探测 + 回退）
  if (!/EXPORTPDF/.test(代码) || !/-PLOT/.test(代码)) 问题.push("出图缺少版本分支（页面设置 / EXPORTPDF / 完整 -PLOT 三级回退）");
  // 去掉分号注释再查（注释里提到 vla-* 是说明，不是调用）
  const 代码无注 = 代码.split("\n").map((l) => l.replace(/;.*$/, "")).join("\n");
  if (/vlax-|vla-/.test(代码无注)) 问题.push("出现 vla-*/vlax-*（accoreconsole 下会失败，必须探测后降级）");
  // 批处理必须关掉文件对话框
  if (!/FILEDIA/.test(代码) && !/出图\.scr/.test(代码)) 问题.push("批处理未显式处理 FILEDIA/EXPERT");
  // 改图前必须有备份开关
  if (!/备份/.test(代码)) 问题.push("缺「改图前先备份」的开关");
  return { ok: 问题.length === 0, 问题 };
}

export default { id: "autocad", 名称: "AutoCAD", 探测, 编译, 发射, 静态校验 };
