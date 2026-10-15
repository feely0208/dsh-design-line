#!/usr/bin/env node
// 深鲸工序 · CLI（插件带的可执行入口）
// 薄薄一层：把命令转给内核。内核是纯 node，无依赖，能单独跑 —— 插件只是它的「入口」。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const 包根 = join(dirname(fileURLToPath(import.meta.url)), '..');
const 内核 = join(包根, '内核', 'run.mjs');
const 帮助 = `深鲸工序 · 设计工序流水线

用法：
  dsh-design-line detect <软件>                        # photoshop | autocad | threedsmax —— 本机能不能跑
  dsh-design-line plan <流水线.json> --intent <意图.json> --out <运行目录>
                                                       # 先落盘可审阅（不执行）：生成脚本 + 计划 + 静态校验
  dsh-design-line run <运行目录> [--步骤 S1,S5] [--重跑]
                                                       # 执行已落盘的脚本（判据读产物，不看宿主自报）
  dsh-design-line status <运行目录>                    # 看每步状态
  dsh-design-line verify <运行目录>                    # 独立校验回执（客户视角，不信任产出方）
  dsh-design-line doc <流水线.json>                    # 渲染中文工序文档
  dsh-design-line 流水线                                # 列出内置流水线
  dsh-design-line 适配器                                # 列出内置适配器

约定：
  1. 永远是 plan 先落盘给人看，确认后再 run
  2. 跑完看 回执.md —— 那是能给客户的交付凭证
  3. 交付目录里的 _过程 痕迹与成品分开，别整包发给客户
`;

const [命令, ...参数] = process.argv.slice(2);

if (!命令 || 命令 === '--help' || 命令 === '-h' || 命令 === 'help') {
  process.stdout.write(帮助);
  process.exit(0);
}

const 直通 = ['detect', 'plan', 'run', 'status', 'doc', 'replay'];
if (直通.includes(命令)) {
  const r = spawnSync(process.execPath, [内核, 命令, ...参数], { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

if (命令 === 'verify') {
  const r = spawnSync(process.execPath, [join(包根, '回执模块', 'verify.mjs'), ...参数], { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

if (命令 === '流水线' || 命令 === 'list') {
  const fs = await import('node:fs');
  for (const f of fs.readdirSync(join(包根, '流水线'))) {
    const j = JSON.parse(fs.readFileSync(join(包根, '流水线', f), 'utf8'));
    console.log(`  ${f.padEnd(28)} ${j.标题}（${j.步骤.length} 步 · 替掉${j.替掉的工作量}）`);
  }
  process.exit(0);
}

if (命令 === '适配器') {
  const fs = await import('node:fs');
  for (const f of fs.readdirSync(join(包根, '适配器')).filter((f) => f.endsWith('.mjs') && !f.includes('替身') && f !== '词法.mjs')) {
    console.log('  ' + f.replace('.mjs', ''));
  }
  process.exit(0);
}

console.error(`未知命令：${命令}\n`);
process.stdout.write(帮助);
process.exit(2);
