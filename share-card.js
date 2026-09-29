'use strict';
// 分享卡：把一次镜面对话，变成一件**可以带走**的东西。
//
// 为什么要这个：所有 AI 教学产品都在要求学习者"对着 AI 暴露无知"——求助在被诊断为需要帮助时
// 成本高到多数人放弃（Khanmigo 两年 RCT：中位学生只在约 1/3 练习日发消息，仅 14.5% 的消息含
// 真正的推理；Stanford literacy trial：AI 单独陪学生，每周仅 2.18 分钟）。
// 所以卡片的入口不是"来，我照照你哪里不懂"，而是"讲完这段，带走一张图 + 一个问题"。
//
// 三条硬约束（写代码时不得违反）：
//   A1 人是外部输入 —— 卡片只反映学习者自己说过的话，不引入外部知识判对错。
//   A2 镜子不评分   —— 卡片上**不得出现**任何分/等级/正确率/百分比。所有数字只能是计数。
//   A3 append-only  —— 只读 result，不回写会话。
//
// 因此：卡上的三个数字是"你讲了几轮 / 抛回几问 / 还剩几问"，不是"你多好"。

const cc = require('./cognitive-convergence.js');
const tfn = require('./teachingfn.js');
const rd = require('./report-diagram.js');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

// ── 还没连上的两件事 ───────────────────────────────────────────────
// 首选：概念格里的"洞"。两个概念各自都与同一个第三方共现，但彼此从未被你放在同一处讲过
// ⇒ 在伽罗瓦闭包下，它们分属两个不同的形式概念，中间缺一条你自己没搭过的桥。
// 算不出来就退到"讲到一半没往下讲的"（uncovered，真实盲区清单），绝不编造。
function looseEnds({ concepts, rounds, probes, uncovered } = {}) {
  const cs = (concepts || []).map(String).filter(Boolean);
  if (cs.length >= 3) {
    const adj = rd.conceptAdjacency({ concepts: cs, rounds: rounds || [], probes: probes || [] });
    let best = null;
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        if (adj[i].has(j)) continue;                     // 已经连过，跳过
        const via = [...adj[i]].filter((k) => adj[j].has(k) && k !== i && k !== j);
        if (!via.length) continue;                       // 没有共同邻居 ⇒ 无桥可搭，不算松端
        if (!best || via.length > best.via.length) best = { a: cs[i], b: cs[j], via: via.map((k) => cs[k]) };
      }
    }
    if (best) return { kind: 'hole', a: best.a, b: best.b, via: best.via };
  }
  const unc = (uncovered || []).map(String).filter(Boolean);
  if (unc.length) return { kind: 'uncovered', items: unc.slice(0, 2) };
  return null;
}

// ── 留给你的那个问题 ───────────────────────────────────────────────
// 卡片的产出物：不是评价，是**一枚你还没答到的追问**，且可溯源到第几轮、哪个算子。
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

const STAMP_MAX = 34;

// ── 卡片本体 ───────────────────────────────────────────────────────
function shareCardSvg({ lessonTitle = '这一课', result = {}, date = '' } = {}) {
  const W = 840, H = 1140, pad = 56, cw = W - pad * 2;
  // 注意：使用者的原话在 mineRounds（result.rounds 里存的是镜子那一侧）
  const rounds = result.mineRounds || result.rounds || [];
  const probes = result.probes || [];
  const concepts = result.concepts || [];
  const uncovered = result.uncovered || [];

  const unanswered = uncovered.length;
  const title = String(lessonTitle).slice(0, 18);

  // 收拢走势：相邻两轮说法之间的差（可观测版柯西内部差），不是正确与否
  const cauchy = tfn.cauchyConvergence({ concepts, rounds, probes });
  const verdict = cc.cognitiveConvergence({ concepts, rounds, probes }).verdict || 'unknown';
  const trendText = !cauchy.ok
    ? '还不到两轮，画不出走势。'
    : cauchy.internalConvergence === 'contracting' ? '你在往一处收拢。'
      : cauchy.internalConvergence === 'stationary' ? '这几轮几乎没往前动。'
        : '还在张开或来回换方向。';

  const le = looseEnds({ concepts, rounds, probes, uncovered });
  const tq = takeawayQuestion({ probes, uncovered });

  const F = '-apple-system,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif';
  const boxW = Math.floor((cw - 32) / 3);
  const stats = [
    { n: rounds.length, l: '你讲了几轮' },
    { n: probes.length, l: '镜子抛回几问' },
    { n: unanswered, l: '还剩几问没答到' },
  ];

  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" font-family="${F}">`;
  s += `<rect width="${W}" height="${H}" rx="22" fill="#ffffff" stroke="#e5e7eb" stroke-width="1"/>`;

  // 抬头
  s += `<text x="${pad}" y="72" font-size="14" fill="#6b7280">今天那面镜子</text>`;
  s += `<text x="${W - pad}" y="72" font-size="13" fill="#9ca3af" text-anchor="end">${esc(date)}</text>`;
  s += `<text x="${pad}" y="118" font-size="28" font-weight="500" fill="#1f2330">${esc(title)}</text>`;
  s += `<rect x="${pad}" y="136" width="52" height="3" rx="1.5" fill="#4f46e5"/>`;

  // 三个计数（无评分）
  stats.forEach((st, i) => {
    const x = pad + i * (boxW + 16);
    s += `<rect x="${x}" y="176" width="${boxW}" height="104" rx="14" fill="#f7f8fb"/>`;
    s += `<text x="${x + boxW / 2}" y="222" font-size="34" font-weight="500" fill="#1f2330" text-anchor="middle">${st.n}</text>`;
    s += `<text x="${x + boxW / 2}" y="252" font-size="12" fill="#6b7280" text-anchor="middle">${st.l}</text>`;
  });

  // 收拢走势图
  const gy = 340, gh = 180;
  s += `<text x="${pad}" y="322" font-size="14" font-weight="500" fill="#1f2330">你是怎么讲的</text>`;
  s += `<rect x="${pad}" y="${gy}" width="${cw}" height="${gh}" rx="14" fill="#fbfcfe" stroke="#eef0f5" stroke-width="1"/>`;
  const gaps = Array.isArray(cauchy.gaps) ? cauchy.gaps : [];
  if (gaps.length >= 1) {
    const px0 = pad + 40, px1 = pad + cw - 40, py0 = gy + gh - 44, py1 = gy + 44;
    const peak = Math.max(...gaps, 0.001);
    const pts = gaps.map((g, i) => {
      const x = gaps.length === 1 ? px0 : px0 + (px1 - px0) * (i / (gaps.length - 1));
      const y = py0 - (py0 - py1) * (1 - g / peak);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    s += `<line x1="${px0}" y1="${py0}" x2="${px1}" y2="${py0}" stroke="#e5e7eb" stroke-width="1"/>`;
    s += `<polyline points="${pts.join(' ')}" fill="none" stroke="#4f46e5" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach((p) => { const [x, y] = p.split(','); s += `<circle cx="${x}" cy="${y}" r="4" fill="#4f46e5"/>`; });
    s += `<text x="${px0}" y="${gy + gh - 18}" font-size="11" fill="#9ca3af">第 1 轮</text>`;
    s += `<text x="${px1}" y="${gy + gh - 18}" font-size="11" fill="#9ca3af" text-anchor="end">最后一轮</text>`;
    s += `<text x="${px1}" y="${gy + 28}" font-size="11" fill="#9ca3af" text-anchor="end">两轮之间说法的差</text>`;
  } else {
    s += `<text x="${pad + 28}" y="${gy + gh / 2}" font-size="13" fill="#9ca3af">${esc(trendText)}</text>`;
  }
  s += `<text x="${pad}" y="${gy + gh + 30}" font-size="13" fill="#4b5563">${esc(trendText)}（判据：${esc(verdict)}）</text>`;

  // 还没连上的两件事
  let y = gy + gh + 78;
  s += `<text x="${pad}" y="${y}" font-size="14" font-weight="500" fill="#1f2330">还没连上的两件事</text>`;
  y += 16;
  const MAX_LE_LINES = 3;
  if (le && le.kind === 'hole') {
    const line = `「${le.a}」和「${le.b}」都挨着「${le.via.join('、')}」，`;
    const lines = wrap(line, STAMP_MAX).slice(0, MAX_LE_LINES);
    lines.forEach((ln, i) => { s += `<text x="${pad}" y="${y + 26 + i * 24}" font-size="15" fill="#374151">${esc(ln)}</text>`; });
    y += 26 + lines.length * 24;
    s += `<text x="${pad}" y="${y}" font-size="15" fill="#374151">你却从没把它们放在同一处讲过。</text>`;
    y += 12;
  } else if (le && le.kind === 'uncovered') {
    const line = `「${le.items.join('」和「')}」你提到了，`;
    const lines = wrap(line, STAMP_MAX).slice(0, MAX_LE_LINES);
    lines.forEach((ln, i) => { s += `<text x="${pad}" y="${y + 26 + i * 24}" font-size="15" fill="#374151">${esc(ln)}</text>`; });
    y += 26 + lines.length * 24;
    s += `<text x="${pad}" y="${y}" font-size="15" fill="#374151">却在这一轮里没再往下讲。</text>`;
    y += 12;
  } else {
    wrap('这次够不上——要么概念少于三个，要么你说的每一件事都已经挨上了。空着不编。', STAMP_MAX)
      .forEach((ln, i) => { s += `<text x="${pad}" y="${y + 26 + i * 24}" font-size="14" fill="#9ca3af">${esc(ln)}</text>`; });
    y += 26 + 24;
  }

  // 留给你的问题（本卡唯一的产出物）
  const qy = Math.max(y + 40, 720), qh = 300;
  s += `<rect x="${pad}" y="${qy}" width="${cw}" height="${qh}" rx="18" fill="#EEEDFE" stroke="#AFA9EC" stroke-width="1"/>`;
  s += `<text x="${pad + 28}" y="${qy + 42}" font-size="13" fill="#534AB7">留给你的那个问题</text>`;
  if (tq) {
    const lines = wrap(tq.text, 26).slice(0, 5);
    lines.forEach((ln, i) => {
      s += `<text x="${pad + 28}" y="${qy + 82 + i * 34}" font-size="18" fill="#26215C">${esc(ln)}</text>`;
    });
    const tag = tq.allAnswered
      ? '（这一轮你全都答到了，这是最后抛出的那枚）'
      : `（第 ${tq.round || '?'} 轮 · ${esc(tq.type)} · 你还没答到这枚）`;
    s += `<text x="${pad + 28}" y="${qy + qh - 28}" font-size="12" fill="#7F77DD">${esc(tag)}</text>`;
  } else {
    s += `<text x="${pad + 28}" y="${qy + 84}" font-size="16" fill="#534AB7">这次没有留下追问。</text>`;
  }

  // 落款 + 流通钩子：看到这张图的人，会想要自己的那张
  const fy = H - 96;
  s += `<text x="${pad}" y="${fy}" font-size="13" fill="#6b7280">灵境 · 不打分的那面镜子</text>`;
  s += `<text x="${pad}" y="${fy + 24}" font-size="12" fill="#9ca3af">它只照出你说过的话，不评价你说得好不好。</text>`;
  s += `<text x="${W - pad}" y="${fy + 24}" font-size="12" fill="#9ca3af" text-anchor="end">讲一遍，你也能拿到自己那张。</text>`;
  s += '</svg>';
  return s;
}

// ── 可直接打开/截图的 HTML 容器 ─────────────────────────────────────
function renderShareCardHtml(opts = {}) {
  const svg = shareCardSvg(opts);
  const name = String(opts.filename || '镜子-今天那面镜子.svg');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>今天那面镜子</title>
<style>
 body{margin:0;background:#eef1f6;display:flex;flex-direction:column;align-items:center;padding:24px;
  font-family:-apple-system,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;color:#1f2330}
 .card{background:#fff;border-radius:22px;box-shadow:0 8px 30px rgba(31,35,48,.10);overflow:hidden}
 .card svg{display:block;width:min(92vw,760px);height:auto}
 .bar{margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
 button{background:#4f46e5;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer}
 button.ghost{background:#fff;color:#4f46e5;border:1px solid #e5e7eb}
 .tip{margin-top:10px;font-size:12px;color:#6b7280;text-align:center;line-height:1.7}
</style></head><body>
<div class="card">${svg}</div>
<div class="bar">
 <button onclick="dl('svg')">下载 SVG（可直接发）</button>
 <button class="ghost" onclick="dl('png')">存成图片</button>
</div>
<div class="tip">卡片上的数字全是计数，没有一处评分。<br/>存成图片： Safari/Chrome 里右键这张卡 →「存储图像」也可。</div>
<script>
var RAW=${JSON.stringify(svg)};
function blob(){return new Blob([RAW],{type:'image/svg+xml;charset=utf-8'})}
function dl(kind){
 if(kind!=='svg'){alert('请在卡片上右键 →「存储图像」，或用截图工具。');return}
 var a=document.createElement('a');a.href=URL.createObjectURL(blob());
 a.download=${JSON.stringify(name)};document.body.appendChild(a);a.click();a.remove();
}
</script></body></html>`;
}

module.exports = { shareCardSvg, renderShareCardHtml, looseEnds, takeawayQuestion, wrap };
