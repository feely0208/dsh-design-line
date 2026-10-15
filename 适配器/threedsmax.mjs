// 适配器：3ds Max（MAXScript）
// 本机是 macOS —— 3ds Max 只有 Windows 版。产出 = 真 MAXScript + 一键 bat + 静态校验。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { 括号配平 } from "./词法.mjs";
import { 是Win, 找可执行 } from "../内核/平台.mjs";

export function 探测() {
  const 候选 = [];
  for (const 年 of ["2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018"]) {
    for (const 根 of [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"]]) {
      if (根) 候选.push(path.join(根, "Autodesk", "3ds Max " + 年, "3dsmaxbatch.exe"));
    }
  }
  const 命中 = 找可执行("3dsmaxbatch", 候选);
  if (命中) {
    return { 状态: "可用", 版本: path.basename(path.dirname(命中)), 宿主: 命中, 能力: ["MAXScript", "3dsmaxbatch", "批渲染"], 说明: "找到 3dsmaxbatch：" + 命中 };
  }
  return {
    状态: "缺宿主", 版本: null, 宿主: null,
    能力: ["MAXScript（假定）"],
    说明: (是Win ? "本机没找到 3dsmaxbatch.exe（3ds Max 2018.4 Update 起才有）" : "本机是 " + process.platform + " —— 3ds Max 只有 Windows 版")
      + "：脚本已生成、静态校验已跑，执行需在装了 3ds Max 的 Windows 机器上",
    在哪跑: "Windows（2018.4 Update+ 用 3dsmaxbatch.exe；2018.2/3 用 3dsmax.exe -batch；2017 及更老用 3dsmax.exe -q -silent -U MAXScript）",
  };
}

function ms(意图) {
  const 场景目录 = (意图.场景目录 || "").replace(/\\/g, "/");   // Windows 认正斜杠，省掉转义地狱
  const 输出目录 = (意图.交付目录 || "").replace(/\\/g, "/");
  const 宽 = (意图.分辨率 && 意图.分辨率.宽) || 3840;
  const 高 = (意图.分辨率 && 意图.分辨率.高) || 2160;
  const 格式 = (意图.输出格式 || "PNG").toUpperCase();
  const 重试 = 意图.重试次数 === undefined ? 1 : 意图.重试次数;
  const 贴图策略 = 意图.贴图策略 || "自动搜同名文件";
  return `-- ============================================================
-- 设计插件线 · 3ds Max 批渲染交付 · MAXScript
-- 生成时间：${new Date().toISOString()}
-- 出口（已核查的版本分档）：
--   2018.4 Update+ ：3dsmaxbatch.exe 批渲染.ms -dm on -listenerlog ...
--   2018.2 / 2018.3：3dsmax.exe -batch ...
--   2017 及更早    ：3dsmax.exe -q -silent -U MAXScript 批渲染.ms（MAXScript 大小写是硬要求）
-- 只依赖官方确证过的 API：render camera:/outputfile:/vfb:、loadMaxFile、getFiles、doesFileExist、
--   mergeMAXFile、readLine/openFile、quitMax #noPrompt。官方未确证的（units.SystemType、
--   missingfiles、sceneMaterials、渲染输出命名槽 #()）一律 try/catch 探测，探测不到就明说。
-- 路径一律用 / 分隔（Windows 也认），不玩反斜杠转义

global DL场景目录 = "${场景目录}"
global DL输出目录 = "${输出目录}"
global DL宽 = ${宽}
global DL高 = ${高}
global DL格式 = "${格式}"
global DL重试 = ${重试}
global DL贴图策略 = "${贴图策略}"
global DL换行 = bit.intAsChar 10
global DL状态文件 = DL输出目录 + "/状态.txt"

fn dlLog s = (
  makeDir DL输出目录 all:true
  f = openFile (DL输出目录 + "/运行日志.txt") mode:"a"
  if f != undefined do ( format "%" (s + DL换行) to:f; close f )
  try ( logsystem.logEntry s broadcast:true ) catch ( )
)
fn dl完成过 机位 = (
  if doesFileExist DL状态文件 then (
    local f = openFile DL状态文件 mode:"r"
    local hit = false
    while not eof f do ( local line = readLine f; if line == 机位 do hit = true )
    close f
    hit
  ) else false
)
fn dl标记完成 机位 = (
  makeDir DL输出目录 all:true
  local f = openFile DL状态文件 mode:"a"
  format "%" (机位 + DL换行) to:f
  close f
)
-- 单位：官方未确证 units.SystemType 存在，探测式读取
fn dl单位 = ( local u = "未知"; try ( u = units.SystemType as string ) catch ( ); u )
-- 版本：官方只保证 maxVersion()[1]，后面几项 2019.1/2019.2 才补齐
fn dl版本 = ( local v = "未知"; try ( v = (maxVersion())[1] as string ) catch ( ); v )
-- 丢贴图自查：不依赖 missingfiles（未查到官方确证）
fn dl丢贴图 = (
  local bad = #()
  try (
    for t in (getClassInstances Bitmaptexture) where (t.filename != undefined) do
      if not doesFileExist t.filename do append bad t.filename
  ) catch ( )
  bad
)
fn dl相机们 = ( for c in cameras where (superclassof c == camera) collect c )

-- ---------- S1 收场景与台账 ----------
fn dlS1 场景 = (
  local cams = dl相机们()
  local 丢 = dl丢贴图()
  local 表 = DL输出目录 + "/00-场景台账.csv"
  makeDir DL输出目录 all:true
  local 新文件 = not doesFileExist 表
  local f = openFile 表 mode:"a"
  if f != undefined do (
    if 新文件 do format "%" ("场景,Max版本,相机数,单位,渲染器,丢贴图数" + DL换行) to:f
    format "%" (场景 + "," + (dl版本()) + "," + (cams.count as string) + "," + (dl单位()) + "," + ((classof renderers.current) as string) + "," + (丢.count as string) + DL换行) to:f
    close f
  )
  dlLog ("S1 完成：" + 场景 + " 相机 " + (cams.count as string))
  cams
)

-- ---------- S2 场景规范检查与修正 ----------
fn dlS2 = (
  local 丢 = dl丢贴图()
  local 修 = 0
  if 丢.count > 0 and DL贴图策略 == "报错停下" then (
    dlLog ("S2 停在丢贴图：" + (丢.count as string) + " 个 —— 未做任何修改，选择权留给设计师")
    return false
  )
  try ( units.SystemType = #Millimeters ) catch ( dlLog "S2 单位 API 不可用，跳过（不猜）" )
  try (
    for t in (getClassInstances Bitmaptexture) where (t.filename != undefined) do (
      if not doesFileExist t.filename do (
        local 名 = filenameFromPath t.filename
        local 找到 = ""
        for d in (getDirectories (DL场景目录 + "/*")) do (
          local 试 = d + 名
          if doesFileExist 试 do 找到 = 试
        )
        if 找到 != "" then ( t.filename = 找到; 修 += 1 )
        else dlLog ("S2 丢贴图未找到同名，保持原样：" + 名)
      )
    )
  ) catch ( dlLog "S2 贴图遍历异常，已跳过（不阻断）" )
  dlLog ("S2 完成：重定位贴图 " + (修 as string) + " 个")
  true
)

-- ---------- S3 材质 / 灯光批量套用（全有或全无） ----------
fn dl场景材质数 = (
  local n = 0
  try ( n = sceneMaterials.count ) catch ( try ( n = (getClassInstances Material).count ) catch ( n = 0 ) )
  n
)
fn dlS3 材质库 = (
  if 材质库 == "" or not doesFileExist 材质库 then (
    dlLog "S3 跳过：材质库缺失 —— 绝不半套（要么整体套完，要么完全不动）"
    return true
  )
  local before = dl场景材质数()
  try (
    mergeMAXFile 材质库 #select quiet:true
    dlLog ("S3 合并材质库：" + 材质库 + "（原有材质 " + (before as string) + "）")
    true
  ) catch (
    dlLog ("S3 失败：" + (getCurrentException()))
    false
  )
)

-- ---------- S4 渲染预设 ----------
fn dlS4 = (
  renderWidth = DL宽
  renderHeight = DL高
  dlLog ("S4 完成：分辨率 " + (DL宽 as string) + "x" + (DL高 as string))
  true
)

-- ---------- S5 批量渲染（逐机位、失败重试、可续跑） ----------
-- 不依赖渲染输出命名槽 #()（官方未确证），路径在脚本里自己拼
fn dlS5 相机 = (
  local 图 = DL输出目录 + "/" + 相机.name + "_01." + (DL格式 as string)
  if dl完成过 相机.name do ( dlLog ("S5 跳过（已完成）：" + 相机.name); return true )
  local 试 = 0
  local 成 = false
  while 试 <= DL重试 and not 成 do (
    try (
      render camera:相机 outputfile:图 vfb:false
      if doesFileExist 图 and (getFileSize 图) > 20000 then 成 = true
      else dlLog ("S5 产物异常（空图/过小）：" + 相机.name)
    ) catch (
      dlLog ("S5 渲染异常：" + 相机.name + " | " + (getCurrentException()))
    )
    试 += 1
  )
  if 成 then ( dl标记完成 相机.name; dlLog ("S5 完成：" + 相机.name) )
  else dlLog ("S5 失败（已重试 " + (DL重试 as string) + " 次）：" + 相机.name)
  成
)

-- ---------- S6/S7 归档与清单 ----------
fn dlS7 行 = (
  makeDir DL输出目录 all:true
  local f = openFile (DL输出目录 + "/渲染清单.csv") mode:"w"
  format "%" ("机位,分辨率,格式,字节数,状态" + DL换行) to:f
  for r in 行 do format "%" (r + DL换行) to:f
  close f
  dlLog ("S7 完成：" + (行.count as string) + " 条")
)

-- ---------- 全流程 ----------
fn dlAll = (
  local 清单 = #()
  local 场景们 = getFiles (DL场景目录 + "/*.max")
  dlLog ("开始：" + (场景们.count as string) + " 个场景　版本=" + (dl版本()))
  for s in 场景们 do (
    if not (loadMaxFile s quiet:true) then ( dlLog ("场景打不开，跳过：" + s); continue )
    local cams = dlS1 s
    if (dlS2()) and (dlS3 "") then (
      dlS4()
      for c in cams do (
        local ok = dlS5 c
        local 图 = DL输出目录 + "/" + c.name + "_01." + (DL格式 as string)
        local sz = if doesFileExist 图 then (getFileSize 图) else 0
        清单 += (c.name + "," + (DL宽 as string) + "x" + (DL高 as string) + "," + DL格式 + "," + (sz as string) + "," + (if ok then "成功" else "失败"))
      )
    )
  )
  dlS7 清单
  dlLog "全部完成"
)
dlAll()
quitMax #noPrompt
`;
}

function bat(意图) {
  return `@echo off
chcp 65001 >nul
rem 设计插件线 · 3ds Max 批渲染 · 一键跑（双击）
rem 版本分档（已核查）：
rem   2018.4 Update+  3dsmaxbatch.exe
rem   2018.2 / 2018.3 3dsmax.exe -batch
rem   2017 及更早      3dsmax.exe -q -silent -U MAXScript（MAXScript 大小写是硬要求）
set "DIR=%~dp0"
where 3dsmaxbatch.exe >nul 2>nul
if %errorlevel%==0 (
  echo [分档1] 3dsmaxbatch.exe（2018.4 Update+）
  "3dsmaxbatch.exe" "%DIR%批渲染.ms" -dm on -listenerlog "%DIR%listener.log" -v 3
  goto done
)
where 3dsmax.exe >nul 2>nul
if %errorlevel%==0 (
  echo [分档2/3] 3dsmax.exe -U MAXScript（2017 及更早；2018.2/3 可改 -batch）
  "3dsmax.exe" -q -silent -U MAXScript "%DIR%批渲染.ms"
  goto done
)
echo 没找到 3dsmaxbatch.exe / 3dsmax.exe —— 请检查 3ds Max 安装路径或改成本机实际路径
:done
echo 完成。产物在输出目录，清单：渲染清单.csv
pause
`;
}

// 便携版 bat：一切相对于本文件夹
function bat便携(意图) {
  return `@echo off
chcp 65001 >nul
rem ============================================================
rem  深鲸工序 · 3ds Max 批渲染交付（双击就跑版）
rem  用法：把 .max 场景放进本文件夹下的【场景】里，双击本文件。
rem  产物在【渲染】里（每个相机一张图 + 清单）。
rem ============================================================
cd /d "%~dp0"
title 深鲸工序 · 3ds Max 批渲染

if not exist "场景" mkdir "场景"
if not exist "渲染" mkdir "渲染"

set /a 计数=0
for %%F in ("场景\\*.max") do set /a 计数+=1
if %计数%==0 (
  echo [停止] 场景文件夹里没有 .max 文件。
  echo         请把场景放进： "%~dp0场景"
  pause
  exit /b 1
)
echo 找到 %计数% 个场景，开始渲染…
if %计数% GTR 20 (
  echo.
  echo 场景较多（%计数% 个）。渲染很慢，确认继续？输入 Y 回车继续，其它键退出：
  set /p 确认=
  if /i not "%确认%"=="Y" exit /b 0
)

set "MAXBATCH="
for /f "delims=" %%P in ('where 3dsmaxbatch.exe 2^>nul') do set "MAXBATCH=%%P"
if defined MAXBATCH (
  echo [分档1] 3dsmaxbatch.exe（3ds Max 2018.4 Update 及以上）
  "%MAXBATCH%" "%~dp0批渲染.ms" -dm on -listenerlog "%~dp0listener.log" -v 3
) else (
  echo [分档2] 未找到 3dsmaxbatch，回退 3dsmax.exe -q -silent -U MAXScript（2017 及更早）
  echo          如果是 2018.2/2018.3，请把 -U MAXScript 换成 -batch
  echo          ⚠️ 这条回退会打开 3ds Max 窗口（-q -silent 只压掉启动画面）；渲染期间别关它
  3dsmax.exe -q -silent -U MAXScript "%~dp0批渲染.ms"
)
echo.
echo 完成。产物在： "%~dp0渲染"
echo 回传：把【渲染】整个文件夹打包发回即可（图 + 三个 csv + 运行日志）。
pause
`;
}

export function 编译(ctx) {
  const 便携 = !!ctx.意图.便携;
  const 意图 = 便携
    ? { ...ctx.意图, 交付目录: ctx.意图.交付目录 || "渲染", 场景目录: ctx.意图.场景目录 || "场景" }
    : { ...ctx.意图, 交付目录: ctx.意图.交付目录 || path.join(path.resolve(ctx.运行目录), "渲染") };
  const 单元 = [{
    单元ID: "MAX-ALL",
    覆盖步骤: ctx.流水线.步骤.map((s) => s.编号),
    脚本名: "批渲染.ms",
    语言: "maxscript",
    代码: ms(意图),
    检查: [
      { 类型: "文件存在", 路径: "脚本/批渲染.ms" },
      { 类型: "glob至少", 目录: "渲染", 模式: "**/*.png", 至少: 1 },
    ],
    回退: ["单机位失败重试后跳过，继续下一机位", "进程崩溃后靠 状态.txt 续跑"],
    主要产物: path.join(意图.交付目录, "渲染清单.csv"),
  }];
  单元[0].附属文件 = [{ 名: "批渲染.bat", 内容: 便携 ? bat便携(意图) : bat(意图), 行尾: "crlf" }];
  return 单元;
}

export function 发射(单元, ctx) {
  const 脚本目录 = path.resolve(ctx.运行目录, "脚本");
  if (是Win && fs.existsSync(path.join(脚本目录, "批渲染.bat"))) {
    return {
      命令: ["cmd", "/c", "批渲染.bat"],
      工作目录: 脚本目录,
      等待文件: path.join(脚本目录, "渲染", "渲染清单.csv"),
      超时秒: 单元.等待秒 || 7200,
      说明: "Windows：跑批渲染 bat（3dsmaxbatch / -U MAXScript）",
    };
  }
  return null;
}

export function 静态校验(代码) {
  const 问题 = 括号配平(代码, "maxscript");
  if (!/render\s+camera:/.test(代码)) 问题.push("缺核心渲染调用 render camera:");
  if (!/vfb:false/.test(代码)) 问题.push("vfb 未关（批处理必须 vfb:false，否则弹窗卡死）");
  if (!/quitMax\s+#noPrompt/.test(代码)) 问题.push("缺 quitMax #noPrompt（官方要求的退出方式）");
  if (!/状态\.txt/.test(代码)) 问题.push("缺续跑状态文件（崩溃后无法续跑）");
  if (!/3dsmaxbatch/.test(代码)) 问题.push("缺 3dsmaxbatch（2018.4+）分档说明");
  if (!/-U MAXScript/.test(代码)) 问题.push("缺 -U MAXScript 老版本回退（大小写必须一致）");
  if (!/fn dlAll/.test(代码)) 问题.push("缺全流程函数 dlAll");
  if (!/try\s*\(/.test(代码)) 问题.push("缺 try/catch 保护（单机位失败不能炸整批）");
  if (/rendOutputFilename\s*=.*#/.test(代码)) 问题.push("依赖渲染输出命名槽 #()（官方未确证写法）");
  if (/missingfiles\s*\(/.test(代码)) 问题.push("依赖 missingfiles（官方未确证）—— 应自己遍历 Bitmaptexture 自查");
  if (/render\s+camera:[^\n]*frame:/.test(代码)) 问题.push("使用 render frame: 参数（官方未确证）—— 应逐帧 sliderTime 循环");
  return { ok: 问题.length === 0, 问题 };
}

export default { id: "threedsmax", 名称: "3ds Max", 探测, 编译, 发射, 静态校验 };
