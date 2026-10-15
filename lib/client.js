/**
 * 深鲸工序 —— 客户端半边（面板 UI）
 *
 * 挂在两个槽位上（照 dsh-shell-canvas 的写法）：
 *   · `sidebar.panellist`（list 槽）→ 侧栏多一个「深鲸工序」图标
 *   · `main`（keyed 槽，key='design-line'）→ 中间那栏渲染本面板
 *
 * 数据全走宿主半边的 HTTP 出口 `/dsh-design-line/api`（同源，无需握手）：
 *   status / pipelines / ls / plan / run / state / verify / open
 *
 * 设计取向：概念少而清楚 —— 一屏之内把「能不能跑 → 跑哪条 → 填什么 → 先看再做 → 结果与凭证」串完。
 */
window.__ModuleLoader__.load({
  id: '@deepwhale-cn/dsh-design-line',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    let react = require('react');
    const h = react.createElement;

    const API = '/dsh-design-line/api';
    const SLOT_ICON = 'sidebar.panellist';
    const SLOT_MAIN = 'main';
    const PANEL_ID = 'design-line';

    /* ── 取数据 ── */
    async function 取(路, 选项) {
      const res = await fetch(API + 路, 选项);
      return res.json();
    }
    const 发 = (路, 体) => 取(路, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(体) });

    /* ── 样式 ──
       教训：第一次我猜了变量名（--dsh-text-primary），宿主里根本没有，于是走了兜底的浅色字，
       在浅色主题下变成白底白字。现在两条原则：
         ① 文字一律 color:'inherit' —— 继承宿主主题，不猜变量名；
         ② 底色/边框用宿主真实变量（--dsw-alias-*），兜底用中性灰（深浅两色都能看）。 */
    const V = {
      卡底: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))',
      浅底: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.14))',
      边: 'var(--dsw-alias-border-l1, rgba(127,127,127,0.28))',
      主: 'var(--dsw-alias-brand-primary, #3F9FF0)',
      差: 'var(--dsw-alias-state-error-primary, #D64541)',
    };
    const 好 = '#2E9E5B', 警 = '#C77F1A';

    const 卡样式 = { background: V.卡底, border: '1px solid ' + V.边, borderRadius: 10, padding: '10px 12px', marginBottom: 10, color: 'inherit' };
    const 按钮 = (主要) => ({
      background: 主要 ? V.主 : V.浅底,
      color: 主要 ? '#fff' : 'inherit',
      border: '1px solid ' + V.边, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 13,
    });
    const 输入 = { background: V.浅底, color: 'inherit', border: '1px solid ' + V.边, borderRadius: 6, padding: '5px 8px', fontSize: 13, width: '100%' };
    const 字段行 = { display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, alignItems: 'center', marginBottom: 6 };
    const 小字 = { fontSize: 12, opacity: 0.72, lineHeight: 1.6 };            // 次要文字：继承色 + 压不透明度
    const 次字 = { fontSize: 12, opacity: 0.72 };
    const 正字 = { fontSize: 13, color: 'inherit' };

    /* ── 按流水线给参数表单（概念少：每条约 3~5 个字段）── */
    const 规格预设 = {
      ps: [
        { 键: '朋友圈', 名: '朋友圈', 宽: 1080, 高: 1080, 格式: 'jpg' },
        { 键: '网页', 名: '网页', 宽: 1920, 高: 1080, 格式: 'png' },
        { 键: '印刷', 名: '印刷 A4', 宽: 2480, 高: 3508, 格式: 'tif' },
      ],
    };

    function 默认参数(流水线, 家根) {
      const 家 = 家根 || '/Users/你/Desktop';
      if (!流水线) return {};
      if (流水线.软件 === 'photoshop') {
        return { 素材目录: 家 + '/素材', 交付目录: 家 + '/深鲸工序/交付', 客户: '', 项目: '', 规格选中: ['朋友圈', '网页'], 分辨率: 300, 水印文件: '', 比例策略: '留白' };
      }
      if (流水线.软件 === 'autocad') {
        return { 图纸目录: 家 + '/图纸', 交付目录: 家 + '/深鲸工序/出图', 图幅: 'A3', 打印样式: 'monochrome.ctb', 页面设置: '' };
      }
      return { 场景目录: 家 + '/场景', 交付目录: 家 + '/深鲸工序/渲染', 宽: 3840, 高: 2160, 输出格式: 'PNG' };
    }

    function 组意图(流水线, 参) {
      const 展开 = (p) => p.replace(/^~/, '');   // 后端按 home 解析太绕，直接让用户填绝对路径
      if (流水线.软件 === 'photoshop') {
        return {
          素材目录: 展开(参.素材目录), 交付目录: 展开(参.交付目录),
          客户: 参.客户 || '客户', 项目: 参.项目 || '项目',
          命名模板: '{客户}_{项目}_{序号:03}{后缀}',
          规格: 规格预设.ps.filter((s) => (参.规格选中 || []).includes(s.键)).map(({ 键, ...r }) => r),
          分辨率: Number(参.分辨率) || 300, 比例策略: 参.比例策略 || '留白',
          水印文件: 参.水印文件 ? 展开(参.水印文件) : '',
          版权: { 作者: 参.客户 || '', 版权: '', 网址: '' },
        };
      }
      if (流水线.软件 === 'autocad') {
        return {
          图纸目录: 展开(参.图纸目录), 交付目录: 展开(参.交付目录),
          图幅: 参.图幅, 打印样式: 参.打印样式, 页面设置: 参.页面设置 || '', 输出格式: 'PDF', 备份原图: true,
        };
      }
      return {
        场景目录: 展开(参.场景目录), 交付目录: 展开(参.交付目录),
        分辨率: { 宽: Number(参.宽) || 3840, 高: Number(参.高) || 2160 },
        输出格式: 参.输出格式, 贴图策略: '自动搜同名文件', 重试次数: 1,
      };
    }

    /* ── 小组件 ── */
    function 状态点({ 状态 }) {
      const 色 = 状态 === '可用' ? 好 : 状态 === '受阻' ? 警 : 'inherit';
      const 字 = 状态 === '可用' ? '可用' : 状态 === '受阻' ? '受阻' : '未检测到';
      return h('span', { style: { color: 色, fontSize: 12 } }, '● ' + 字);
    }

    function 字段({ 标签, 值, 改, 宽 }) {
      return h('div', { style: 字段行 }, [
        h('div', { key: 'l', style: { ...小字, color: 'inherit' } }, 标签),
        h('input', { key: 'i', style: { ...输入, width: 宽 || '100%' }, value: 值 || '', onChange: (e) => 改(e.target.value) }),
      ]);
    }

    /* ── 面板主体 ── */
    function 面板() {
      const [状态, 设状态] = react.useState(null);
      const [家根, 设家根] = react.useState('');   // 真实 home（从宿主拿），用来拼默认路径
      const [流水线们, 设流水线们] = react.useState([]);
      const [选中, 设选中] = react.useState(null);
      const [参, 设参] = react.useState({});
      const [计划, 设计划] = react.useState(null);
      const [进度, 设进度] = react.useState(null);
      const [校验, 设校验] = react.useState(null);
      const [忙, 设忙] = react.useState('');
      const [错, 设错] = react.useState('');

      // 首屏：拉状态 + 流水线
      react.useEffect(() => {
        let 活 = true;
        (async () => {
          设忙('探测本机软件…');
          const s = await 取('/status');
          if (!活) return;
          if (s.ok) { 设状态(s.软件); 设家根(s.家 || ''); }
          const p = await 取('/pipelines');
          if (!活) return;
          if (p.ok) {
            设流水线们(p.流水线);
            const 首个 = p.流水线[0];
            设选中(首个);
            设参(默认参数(首个, s.家));
          }
          设忙('');
        })().catch((e) => { 设错(String(e)); 设忙(''); });
        return () => { 活 = false; };
      }, []);

      // 跑起来就轮询进度
      react.useEffect(() => {
        if (!计划 || !计划.运行目录) return;
        let 活 = true;
        const 滴 = async () => {
          try {
            const s = await 取('/state?运行目录=' + encodeURIComponent(计划.运行目录));
            if (!活 || !s.ok) return;
            设进度(s);
          } catch { /* 宿主重启等：忽略 */ }
        };
        滴();
        const 定时 = setInterval(() => { if (活) 滴(); }, 1500);
        return () => { 活 = false; clearInterval(定时); };
      }, [计划 && 计划.运行目录]);

      const 切流水线 = (p) => { 设选中(p); 设参(默认参数(p, 家根)); 设计划(null); 设进度(null); 设校验(null); 设错(''); };

      const 落盘审阅 = async () => {
        设忙('落盘…'); 设错(''); 设校验(null);
        try {
          const r = await 发('/plan', { 流水线: 选中.文件, 意图: 组意图(选中, 参) });
          if (!r.ok) { 设错(r.原因 + (r.细节 ? '\n' + r.细节 : '')); return; }
          设计划(r); 设进度(null);
        } finally { 设忙(''); }
      };

      const 开始跑 = async () => {
        设忙('启动…'); 设错('');
        try {
          const r = await 发('/run', { 运行目录: 计划.运行目录 });
          if (!r.ok) 设错(r.原因);
        } finally { 设忙(''); }
      };

      const 校验回执 = async () => {
        设忙('校验…');
        try {
          const r = await 发('/verify', { 运行目录: 计划.运行目录 });
          设校验(r.校验);
        } finally { 设忙(''); }
      };

      /* 顶部：状态 */
      const 头 = h('div', { style: 卡样式 }, [
        h('div', { key: 't', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
          h('div', { key: 'l', style: { fontSize: 14, fontWeight: 600, color: 'inherit' } }, '深鲸工序 · 设计工序流水线'),
          h('button', { key: 'r', style: { ...按钮(false), padding: '3px 10px' }, onClick: () => location.reload(), title: '重新探测' }, '刷新'),
        ]),
        h('div', { key: 's', style: { ...小字, marginTop: 8, display: 'flex', gap: 18, flexWrap: 'wrap' } },
          (状态 || []).map((s) => h('span', { key: s.id }, [
            h('span', { key: 'n', style: { color: 'inherit', marginRight: 6 } }, s.名),
            h(状态点, { key: 'd', 状态: s.状态 }),
            s.版本 ? h('span', { key: 'v', style: { color: 'inherit', marginLeft: 6 } }, s.版本) : null,
          ]))),
        !状态 && h('div', { key: 'w', style: { ...小字, marginTop: 6 } }, 忙 || '正在探测…'),
      ]);

      /* 选流水线 */
      const 选条 = h('div', { style: { display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' } },
        流水线们.map((p) => h('button', {
          key: p.id,
          style: { ...按钮(选中 && 选中.id === p.id), textAlign: 'left' },
          onClick: () => 切流水线(p),
        }, [
          h('div', { key: 'a', style: { fontWeight: 600 } }, p.标题),
          h('div', { key: 'b', style: { ...小字, fontSize: 11, opacity: 0.8 } }, p.步骤数 + ' 步 · 替掉' + String(p.替掉).split('：')[0]),
        ])));

      /* 参数表单 */
      const 表 = [];
      if (选中 && 选中.软件 === 'photoshop') {
        表.push(h(字段, { key: 'a', 标签: '素材目录', 值: 参.素材目录, 改: (v) => 设参({ ...参, 素材目录: v }) }));
        表.push(h(字段, { key: 'b', 标签: '交付目录', 值: 参.交付目录, 改: (v) => 设参({ ...参, 交付目录: v }) }));
        表.push(h('div', { key: 'c', style: 字段行 }, [
          h('div', { key: 'l', style: 小字 }, '客户 / 项目'),
          h('div', { key: 'i', style: { display: 'flex', gap: 8 } }, [
            h('input', { key: 'k', style: 输入, placeholder: '客户', value: 参.客户 || '', onChange: (e) => 设参({ ...参, 客户: e.target.value }) }),
            h('input', { key: 'p', style: 输入, placeholder: '项目', value: 参.项目 || '', onChange: (e) => 设参({ ...参, 项目: e.target.value }) }),
          ]),
        ]));
        表.push(h('div', { key: 'd', style: 字段行 }, [
          h('div', { key: 'l', style: 小字 }, '交付规格'),
          h('div', { key: 'i', style: { display: 'flex', gap: 12, flexWrap: 'wrap' } }, 规格预设.ps.map((s) => h('label', { key: s.键, style: { ...小字, color: 'inherit', display: 'flex', gap: 4, alignItems: 'center' } }, [
            h('input', {
              key: 'c', type: 'checkbox',
              checked: (参.规格选中 || []).includes(s.键),
              onChange: (e) => {
                const 现 = 参.规格选中 || [];
                设参({ ...参, 规格选中: e.target.checked ? [...现, s.键] : 现.filter((x) => x !== s.键) });
              },
            }),
            s.名 + ' ' + s.宽 + '×' + s.高 + ' ' + s.格式,
          ]))),
        ]));
        表.push(h(字段, { key: 'e', 标签: '水印 PNG（可选）', 值: 参.水印文件, 改: (v) => 设参({ ...参, 水印文件: v }) }));
      } else if (选中 && 选中.软件 === 'autocad') {
        表.push(h(字段, { key: 'a', 标签: '图纸目录', 值: 参.图纸目录, 改: (v) => 设参({ ...参, 图纸目录: v }) }));
        表.push(h(字段, { key: 'b', 标签: '交付目录', 值: 参.交付目录, 改: (v) => 设参({ ...参, 交付目录: v }) }));
        表.push(h(字段, { key: 'c', 标签: '图幅 / 打印样式', 值: (参.图幅 || '') + ' / ' + (参.打印样式 || ''), 改: (v) => { const [图, 打] = v.split(' / '); 设参({ ...参, 图幅: 图 || 'A3', 打印样式: 打 || 'monochrome.ctb' }); } }));
        表.push(h(字段, { key: 'd', 标签: '页面设置（可选）', 值: 参.页面设置, 改: (v) => 设参({ ...参, 页面设置: v }) }));
      } else if (选中) {
        表.push(h(字段, { key: 'a', 标签: '场景目录', 值: 参.场景目录, 改: (v) => 设参({ ...参, 场景目录: v }) }));
        表.push(h(字段, { key: 'b', 标签: '交付目录', 值: 参.交付目录, 改: (v) => 设参({ ...参, 交付目录: v }) }));
        表.push(h(字段, { key: 'c', 标签: '分辨率（宽 / 高）', 值: (参.宽 || 0) + ' / ' + (参.高 || 0), 改: (v) => { const [w, hh] = v.split('/'); 设参({ ...参, 宽: (w || '').trim(), 高: (hh || '').trim() }); } }));
        表.push(h(字段, { key: 'd', 标签: '输出格式', 值: 参.输出格式, 改: (v) => 设参({ ...参, 输出格式: v }) }));
      }

      const 参卡 = 选中 && h('div', { style: 卡样式 }, [
        h('div', { key: 't', style: { fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'inherit' } }, '要跑什么'),
        ...表,
        h('div', { key: 'x', style: { ...小字, marginTop: 4 } }, '路径请填绝对路径（例如 /Users/你/Desktop/素材）。'),
        h('div', { key: 'b', style: { marginTop: 10, display: 'flex', gap: 8 } }, [
          h('button', { key: 'p', style: 按钮(true), disabled: !!忙, onClick: 落盘审阅 }, '① 先落盘审阅'),
          h('button', {
            key: 'r', style: 按钮(false), disabled: !计划 || !!忙, onClick: 开始跑,
            title: 计划 ? '执行已落盘的脚本' : '要先「先落盘审阅」',
          }, '② 开始跑'),
        ]),
      ]);

      /* 审阅屏：每步做什么/接口/验证/回退 */
      const 审 = 计划 && h('div', { style: 卡样式 }, [
        h('div', { key: 't', style: { fontSize: 13, fontWeight: 600, color: 'inherit' } }, '落盘审阅（还没执行）'),
        h('div', { key: 'p', style: { ...小字, marginTop: 4, wordBreak: 'break-all' } }, '运行目录：' + 计划.运行目录),
        h('div', { key: 'd', style: { ...小字, marginTop: 2 } }, '宿主：' + (计划.探测 ? 计划.探测.状态 + ' ' + (计划.探测.版本 || '') : '—')),
        h('div', { key: 'l', style: { marginTop: 10 } }, (计划.步骤 || []).map((s) => h('details', { key: s.编号, style: { marginBottom: 6 } }, [
          h('summary', { key: 's', style: { cursor: 'pointer', fontSize: 13, color: 'inherit' } }, s.编号 + ' · ' + s.名称),
          h('div', { key: 'c', style: { ...小字, paddingLeft: 14, marginTop: 4 } }, [
            h('div', { key: 'a' }, '做什么：' + s.做什么),
            h('div', { key: 'b', style: { marginTop: 3 } }, '调什么：' + (s.接口 || []).join('；')),
            h('div', { key: 'c', style: { marginTop: 3 } }, '怎么验：' + (s.验证 || []).join('；')),
            h('div', { key: 'd', style: { marginTop: 3 } }, '失败回退：' + (s.回退 || []).join('；')),
          ]),
        ]))),
      ]);

      /* 运行屏：每步状态 */
      const 运行 = 计划 && h('div', { style: 卡样式 }, [
        h('div', { key: 't', style: { fontSize: 13, fontWeight: 600, color: 'inherit' } },
          '执行' + (进度 && 进度.运行中 ? '（进行中…）' : 进度 && 进度.结论 ? '（' + 进度.结论 + '）' : '')),
        进度 && 进度.用时秒 ? h('div', { key: 'u', style: 小字 }, '用时 ' + 进度.用时秒 + ' 秒') : null,
        h('div', { key: 'l', style: { marginTop: 8 } }, ((进度 && 进度.步骤记录 && 进度.步骤记录.length ? 进度.步骤记录 : (计划.单元 || []).map((u) => ({ 编号: u.覆盖步骤.join('+'), 名称: u.单元ID, 状态: u.状态 || '待执行' }))))
          .map((s, i) => h('div', { key: i, style: { ...小字, display: 'flex', gap: 8, alignItems: 'baseline' } }, [
            h('span', { key: 'i', style: { color: s.状态 === '已完成' ? 好 : /失败/.test(s.状态 || '') ? V.差 : 'inherit', width: 16 } },
              s.状态 === '已完成' ? '✓' : /失败/.test(s.状态 || '') ? '✗' : '·'),
            h('span', { key: 'n', style: { color: 'inherit', minWidth: 120 } }, s.编号),
            h('span', { key: 's' }, s.名称),
            s.耗时毫秒 ? h('span', { key: 't', style: { marginLeft: 'auto' } }, s.耗时毫秒 + ' ms') : null,
          ]))),
        进度 && 进度.日志尾巴 && 进度.日志尾巴.length ? h('pre', {
          key: 'g', style: { ...小字, marginTop: 8, maxHeight: 90, overflow: 'auto', whiteSpace: 'pre-wrap' },
        }, 进度.日志尾巴.join('\n')) : null,
      ]);

      /* 结果屏：产物 + 降级 + 凭证 */
      const 结果 = 计划 && 进度 && 进度.产物 && 进度.产物.length ? h('div', { style: 卡样式 }, [
        h('div', { key: 't', style: { fontSize: 13, fontWeight: 600, color: 'inherit' } }, '产物（' + 进度.产物.length + ' 个）'),
        h('div', { key: 'l', style: { ...小字, marginTop: 6, maxHeight: 150, overflow: 'auto' } },
          进度.产物.slice(0, 60).map((p, i) => h('div', { key: i, style: { wordBreak: 'break-all' } },
            (p.本次生成 ? '✓ ' : '? ') + p.路径 + '  ' + Math.round(p.字节 / 1024) + ' KB'))),
        进度.降级 && 进度.降级.length ? h('div', { key: 'd', style: { ...小字, marginTop: 8, color: 警 } },
          '降级/跳过 ' + 进度.降级.length + ' 条：' + 进度.降级.slice(0, 3).join('；')) : null,
        h('div', { key: 'b', style: { marginTop: 10, display: 'flex', gap: 8 } }, [
          h('button', { key: 'v', style: 按钮(true), disabled: !!忙, onClick: 校验回执 }, '③ 校验回执（客户视角）'),
          h('button', { key: 'o', style: 按钮(false), onClick: () => 发('/open', { 目录: 计划.输出目录 }) }, '打开交付目录'),
        ]),
        校验 ? h('div', { key: 'r', style: { ...小字, marginTop: 8, color: 校验.结论 && 校验.结论.startsWith('✅') ? 好 : V.差 } }, [
          h('div', { key: 'a' }, 校验.结论 || '（无结论）'),
          ...(校验.问题 || []).slice(0, 6).map((x, i) => h('div', { key: i }, '· ' + x)),
        ]) : null,
      ]) : null;

      return h('div', { style: { padding: '14px 16px', height: '100%', overflow: 'auto', color: 'inherit', background: 'transparent' } }, [
        头, 选条, 错 ? h('div', { key: 'e', style: { ...卡样式, borderColor: V.差, color: V.差, whiteSpace: 'pre-wrap' } }, 错) : null,
        参卡, 审, 运行, 结果,
        h('div', { key: 'f', style: { ...小字, marginTop: 6 } }, '三条规矩：先落盘审阅再执行 · 判据看产物不看脚本自报 · 改图不可逆的事没备份不动手。'),
      ]);
    }

    /* ── 侧栏图标 ── */
    function 图标({ size = 18, active }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: active ? 2 : 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
      }, [
        h('rect', { key: 'a', x: 2.6, y: 3.6, width: 18.8, height: 16.8, rx: 3 }),
        h('path', { key: 'b', d: 'M3 9h18' }),
        h('path', { key: 'c', d: 'M9 9v11.4' }),
        h('path', { key: 'd', d: 'M12.6 12.6h5.4M12.6 15.8h5.4' }),
      ]);
    }

    function 兜底({ children }) {
      return h('div', { style: { padding: 12 } }, children);
    }
    function 安全面板(props) {
      try { return 面板(props); } catch (e) { return h(兜底, null, '深鲸工序面板出错：' + String(e && e.message || e)); }
    }

    /* ── 注册 ── */
    const inject = ['slots'];
    function apply(ctx) {
      ctx.slots.inject(SLOT_MAIN, function* () {
        yield ctx.slots.register({ name: SLOT_MAIN, key: PANEL_ID }, 安全面板);
      });
      ctx.slots.inject(SLOT_ICON, function* () {
        yield ctx.slots.register({ name: SLOT_ICON, id: PANEL_ID, order: 21, label: '深鲸工序' }, 图标);
      });
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
