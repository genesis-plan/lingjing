// report-diagram.js — 《我的收获》图表化（认知收敛 / 保号性 / 映射网 / 伽罗瓦盲区）
// ============================================================================
// 动机（实查论文，非直觉）：人脑处理图比纯文字更强——
//   • 双重编码理论 (Paivio 1971/1975/1986)：言语+意象双通道，双编码记忆更牢
//     （图片召回 > 文字，图优效应 Standing 1973：10000 张图 90% 再认）
//   • 多媒体学习 (Mayer)：图文同步呈现增强理解；但 coherence 原则——图必须
//     与文字【相关+同步】，花哨/无关的图反而增加外在认知负荷、损害学习
//   • Larkin & Simon (1987)：图同时呈现、感知可得、降低记忆负荷、约束推理
//   • 对抽象主题（极限/思维）：要用【结构图】(节点-边/收敛曲线/闭包)，
//     而非具象图——具象/模糊图图优效应会减弱甚至消失
// ⇒ 本模块：图全部从本课【真实数据】重算，且紧邻对应文字段（图文同步），不评分、不装饰。
//
// 红线：图据会话真实数据生成；算不出就诚实留空/写"数据不足"，绝不编造图形。
// ============================================================================

'use strict';

const tfn = require('./teachingfn.js');
const cc = require('./cognitive-convergence.js');
const { GaloisContext } = require('./galois.js');

// ── 探针类型配色（与前端 reflection.js / teacher.js PROBE_LABELS 一致）──
const TYPE_COLOR = {
  counter: '#d9534f', // 反例 红
  bound:   '#0275d8', // 边界 蓝
  example: '#5cb85c', // 正例 绿
  distinct:'#17a2b8', // 区分 青
  mechanism:'#f0ad4e', // 机制 橙
  apply:   '#a0522d', // 应用 褐
  sign:    '#6f42c1', // 保号 靛
  land:    '#868e96', // 落地 灰
};
const TYPE_LABEL = {
  counter: '反例', bound: '边界', example: '正例', distinct: '区分',
  mechanism: '机制', apply: '应用', sign: '保号', land: '落地',
};
function colorOf(t) { return TYPE_COLOR[t] || '#868e96'; }

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── 从会话数据重建"概念-概念"邻接（共现：同轮回复 / 同探针 say+answer 都提到两个概念）──
//
// 2026-09-29 修（真缺陷，由分享卡样例暴露）：
//   原实现只做**完整字符串包含**。但真人说话说的是"夹逼""柯西"，概念表里写的是"夹逼准则""柯西准则"
//   ⇒ 匹配不上 ⇒ 邻接矩阵全空 ⇒ 映射网、盲区图在一次正常会话里其实是**空的**（图上没一条边）。
//   两处改动：
//   ① 口语命中：允许"概念去掉通用后缀后的核心词"命中（说"柯西"＝说到"柯西准则"）；
//   ② 相邻两轮连边：会话里接着上一句讲，就是在讲同一件事——这是"已经连上"的最低门槛。
//      只靠同句共现太严：真人一句话通常只提一个概念，图上永远没边。

const CONCEPT_SUFFIX = ['准则', '定理', '定律', '性质', '法则', '原则', '推论', '定义', '公式', '定则'];

function coreOf(c) {
  const s = String(c);
  for (const suf of CONCEPT_SUFFIX) {
    if (s.length > suf.length + 1 && s.endsWith(suf)) return s.slice(0, -suf.length);
  }
  return s;
}

function mentions(text, c) {
  const t = String(text || '');
  if (t.indexOf(c) >= 0) return true;
  const core = coreOf(c);
  return core.length >= 2 && t.indexOf(core) >= 0;
}

function conceptAdjacency(result) {
  const cs = (result.concepts || []).map(String);
  const idx = new Map(cs.map((c, i) => [c, i]));
  const adj = cs.map(() => new Set());
  const link = (a, b) => { if (a !== b && idx.has(a) && idx.has(b)) { adj[idx.get(a)].add(idx.get(b)); adj[idx.get(b)].add(idx.get(a)); } };
  const perRound = [];
  for (const r of (result.rounds || [])) {
    const present = cs.filter((c) => mentions(r.text, c));
    for (let i = 0; i < present.length; i++) for (let j = 0; j < present.length; j++) link(present[i], present[j]);
    perRound.push(present);
  }
  for (let k = 1; k < perRound.length; k++) {
    for (const a of perRound[k - 1]) for (const b of perRound[k]) link(a, b);
  }
  for (const p of (result.probes || [])) {
    const text = String(p.say || '') + '\n' + String(p.answer || '');
    const present = cs.filter((c) => mentions(text, c));
    for (let i = 0; i < present.length; i++) for (let j = 0; j < present.length; j++) link(present[i], present[j]);
  }
  return adj;
}

// ════════════════════════════════════════════════════════════════════════
// 图 1：认知收敛判据（你爱的那张图的严谨实现）
// ════════════════════════════════════════════════════════════════════════
function convergenceDiagram(ccRes) {
  const W = 680, H = 360;
  const x0 = 70, x1 = 600, base = 300, limitY = 120, halfY = 210;
  const verdict = ccRes.verdict || 'unknown';
  const pathIndependent = !!ccRes.pathIndependent;
  const localPreserved = !!ccRes.localPreserved;
  const core = (ccRes.core || []).join('、') || '（空）';

  // 三条路径的终点 y：路径无关→全收 A；否则分叉
  const ends = pathIndependent ? [limitY, limitY, limitY]
    : [limitY, limitY + 36, limitY + 70];
  const pathColor = pathIndependent ? '#2e7d32' : '#c62828';

  let paths = '';
  for (let k = 0; k < 3; k++) {
    const sx = x0 + 20 * k, sy = base - 6 * k;
    const ey = ends[k];
    const mx = (sx + x1) / 2;
    paths += `<path d="M ${sx} ${sy} Q ${mx} ${sy - 40} ${x1 - 30} ${ey}" fill="none" stroke="${pathColor}" stroke-width="2.4" opacity="0.85"/>`;
  }

  const flip = !localPreserved
    ? `<g><line x1="${x0}" y1="${halfY}" x2="${x1 - 20}" y2="${halfY}" stroke="#e65100" stroke-width="2.4" stroke-dasharray="7 5"/>` +
      `<text x="${x1 - 16}" y="${halfY - 8}" font-size="12" fill="#e65100" text-anchor="end">保号线 A/2（局部保号性）</text>` +
      `<text x="${x0 + 8}" y="${halfY + 18}" font-size="12" fill="#c62828">⚠ 有方向判断在邻近情形翻号 ⇒ 不保号</text></g>`
    : `<line x1="${x0}" y1="${halfY}" x2="${x1 - 20}" y2="${halfY}" stroke="#2e7d32" stroke-width="2" stroke-dasharray="7 5"/>` +
      `<text x="${x1 - 16}" y="${halfY - 8}" font-size="12" fill="#2e7d32" text-anchor="end">保号线 A/2（局部保号性 ✓ 已保持）</text>`;

  const verdictText = {
    converged: '✅ 认知收敛：局部保号 + 各路径通同一极限',
    'local-ok-global-divergent': '⚠ 局部保号，但路径依赖（换角度就分叉）',
    'global-ok-local-flip': '⚠ 各角度一致，但方向判断翻号（不保号）',
    divergent: '❌ 发散：翻号 + 路径分叉 ⇒ 极限不存在',
  }[verdict] || '数据不足，无从判收敛';

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="认知收敛图">
  <rect width="${W}" height="${H}" fill="#fbfdff"/>
  <text x="20" y="26" font-size="15" font-weight="bold" fill="#1a237e">认知收敛判据：不同方法 → 同一极限</text>
  <text x="${W - 20}" y="26" font-size="12" fill="#555" text-anchor="end">纵轴＝与理解极限的距离；横轴＝轮次/方法</text>

  <!-- 去心邻域 -->
  <rect x="${x1 - 20}" y="${limitY - 6}" width="60" height="${base - limitY + 12}" fill="#eceff1" opacity="0.7"/>
  <text x="${x1 - 22}" y="${limitY - 12}" font-size="11" fill="#607d8b" text-anchor="end">去心邻域</text>
  <text x="${x1 - 22}" y="${limitY + 6}" font-size="10.5" fill="#607d8b" text-anchor="end">只认证趋近</text>
  <text x="${x1 - 22}" y="${limitY + 20}" font-size="10.5" fill="#607d8b" text-anchor="end">不踩上</text>

  <!-- 极限线 -->
  <line x1="${x0}" y1="${limitY}" x2="${x1 - 20}" y2="${limitY}" stroke="#2e7d32" stroke-width="2.4"/>
  <circle cx="${x1 - 20}" cy="${limitY}" r="5" fill="none" stroke="#2e7d32" stroke-width="2.4"/>
  <text x="${x1 - 28}" y="${limitY - 8}" font-size="12" fill="#2e7d32" text-anchor="end">极限 A（收敛核 = ${esc(core)}）</text>

  ${flip}

  ${paths}

  <!-- 轴 -->
  <line x1="${x0}" y1="${base}" x2="${x1 - 10}" y2="${base}" stroke="#90a4ae" stroke-width="1.5"/>
  <line x1="${x0}" y1="40" x2="${x0}" y2="${base}" stroke="#90a4ae" stroke-width="1.5"/>
  <text x="14" y="${base + 18}" font-size="12" fill="#555">起点（未逼近）</text>

  <!-- 结论 -->
  <rect x="20" y="${H - 44}" width="${W - 40}" height="32" rx="6" fill="#fff8e1" stroke="#e0a800"/>
  <text x="30" y="${H - 23}" font-size="13" fill="#5d4037">${esc(verdictText)}</text>
</svg>`;
}

// ════════════════════════════════════════════════════════════════════════
// 图 2：保号性（每条方向判断 = 一颗芯片：保号绿 / 翻号红）
// ════════════════════════════════════════════════════════════════════════
function signDiagram(spRes) {
  const W = 680, H = 200;
  const dirs = spRes.directional || [];
  const notP = new Set(spRes.notPreserved || []);
  if (!dirs.length) {
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="保号性图">
  <rect width="${W}" height="${H}" fill="#fbfdff"/>
  <text x="20" y="40" font-size="15" font-weight="bold" fill="#1a237e">保号性：你的方向判断，邻近情形还保号吗</text>
  <text x="20" y="90" font-size="13" fill="#777">本课没有检测到带方向/符号的判断（"必然/优于/导致…"）。</text>
  <text x="20" y="115" font-size="12.5" fill="#555">镜子无法照出保号盲区——你没给方向，它也无从检验翻号。</text>
</svg>`;
  }
  let chips = '';
  let x = 20, y = 70, rowH = 46;
  for (const d of dirs) {
    const bad = notP.has(d);
    const w = Math.min(300, 40 + esc(d.sentence).length * 7.2);
    if (x + w > W - 20) { x = 20; y += rowH; }
    const fill = bad ? '#fdecea' : '#e8f5e9';
    const stroke = bad ? '#c62828' : '#2e7d32';
    const mark = bad ? '↺ 翻号盲区' : '✓ 保号';
    chips += `<g>
      <rect x="${x}" y="${y}" width="${w}" height="34" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>
      <text x="${x + 8}" y="${y + 14}" font-size="11.5" fill="${stroke}" font-weight="bold">${mark}</text>
      <text x="${x + 8}" y="${y + 28}" font-size="11" fill="#333">「${esc(d.sentence)}」·${esc(d.concept)}</text>
    </g>`;
    x += w + 12;
  }
  const summary = notP.size
    ? `红＝只给方向、没给保持范围也没举翻号反例（共 ${notP.size} 处盲区）`
    : `全部方向判断都给了保持范围或翻号检验（已保号）`;
  return `<svg viewBox="0 0 ${W} ${H + 40}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="保号性图">
  <rect width="${W}" height="${H + 40}" fill="#fbfdff"/>
  <text x="20" y="34" font-size="15" font-weight="bold" fill="#1a237e">保号性：你在 ${dirs.length} 处给了带方向/符号的判断</text>
  ${chips}
  <text x="20" y="${H + 28}" font-size="12.5" fill="#5d4037">${esc(summary)}</text>
</svg>`;
}

// ════════════════════════════════════════════════════════════════════════
// 图 3：映射网（镜子为 hub，概念为节点，边＝探测，色＝类型）
// ════════════════════════════════════════════════════════════════════════
function mapNetworkDiagram(result) {
  const W = 680, H = 380;
  const cs = (result.concepts || []).map(String);
  const probes = result.probes || [];
  if (!cs.length) return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#fbfdff"/><text x="20" y="40" font-size="14" fill="#777">无概念表，映射网无从画。</text></svg>`;

  // 统计每个概念被哪些类型探测
  const byConcept = cs.map(() => ({}));
  for (const p of probes) {
    if (p && typeof p.ci === 'number' && byConcept[p.ci]) {
      const t = p.type || 'land';
      byConcept[p.ci][t] = (byConcept[p.ci][t] || 0) + 1;
    }
  }
  const hub = { x: W / 2, y: H / 2 + 10 };
  const n = cs.length;
  const R = Math.min(W, H) / 2 - 70;
  let nodes = '', edges = '';
  for (let i = 0; i < n; i++) {
    const ang = (2 * Math.PI * i) / Math.max(n, 1) - Math.PI / 2;
    const cx = hub.x + R * Math.cos(ang);
    const cy = hub.y + R * Math.sin(ang);
    const types = byConcept[i];
    const total = Object.values(types).reduce((a, b) => a + b, 0);
    const domType = Object.keys(types).sort((a, b) => types[b] - types[a])[0] || 'land';
    const col = colorOf(domType);
    const has = total > 0;
    const ec = has ? col : '#cfd8dc';
    const sw = has ? Math.min(4, 1 + total * 0.6) : 1;
    const eo = has ? 0.8 : 0.4;
    edges += `<line x1="${hub.x}" y1="${hub.y}" x2="${cx}" y2="${cy}" stroke="${ec}" stroke-width="${sw}" opacity="${eo}"/>`;
    nodes += `<circle cx="${cx}" cy="${cy}" r="${has ? 16 : 11}" fill="${has ? col : '#eceff1'}" stroke="#fff" stroke-width="2"/>` +
      `<text x="${cx}" y="${cy + 4}" font-size="10.5" fill="#fff" text-anchor="middle">${esc(cs[i].slice(0, 4))}</text>`;
    if (has) nodes += `<text x="${cx}" y="${cy + 30}" font-size="10.5" fill="#444" text-anchor="middle">${esc(TYPE_LABEL[domType] || '落地')}×${total}</text>`;
  }
  // hub
  nodes += `<circle cx="${hub.x}" cy="${hub.y}" r="26" fill="#1a237e"/>` +
    `<text x="${hub.x}" y="${hub.y + 5}" font-size="13" fill="#fff" text-anchor="middle">镜子</text>`;

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="映射网图">
  <rect width="${W}" height="${H}" fill="#fbfdff"/>
  <text x="20" y="28" font-size="15" font-weight="bold" fill="#1a237e">映射网：镜子怎样从不同角度逼你（边＝探测，色＝类型）</text>
  ${edges}
  ${nodes}
  <text x="20" y="${H - 14}" font-size="11.5" fill="#555">灰边＝该概念本轮没被探测到。色卡：反例/边界/正例/区分/机制/应用/保号/落地。</text>
</svg>`;
}

// ════════════════════════════════════════════════════════════════════════
// 图 4：伽罗瓦盲区（所说 ≠ 闭包，差集＝盲区）
// ════════════════════════════════════════════════════════════════════════
function blindSpotDiagram(result) {
  const W = 680, H = 340;
  const cs = (result.concepts || []).map(String);
  if (!cs.length) return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#fbfdff"/><text x="20" y="40" font-size="14" fill="#777">无概念表，盲区图无从画。</text></svg>`;

  const adj = conceptAdjacency(result);
  const up = {}, down = {};
  for (const c of cs) { up[c] = new Set([c]); down[c] = new Set([c]); }
  cs.forEach((c, i) => { for (const j of adj[i]) { const d = cs[j]; if (d) { up[c].add(d); down[d].add(c); } } });
  const ctx = new GaloisContext({ G: cs, M: [...cs], I: [], up, down });

  // 每个概念的盲区
  const blindMap = new Map(); // blind concept -> source concepts
  for (const c of cs) {
    const bs = ctx.blindSpot(c);
    if (bs.ok) for (const b of bs.blind) {
      if (!blindMap.has(b)) blindMap.set(b, []);
      blindMap.get(b).push(c);
    }
  }

  const blinds = [...blindMap.keys()];
  // 内圈：所说概念；外环：盲区
  const cx = 175, cy = 175, rIn = 95, rOut = 150;
  let inner = '';
  const step = (2 * Math.PI) / Math.max(cs.length, 1);
  cs.forEach((c, i) => {
    const ang = step * i - Math.PI / 2;
    const x = cx + rIn * Math.cos(ang), y = cy + rIn * Math.sin(ang);
    inner += `<circle cx="${x}" cy="${y}" r="13" fill="#1a237e"/><text x="${x}" y="${y + 4}" font-size="10" fill="#fff" text-anchor="middle">${esc(c.slice(0, 4))}</text>`;
  });
  let outer = '', links = '';
  const bstep = (2 * Math.PI) / Math.max(blinds.length, 1);
  blinds.forEach((b, i) => {
    const ang = bstep * i - Math.PI / 2;
    const x = cx + rOut * Math.cos(ang), y = cy + rOut * Math.sin(ang);
    for (const src of blindMap.get(b)) {
      const si = cs.indexOf(src);
      const sang = step * si - Math.PI / 2;
      const sx = cx + rIn * Math.cos(sang), sy = cy + rIn * Math.sin(sang);
      links += `<line x1="${sx}" y1="${sy}" x2="${x}" y2="${y}" stroke="#e53935" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.7"/>`;
    }
    outer += `<circle cx="${x}" cy="${y}" r="13" fill="#e53935"/><text x="${x}" y="${y + 4}" font-size="10" fill="#fff" text-anchor="middle">${esc(b.slice(0, 4))}</text>`;
  });

  let side;
  if (!blinds.length) {
    side = `<text x="360" y="120" font-size="14" fill="#2e7d32">✅ 本课盲区图：所说即所闭</text>
      <text x="360" y="148" font-size="12.5" fill="#555">你讲的概念之间，没有"一说就牵连出却没明说"的额外口子。</text>
      <text x="360" y="172" font-size="12.5" fill="#555">（邻接由本课共现关系推导；共现稀疏时盲区自然为空——诚实拒绝，不编造。）</text>`;
  } else {
    const list = blinds.map((b) => `· 「${esc(b)}」被 ${blindMap.get(b).map((s) => esc(s)).join('、')} 牵连`).join('\n');
    side = `<text x="360" y="110" font-size="14" font-weight="bold" fill="#c62828">盲区＝所说 ≠ 闭包（共 ${blinds.length} 处）</text>
      <text x="360" y="140" font-size="11.5" fill="#444" xml:space="preserve">${esc(list).replace(/\n/g, '&#10;')}</text>
      <text x="360" y="${H - 70}" font-size="11.5" fill="#555">红虚线＝某概念经你给的关系，牵连出你没明说的概念。</text>
      <text x="360" y="${H - 48}" font-size="11.5" fill="#555">数学：closure=↓↑，盲区=闭包\所说（Wille 1982 形式概念分析）。</text>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="伽罗瓦盲区图">
  <rect width="${W}" height="${H}" fill="#fbfdff"/>
  <text x="20" y="28" font-size="15" font-weight="bold" fill="#1a237e">伽罗瓦盲区：你讲了这些，却漏说了它们牵连的</text>
  <circle cx="${cx}" cy="${cy}" r="${rIn + 6}" fill="none" stroke="#90caf9" stroke-width="1.4" stroke-dasharray="4 3"/>
  <text x="${cx}" y="${cy - rIn - 14}" font-size="11.5" fill="#1565c0" text-anchor="middle">你明说的概念</text>
  ${links}
  ${inner}
  ${outer}
  ${side}
</svg>`;
}

// ── 极简 markdown→html（标题/列表/段落/粗体/〔注〕）──
function inlineMd(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/〔(.+?)〕/g, '<span class="note">〔$1〕</span>');
}
function mdSectionToHtml(sec) {
  const lines = sec.split('\n');
  let html = '', para = [];
  const flush = () => { if (para.length) { html += '<p>' + para.map(inlineMd).join('<br>') + '</p>'; para = []; } };
  for (const ln of lines) {
    if (/^###\s/.test(ln)) { flush(); html += '<h3>' + inlineMd(ln.replace(/^###\s/, '')) + '</h3>'; }
    else if (/^##\s/.test(ln)) { flush(); html += '<h2>' + inlineMd(ln.replace(/^##\s/, '')) + '</h2>'; }
    else if (/^#\s/.test(ln)) { flush(); html += '<h1>' + inlineMd(ln.replace(/^#\s/, '')) + '</h1>'; }
    else if (/^\s*·\s/.test(ln)) { flush(); html += '<ul><li>' + inlineMd(ln.replace(/^\s*·\s/, '')) + '</li></ul>'; }
    else if (ln.trim() === '') { flush(); }
    else para.push(ln);
  }
  flush();
  return html;
}

// ════════════════════════════════════════════════════════════════════════
// 总装：把《我的收获》文本 + 4 张图，图文同步拼成一份 HTML
//   设计：顶部"图览"视觉摘要（4 图齐全，用真实数据生成，与下方文字同源），
//   其下是完整文字报告。无论哪段文字在不在，图览恒在——保证使用者
//   总有视觉入口；图与文字双通道呈现，符合双重编码 / 多媒体学习。
// ════════════════════════════════════════════════════════════════════════
function renderHtmlReport({ title = '我的收获', teacherReportMd = '', result = {} } = {}) {
  const ccRes = cc.cognitiveConvergence({ concepts: result.concepts, rounds: result.mineRounds, probes: result.probes });
  const spRes = tfn.signPreservation({ concepts: result.concepts, rounds: result.mineRounds, probes: result.probes });

  const gallery = [
    { cap: '认知收敛判据：你从不同方法/角度讲的，最终是否收同一个理解（极限）。局部保号 + 全局 Heine。', svg: convergenceDiagram(ccRes) },
    { cap: '保号性：你给的带方向/符号判断，在邻近情形里还保号吗？红＝只给方向、没举翻号反例的盲区。', svg: signDiagram(spRes) },
    { cap: '映射网：镜子怎样从不同角度逼你——边＝探测，色＝类型。', svg: mapNetworkDiagram(result) },
    { cap: '伽罗瓦盲区：你讲了这些，却漏说了它们经你给的关系牵连出的（所说 ≠ 闭包）。', svg: blindSpotDiagram(result) },
  ];

  const body = mdSectionToHtml(teacherReportMd);

  const galleryHtml = gallery.map((g) =>
    `<div class="fig"><div class="cap">${esc(g.cap)}</div>${g.svg}</div>`).join('\n');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · 我的收获（图文本同步）</title>
<style>
  body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:780px;margin:0 auto;padding:24px;color:#222;background:#fff;line-height:1.7}
  h1{font-size:22px;border-bottom:3px solid #1a237e;padding-bottom:6px}
  h2{font-size:18px;margin-top:30px;color:#1a237e;border-left:5px solid #1a237e;padding-left:10px}
  h3{font-size:15px;color:#37474f;margin-top:18px}
  p{margin:8px 0;font-size:14px}
  ul{margin:6px 0;padding-left:22px} li{font-size:14px;margin:3px 0}
  .note{color:#888;font-size:12px}
  .fig{margin:16px 0 8px;border:1px solid #e3e8ef;border-radius:10px;padding:10px;background:#fbfdff}
  .fig svg{width:100%;height:auto;display:block}
  .cap{font-size:13px;color:#37474f;margin-bottom:8px;font-weight:600}
  .banner{background:#eef4ff;border:1px solid #c5d9ff;border-radius:10px;padding:12px 16px;font-size:13px;color:#274472;margin:16px 0 22px}
  .banner b{color:#1a237e}
  .gallery-title{font-size:16px;color:#1a237e;margin:6px 0 4px;font-weight:700}
</style></head>
<body>
  <h1>${esc(title)} · 我的收获</h1>
  <div class="banner"><b>为什么用图：</b>人脑处理图比纯文字更牢（双重编码理论 Paivio；图优效应 Standing 1973；多媒体学习 Mayer）。
  本页<b>图文双通道</b>——顶部"图览"用本课<b>真实数据</b>生成（与下方文字同源），下方给口头细节。镜子<b>不评分</b>，图只陈述事实，不装饰、不编造。</div>
  <div class="gallery-title">图览（视觉摘要）</div>
  ${galleryHtml}
  <h2>文字详述</h2>
  ${body}
</body></html>`;
}

module.exports = {
  convergenceDiagram, signDiagram, mapNetworkDiagram, blindSpotDiagram,
  renderHtmlReport, conceptAdjacency,
};
