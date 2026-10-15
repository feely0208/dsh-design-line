// 共享词法检查：括号配平 + 字符串/注释扫描。
// 三种语言共用一份实现 —— 免得每个适配器各写一遍、各带一个 bug。
// 关键细节：反斜杠转义要数「连续反斜杠的奇偶」，否则 "\\" 会被误判成未闭合字符串。

export function 扫描(代码, 语言) {
  const 规则 = {
    extendscript: { 行注释: ["//"], 字符串: ['"'], 转义: "\\" },
    autolisp: { 行注释: [";"], 字符串: ['"'], 转义: "\\" },
    maxscript: { 行注释: ["--"], 字符串: ['"'], 转义: "\\" },
  }[语言] || { 行注释: ["//"], 字符串: ['"'], 转义: "\\" };

  let 深度 = 0, 串 = false, 首个负行 = 0;
  const 行数组 = 代码.split("\n");
  for (let L = 0; L < 行数组.length; L++) {
    const 行 = 行数组[L];
    for (let i = 0; i < 行.length; i++) {
      const c = 行[i];
      if (!串) {
        if (规则.行注释.some((m) => 行.startsWith(m, i))) break;
      }
      if (串) {
        if (规则.字符串.includes(c)) {
          let 反斜杠 = 0;
          for (let k = i - 1; k >= 0 && 行[k] === "\\"; k--) 反斜杠++;
          if (反斜杠 % 2 === 0) 串 = false;
        }
        continue;
      }
      if (规则.字符串.includes(c)) { 串 = true; continue; }
      if (c === "(") 深度++;
      if (c === ")") {
        深度--;
        if (深度 < 0 && 首个负行 === 0) 首个负行 = L + 1;
      }
    }
  }
  return { 深度, 串未闭合: 串, 首个负行 };
}

export function 括号配平(代码, 语言) {
  const r = 扫描(代码, 语言);
  const 问题 = [];
  if (r.首个负行) 问题.push("第 " + r.首个负行 + " 行出现多余的右括号");
  if (r.深度 !== 0) 问题.push("圆括号不配平（差 " + r.深度 + "）");
  if (r.串未闭合) 问题.push("有字符串未闭合");
  return 问题;
}
