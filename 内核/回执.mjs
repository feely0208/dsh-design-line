// 回执模块的定位适配：开发树里在 <工作区>/回执模块，插件包里在 <包根>/回执模块。
// 只做一件事：找一个存在的路径再转发 —— 免得两种布局各维护一份代码。
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const 本文件目录 = dirname(fileURLToPath(import.meta.url));
const 候选 = [
  join(本文件目录, '..', '回执模块', 'module.mjs'),        // 插件包布局
  join(本文件目录, '..', '..', '回执模块', 'module.mjs'),  // 开发树布局
];
const 命中 = 候选.find(existsSync);
if (!命中) throw new Error('找不到 回执模块/module.mjs，候选：' + 候选.join(' | '));

const m = await import(pathToFileURL(命中).href);
export const { 新建回执, 记步骤, 采产物, 收尾, 落盘, 读回执, 指纹, 渲染 } = m;
export const 回执模块路径 = 命中;
