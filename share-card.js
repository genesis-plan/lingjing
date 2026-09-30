'use strict';
// 分享卡 v3 ·「课后的整理」：把一次讲授，整理成一页**别人也看得懂**的知识。
//
// 为什么有 v3（2026-09-30 用户实测反馈）：v2 的卡把系统内部的数学过程
// （收拢走势、「判据：unknown」、两轮说法的差）直接写在卡面上——那是机器的
// 工作过程，不是人的知识。参考 NotebookLM 的输出灵魂（要点分块 / 引用原文 /
// 问答消化 / 绝不展示机器怎么算的），v3 把卡面改成「一页课后的整理」：
//
//   ① 这一课，你讲明白了 —— 要点逐条上卡（来自你的原话，确定性抽取，非 AI 改写）
//   ② 有问有答           —— 镜子问了什么、你原话答了什么（Q&A 对，逐字引用）
//   ③ 你说过的那句话      —— 金句（确定性挑原文，A1）
//   ④ 还开着的问题        —— 没答上的追问 + 提到没展开的（人话措辞，不出现内部判据）
//   ⑤ 带走一个问题        —— 全文呈现，不截断（v2 会把问题切半，v3 修掉）
//
// 数学没有消失——它退到幕后继续当生成机制；卡面上只留知识本身。
//
// 四条硬约束（不变）：
//   A1 人是外部输入 —— 卡面只反映学习者自己说过的话；禁止任何改写/生成。
//   A2 镜子不评分   —— 卡上不得出现任何分/等级/正确率。所有数字只能是计数。
//                      assertNoScoring() 对整张卡做防火墙，命中即抛（fail-closed）。
//   A3 append-only  —— 只读 result，不回写会话。盲区卡「只增不改」。
//   A4 诚实降级     —— 某区块没有数据就整块留白，绝不编造。

const cc = require('./cognitive-convergence.js');
const tfn = require('./teachingfn.js');
const rd = require('./report-diagram.js');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '<')
    .replace(/>/g, '>').replace(/"/g, '&quot;');
}

// 中文换行：按字宽估测，优先断在标点之后
function wrap(s, per) {
  const chars = String(s || '').split('');
  const out = [];
  let line = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    line += ch;
    const nxt = chars[i + 1];
    const atBreak = line.length >= per && (!nxt || '。，、；：？！）」』'.indexOf(nxt) < 0);
    if (atBreak) { out.push(line); line = ''; }
  }
  if (line) out.push(line);
  return out;
}

// 取前 n 行，被截掉的补省略号（v3：不再无声截断）
function clampLines(s, per, n) {
  const all = wrap(s, per);
  const lines = all.slice(0, n);
  if (all.length > n && lines.length) lines[n - 1] = lines[n - 1].replace(/…?$/, '') + '……';
  return lines;
}

// ── A2 评分词防火墙（fail-closed）──────────────────────────────────
// 注意：不得包含「打分」本身——落款「不打分的那面镜子」是产品自述。
const BANNED = ['评分', '得分', '分数', '正确率', '百分比', '%', '排名', '掌握度', '理解度',
  '优秀率', '合格率', '满分', '及格', '优秀', '很差', '评级', '星级'];

function hasBanned(t) {
  const s = String(t || '');
  for (const w of BANNED) if (s.indexOf(w) >= 0) return w;
  return null;
}

function assertNoScoring(text, where) {
  const hit = hasBanned(text);
  if (hit) throw new Error('[A2] ' + (where || '卡片') + ' 出现评分词「' + hit + '」，拒绝输出');
}

// ── 你的原话（A1：只取原文，禁止改写）─────────────────────────────
function roundText(r) {
  if (typeof r === 'string') return r.trim();
  if (r && typeof r === 'object') {
    for (const k of ['text', 'say', 'mine', 'content', 'answer']) {
      if (typeof r[k] === 'string' && r[k].trim()) return r[k].trim();
    }
  }
  return '';
}

// 确定性金句挑选：切成句 → 留 10–40 字 → 过 A2 词表 → 取最长（平局取最靠后）。
// 不用 LLM、不随机：同输入恒同输出。挑不出 ⇒ null（A4 留白）。
function pickQuote(mineRounds) {
  const rs = Array.isArray(mineRounds) ? mineRounds : [];
  let best = null;
  for (let i = 0; i < rs.length; i++) {
    const raw = roundText(rs[i]);
    if (!raw) continue;
    for (const sent of raw.split(/[。！？\n]/)) {
      const s = sent.trim();
      const body = s.replace(/[，、；：""''（）()]/g, '');
      if (body.length < 10 || body.length > 40) continue;
      if (hasBanned(s)) continue;
      if (!best || body.length > best._len) best = { text: s + '。', round: i + 1, _len: body.length };
      else if (body.length === best._len) best = { text: s + '。', round: i + 1, _len: body.length };
    }
  }
  if (!best) return null;
  return { text: best.text, round: best.round };
}

// ── 还没连上的两件事（承 v1：伽罗瓦闭包下的「概念洞」，算不出退 uncovered，绝不编造）──
function looseEnds({ concepts, rounds, probes, uncovered } = {}) {
  const cs = (concepts || []).map(String).filter(Boolean);
  if (cs.length >= 3) {
    const adj = rd.conceptAdjacency({ concepts: cs, rounds: rounds || [], probes: probes || [] });
    let best = null;
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        if (adj[i].has(j)) continue;
        const via = [...adj[i]].filter((k) => adj[j].has(k) && k !== i && k !== j);
        if (!via.length) continue;
        if (!best || via.length > best.via.length) best = { a: cs[i], b: cs[j], via: via.map((k) => cs[k]) };
      }
    }
    if (best) return { kind: 'hole', a: best.a, b: best.b, via: best.via };
  }
  const unc = (uncovered || []).map(String).filter(Boolean);
  if (unc.length) return { kind: 'uncovered', items: unc.slice(0, 2) };
  return null;
}

// ── 留给你的那个问题（承 v1：一枚可溯源的追问，不是评价）──────────
function takeawayQuestion({ probes, uncovered } = {}) {
  const ps = Array.isArray(probes) ? probes : [];
  const unc = new Set((uncovered || []).map(String));
  if (ps.length) {
    const missed = ps.filter((p) => p && !p.answer);
    const pick = missed.length ? missed[missed.length - 1] : ps[ps.length - 1];
    const text = String(pick.say || pick.text || pick.prompt || '').trim();
    if (text) return { text, type: pick.type || 'probe', round: pick.round || null, allAnswered: !missed.length };
  }
  if (unc.size) {
    return {
      text: '「' + [...unc][0] + '」你提到了，但没再往下讲——它卡在哪一步？',
      type: 'uncovered', round: null, allAnswered: false, derived: true,
    };
  }
  return null;
}

// ── 主题（只换皮，不碰数据）────────────────────────────────────────
const THEMES = {
  ink:    { bg: '#ffffff', stroke: '#e5e7eb', fg: '#1f2330', mut: '#6b7280', faint: '#9ca3af',
            accent: '#4f46e5', box: '#f7f8fb', boxStroke: '#eef0f5', quoteBg: '#faf9ff', quoteStroke: '#ECE9FC',
            askBg: '#EEEDFE', askStroke: '#AFA9EC', askT: '#534AB7', askQ: '#26215C', askTag: '#7F77DD' },
  violet: { bg: '#fbfaff', stroke: '#e6e2f7', fg: '#221f45', mut: '#5d5880', faint: '#8f8ab5',
            accent: '#6d5ce8', box: '#f3f1fd', boxStroke: '#e8e4fa', quoteBg: '#ffffff', quoteStroke: '#ddd6fa',
            askBg: '#EFEBFF', askStroke: '#9f93ee', askT: '#4c3fb8', askQ: '#241d5c', askTag: '#7A6ee0' },
};

const MARKS = ['①', '②', '③', '④', '⑤', '⑥'];
const BODY_PER = 30;   // 15.5px 正文的每行字数
const W = 840, PAD = 56, CW = W - PAD * 2;

// ── 卡 A · 课后的整理（v3：知识本体上卡，数学退到幕后，卡高动态）────
function shareCardSvg({ lessonTitle = '这一课', result = {}, date = '', theme = 'ink' } = {}) {
  const T = THEMES[theme] || THEMES.ink;
  const rounds = result.mineRounds || result.rounds || [];
  const probes = result.probes || [];
  const concepts = (result.concepts || []).map(String).filter(Boolean);
  const uncovered = (result.uncovered || []).map(String).filter(Boolean);

  // —— 内容准备（全部确定性，来自输入字段本身）——
  const quote = pickQuote(rounds);

  const qa = [];
  (probes || []).forEach((p) => {
    if (!p) return;
    const q = String(p.say || p.text || p.prompt || '').trim();
    const a = roundText(p.answer);
    if (q && a) qa.push({ q, a, round: p.round || null });
  });
  const qaShown = qa.slice(0, 3);

  const openItems = [];
  (probes || []).forEach((p) => {
    if (p && !p.answer) {
      const q = String(p.say || p.text || p.prompt || '').trim();
      if (q) openItems.push(q);
    }
  });
  uncovered.slice(0, 2).forEach((u) => {
    const t = `「${u}」你提到了，但没再往下讲——它卡在哪一步？`;
    if (!openItems.includes(t)) openItems.push(t);
  });
  const openShown = openItems.slice(0, 3);

  const tq = takeawayQuestion({ probes, uncovered });
  const countsLine = `${rounds.length} 轮讲授 · ${probes.length} 问 · ${qa.length} 有问有答`;

  const F = '-apple-system,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif';

  // build(H)：H 为 null 时只测量高度；否则连背景一起产出。两遍调用保证确定性。
  function build(H) {
    const parts = [];
    let y = 72;
    const P = (s) => parts.push(s);
    const header = (label) => { P(`<text x="${PAD}" y="${y}" font-size="14" font-weight="500" fill="${T.fg}">${esc(label)}</text>`); y += 40; };

    // 抬头（固定区）
    P(`<text x="${PAD}" y="${y}" font-size="14" fill="${T.mut}">灵境 · 课后的整理</text>`);
    P(`<text x="${W - PAD}" y="${y}" font-size="13" fill="${T.faint}" text-anchor="end">${esc(date)}</text>`);
    y = 122;
    const titleLines = clampLines(String(lessonTitle), 18, 2);
    titleLines.forEach((ln, i) => {
      P(`<text x="${PAD}" y="${y + i * 38}" font-size="28" font-weight="500" fill="${T.fg}">${esc(ln)}</text>`);
    });
    y += titleLines.length * 38 + 6;
    P(`<rect x="${PAD}" y="${y}" width="52" height="3" rx="1.5" fill="${T.accent}"/>`);
    y += 30;
    P(`<text x="${PAD}" y="${y}" font-size="13" fill="${T.faint}">${esc(countsLine)}</text>`);
    y += 52;

    // ① 这一课，你讲明白了（知识本体）
    header('这一课，你讲明白了');
    if (concepts.length) {
      concepts.slice(0, 5).forEach((c, i) => {
        const lines = clampLines(c, BODY_PER, 3);
        P(`<text x="${PAD}" y="${y + 20}" font-size="16" fill="${T.accent}">${MARKS[i]}</text>`);
        lines.forEach((ln, j) => {
          P(`<text x="${PAD + 34}" y="${y + 20 + j * 26}" font-size="15.5" fill="${T.fg}">${esc(ln)}</text>`);
        });
        y += 20 + lines.length * 26 + 12;
      });
    } else {
      P(`<text x="${PAD}" y="${y + 22}" font-size="14" fill="${T.faint}">（这次没收到可整理的要点。空着不编。）</text>`);
      y += 44;
    }
    y += 16;

    // ② 有问有答（Q&A 对，逐字引用）
    if (qaShown.length) {
      header('有问有答（镜子问 · 你答）');
      qaShown.forEach(({ q, a, round }) => {
        const qL = clampLines(q, BODY_PER, 2);
        const aL = clampLines(a, BODY_PER, 3);
        const bh = 20 + qL.length * 26 + aL.length * 26 + 34;
        P(`<rect x="${PAD}" y="${y}" width="${CW}" height="${bh}" rx="14" fill="${T.quoteBg}" stroke="${T.quoteStroke}" stroke-width="1"/>`);
        qL.forEach((ln, j) => {
          P(`<text x="${PAD + 24}" y="${y + 22 + j * 26}" font-size="15.5" font-weight="500" fill="${T.askQ}">${esc(ln)}</text>`);
        });
        const ay = y + 22 + qL.length * 26;
        aL.forEach((ln, j) => {
          P(`<text x="${PAD + 24}" y="${ay + j * 26}" font-size="15.5" fill="${T.fg}">${esc(ln)}</text>`);
        });
        P(`<text x="${PAD + 24}" y="${y + bh - 12}" font-size="11" fill="${T.askTag}">—— 第 ${round || '?'} 轮 · 你的原话</text>`);
        y += bh + 16;
      });
    }

    // ③ 你说过的那句话（金句）
    if (quote) {
      header('你说过的那句话');
      P(`<rect x="${PAD}" y="${y}" width="${CW}" height="112" rx="14" fill="${T.quoteBg}" stroke="${T.quoteStroke}" stroke-width="1"/>`);
      clampLines(quote.text, 21, 2).forEach((ln, i) => {
        P(`<text x="${PAD + 26}" y="${y + 54 + i * 30}" font-size="18" font-weight="500" fill="${T.askQ}">${esc(ln)}</text>`);
      });
      P(`<text x="${PAD + 26}" y="${y + 100}" font-size="11" fill="${T.askTag}">—— 你的原话 · 第 ${quote.round} 轮（只挑原文，AI 不代笔）</text>`);
      y += 112 + 30;
    }

    // ④ 还开着的问题（未答追问 + 提到没展开；人话，无内部判据）
    if (openShown.length) {
      header('还开着的问题');
      openShown.forEach((t) => {
        const lines = clampLines(t, BODY_PER, 2);
        P(`<text x="${PAD}" y="${y + 20}" font-size="15.5" fill="${T.mut}">·</text>`);
        lines.forEach((ln, j) => {
          P(`<text x="${PAD + 22}" y="${y + 20 + j * 26}" font-size="15.5" fill="${T.mut}">${esc(ln)}</text>`);
        });
        y += 20 + lines.length * 26 + 10;
      });
      y += 10;
    }

    // ⑤ 带走一个问题（全文呈现，不截断）
    if (tq) {
      const qL = wrap(tq.text, 26);
      const bh = 60 + qL.length * 32 + 44;
      P(`<rect x="${PAD}" y="${y}" width="${CW}" height="${bh}" rx="18" fill="${T.askBg}" stroke="${T.askStroke}" stroke-width="1"/>`);
      P(`<text x="${PAD + 28}" y="${y + 38}" font-size="13" fill="${T.askT}">带走一个问题</text>`);
      qL.forEach((ln, i) => {
        P(`<text x="${PAD + 28}" y="${y + 72 + i * 32}" font-size="18" fill="${T.askQ}">${esc(ln)}</text>`);
      });
      const tag = tq.allAnswered
        ? '（这一轮你全都答到了，这是最后抛出的那枚）'
        : `（第 ${tq.round || '?'} 轮 · 你还没答到这枚）`;
      P(`<text x="${PAD + 28}" y="${y + bh - 16}" font-size="12" fill="${T.askTag}">${esc(tag)}</text>`);
      y += bh + 10;
    } else {
      P(`<text x="${PAD}" y="${y + 20}" font-size="14" fill="${T.faint}">这次没有留下追问。</text>`);
      y += 44;
    }

    // 落款
    y += 40;
    P(`<text x="${PAD}" y="${y}" font-size="13" fill="${T.mut}">灵境 · 不打分的那面镜子</text>`);
    P(`<text x="${PAD}" y="${y + 24}" font-size="12" fill="${T.faint}">卡上每句话都是你自己说过的；它只整理，不评价。</text>`);
    P(`<text x="${W - PAD}" y="${y + 24}" font-size="12" fill="${T.faint}" text-anchor="end">讲一遍，你也能拿到自己那张。</text>`);
    return { parts, endY: y + 44 };
  }

  const H = Math.max(760, Math.min(2400, build(null).endY));
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" font-family="${F}">`;
  s += `<rect width="${W}" height="${H}" rx="22" fill="${T.bg}" stroke="${T.stroke}" stroke-width="1"/>`;
  s += build(H).parts.join('');
  s += '</svg>';

  assertNoScoring(s, '课后的整理');   // A2 防火墙：命中即抛
  return s;
}

// ── 卡 B · 盲区卡（暗色 · 全部为可观测事实，晒盲区=成长人设；v3 修截断）─
function blindCardSvg({ lessonTitle = '这一课', result = {}, date = '', nth = null } = {}) {
  const W2 = 840, H = 1140, pad = 56, cw = W2 - pad * 2;
  const bg = '#17163a', stroke = '#2c2a63', fg = '#f4f3ff', mut = '#a5a1d6',
        accent = '#8b85ff', box = '#211f52', boxStroke = '#3d3a85',
        askBg = '#2c2a63', askStroke = '#5a55b8';

  const rounds = result.mineRounds || result.rounds || [];
  const probes = result.probes || [];
  const concepts = result.concepts || [];
  const uncovered = result.uncovered || [];

  // 收集盲区条目（全部为已发生的观测，绝无 AI 断言）
  const items = [];
  const le = looseEnds({ concepts, rounds, probes, uncovered });
  if (le && le.kind === 'hole') {
    items.push(`「${le.a}」和「${le.b}」，你提到了，却没把它们放在一起讲过。`);
  } else if (le && le.kind === 'uncovered') {
    le.items.forEach((it) => items.push(`「${it}」你提到了，却没再往下讲。`));
  }
  (uncovered || []).map(String).filter(Boolean).slice(0, 2).forEach((it) => {
    const line = `「${it}」你提到了，却没再往下讲。`;
    if (!items.includes(line)) items.push(line);
  });
  const tq = takeawayQuestion({ probes, uncovered });
  if (tq && !tq.allAnswered) items.push(`「${tq.text}」——被问到，还没答上。`);
  const shown = items.slice(0, 3);
  const marks = ['①', '②', '③'];

  let s = `<svg viewBox="0 0 ${W2} ${H}" width="${W2}" height="${H}" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,'PingFang SC','Microsoft YaHei','Segoe UI',sans-serif">`;
  s += `<rect width="${W2}" height="${H}" rx="22" fill="${bg}" stroke="${stroke}" stroke-width="1"/>`;
  s += `<text x="${pad}" y="72" font-size="14" fill="${mut}">灵境 · 盲区卡${nth ? ' · 第 ' + esc(String(nth)) + ' 次照镜子' : ''}</text>`;
  s += `<text x="${W2 - pad}" y="72" font-size="13" fill="${mut}" text-anchor="end">${esc(date)}</text>`;
  s += `<text x="${pad}" y="130" font-size="30" font-weight="500" fill="${fg}">这次照见，${esc(String(lessonTitle).slice(0, 10))}里</text>`;
  s += `<text x="${pad}" y="176" font-size="30" font-weight="500" fill="${fg}">我没讲圆的地方</text>`;
  s += `<rect x="${pad}" y="196" width="52" height="3" rx="1.5" fill="${accent}"/>`;

  let y = 262;
  if (shown.length) {
    shown.forEach((it, i) => {
      const lines = clampLines(it, 30, 4);
      s += `<rect x="${pad}" y="${y}" width="${cw}" height="${26 + lines.length * 26}" rx="14" fill="${box}" stroke="${boxStroke}" stroke-width="1"/>`;
      lines.forEach((ln, j) => {
        s += `<text x="${pad + 26}" y="${y + 34 + j * 26}" font-size="15.5" fill="${fg}">${esc((j === 0 ? marks[i] + ' ' : '') + ln)}</text>`;
      });
      y += 46 + lines.length * 26;
    });
  } else {
    s += `<rect x="${pad}" y="${y}" width="${cw}" height="96" rx="14" fill="${box}" stroke="${boxStroke}" stroke-width="1"/>`;
    s += `<text x="${pad + 26}" y="${y + 42}" font-size="15" fill="${mut}">这次够不上——没有可照见的缝。</text>`;
    s += `<text x="${pad + 26}" y="${y + 70}" font-size="13" fill="${mut}">空着不编。</text>`;
    y += 120;
  }

  // 为什么敢晒
  const qy = Math.max(y + 32, 830), qh = 160;
  s += `<rect x="${pad}" y="${qy}" width="${cw}" height="${qh}" rx="18" fill="${askBg}" stroke="${askStroke}" stroke-width="1"/>`;
  s += `<text x="${pad + 28}" y="${qy + 40}" font-size="13" fill="${accent}">为什么敢晒这个</text>`;
  clampLines('这里没有一条是 AI 说的——都是你自己讲课时留下的缝。承认不会，是会的开始。', 26, 2).forEach((ln, i) => {
    s += `<text x="${pad + 28}" y="${qy + 78 + i * 30}" font-size="16" fill="${fg}">${esc(ln)}</text>`;
  });

  const fy = H - 96;
  s += `<text x="${pad}" y="${fy}" font-size="13" fill="${mut}">灵境 · 盲区卡 · 只增不改（append-only）</text>`;
  s += `<text x="${pad}" y="${fy + 24}" font-size="12" fill="${mut}">它只照出你说过的话，不评价你说得好不好。</text>`;
  s += `<text x="${W2 - pad}" y="${fy + 24}" font-size="12" fill="${mut}" text-anchor="end">讲一遍，你也能拿到自己那张。</text>`;
  s += '</svg>';

  assertNoScoring(s, '盲区卡');
  return s;
}

// ── HTML 容器 ───────────────────────────────────────────────────────
// 承 v1：单卡渲染（向后兼容，现在产出「课后的整理」卡）。
function renderShareCardHtml(opts = {}) {
  const svg = shareCardSvg(opts);
  const name = String(opts.filename || '灵境-课后的整理.svg');
  return cardHtml([svg], [name], opts);
}

// 一次出两张（课后的整理 + 盲区卡），并排展示。
function renderShareCardsHtml(opts = {}) {
  const a = shareCardSvg(opts);
  const b = blindCardSvg(opts);
  return cardHtml([a, b], ['灵境-课后的整理.svg', '灵境-盲区卡.svg'], opts);
}

function cardHtml(svgs, names, opts = {}) {
  const F = '-apple-system,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif';
  let cards = '', btns = '';
  svgs.forEach((svg, i) => {
    cards += `<div class="card">${svg}</div>`;
    btns += `<button onclick="dl(${i})">下载 ${names[i]}</button>`;
  });
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>灵境 · 课后的整理</title>
<style>
 body{margin:0;background:#eef1f6;display:flex;flex-direction:column;align-items:center;padding:24px;
  font-family:${F};color:#1f2330}
 .wrap{display:flex;gap:26px;flex-wrap:wrap;justify-content:center}
 .card{background:#fff;border-radius:22px;box-shadow:0 8px 30px rgba(31,35,48,.10);overflow:hidden}
 .card svg{display:block;width:min(92vw,560px);height:auto}
 .bar{margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
 button{background:#4f46e5;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer}
 .tip{margin-top:10px;font-size:12px;color:#6b7280;text-align:center;line-height:1.7}
</style></head><body>
<div class="wrap">${cards}</div>
<div class="bar">${btns}</div>
<div class="tip">卡上的数字全是计数，没有一处评分；每句话都是你自己说过的。<br/>存成图片：在卡片上右键 →「存储图像」，或用截图工具。</div>
<script>
var RAW=${JSON.stringify(svgs)};
var NAMES=${JSON.stringify(names)};
function blob(i){return new Blob([RAW[i]],{type:'image/svg+xml;charset=utf-8'})}
function dl(i){
 var a=document.createElement('a');a.href=URL.createObjectURL(blob(i));
 a.download=NAMES[i];document.body.appendChild(a);a.click();a.remove();
}
</script></body></html>`;
}

module.exports = {
  shareCardSvg, blindCardSvg,
  renderShareCardHtml, renderShareCardsHtml,
  pickQuote, hasBanned, assertNoScoring,
  looseEnds, takeawayQuestion, wrap, clampLines,
  THEMES, BANNED,
};
