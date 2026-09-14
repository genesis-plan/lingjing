const LINE_COLORS = ["#b0492f","#2f6f4f","#1f5b8a","#8a5a1a","#7a3a6a"];
function escapeHtml(s){ return String(s==null?"":s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
function hashStr(s) {
  let h = 0;
  const t = String(s || '');
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
  return h;
}
function peakChartSvg(turns, strongest) {
  const list = Array.isArray(turns) ? turns : [];
  const rounds = [...new Set(list.map((t) => Number(t.round) || 0).filter((r) => r > 0))].sort((a, b) => a - b);
  if (rounds.length < 2) return '';   // 少于两轮画不出"变化"，不硬画

  const byStudent = new Map(), byRound = new Map();
  for (const t of list) {
    const r = Number(t.round) || 0; if (!r) continue;
    const s = String(t.student || '?');
    const R = Math.max(0, Math.min(1, Number(t.R) || 0));
    if (!byStudent.has(s)) byStudent.set(s, new Map());
    byStudent.get(s).set(r, R);
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r).push(R);
  }
  const mean = rounds.map((r) => byRound.get(r).reduce((a, b) => a + b, 0) / byRound.get(r).length);
  const W = 620, H = 178, L = 38, Rp = 14, T = 16, B = 36;
  const pw = W - L - Rp, ph = H - T - B;
  const xi = new Map(rounds.map((r, i) => [r, i]));
  const x = (r) => L + (xi.get(r) || 0) * pw / Math.max(1, rounds.length - 1);
  const y = (v) => T + (1 - Math.max(0, Math.min(1, v))) * ph;
  const f1 = (n) => n.toFixed(1);

  let g = '';
  // 网格 + 纵轴刻度
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
    g += '<line x1="' + L + '" y1="' + f1(y(v)) + '" x2="' + (L + pw) + '" y2="' + f1(y(v)) + '" stroke="#e6dcc2" stroke-width="1"/>';
    g += '<text x="' + (L - 6) + '" y="' + f1(y(v) + 3.5) + '" text-anchor="end" font-size="9" fill="#9a8f78">'
      + v.toFixed(2) + '</text>';
  });
  // 判据线：这条曲线说的是"他问的东西被接住了多少"，0.45 以下是峰检测判"卡着"的阈值。
  // ⚠️ 2026-09-11 改语义：这条线的含义不是"学生还没学会"，而是"**他问的还没被答到**"。
  g += '<line x1="' + L + '" y1="' + f1(y(0.45)) + '" x2="' + (L + pw) + '" y2="' + f1(y(0.45)) + '" stroke="#c9b98f" stroke-width="1" stroke-dasharray="4 3"/>';
  g += '<text x="' + (L + pw) + '" y="' + f1(y(0.45) - 4) + '" text-anchor="end" font-size="9" fill="#b09a6a">0.45 以下＝他问的还没被答到</text>';

  // 学生细线
  let si = 0;
  for (const [, mp] of byStudent) {
    const col = LINE_COLORS[si++ % LINE_COLORS.length];
    const pts = rounds.filter((r) => mp.has(r)).map((r) => f1(x(r)) + ',' + f1(y(mp.get(r))));
    if (pts.length >= 2) g += '<polyline fill="none" stroke="' + col + '" stroke-width="1.3" stroke-opacity="0.4" points="' + pts.join(' ') + '"/>';
  }
  // 全班均值（粗线）
  g += '<polyline fill="none" stroke="#8a6a3a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" points="'
    + rounds.map((r, i) => f1(x(r)) + ',' + f1(y(mean[i]))).join(' ') + '"/>';
  rounds.forEach((r, i) => { g += '<circle cx="' + f1(x(r)) + '" cy="' + f1(y(mean[i])) + '" r="2.8" fill="#8a6a3a"/>'; });

  // ⚠️ 均值全程贴着 0 的时候，这条线看起来就像"图坏了"。
  //    所以把数值直接写在线上 —— 平线也要能读出"它就是 0.00"（＝你一句都没接住，或你根本没回话）。
  //    贴底时写在图内右上：写在线的末端会横轴刻度挤在同一行、把最后一个轮次号压掉。
  const mMin = Math.min.apply(null, mean), mMax = Math.max.apply(null, mean);
  const flat = mMax < 0.15;
  const mLabel = '全班接住率 ' + mMin.toFixed(2) + (mMax - mMin < 0.005 ? '' : ' → ' + mMax.toFixed(2));
  const mLabelY = flat ? T + 10 : Math.max(T + 10, y(mMax) - 7);
  g += '<text x="' + (L + pw) + '" y="' + f1(mLabelY) + '" text-anchor="end" font-size="9.5" font-weight="700" fill="#8a6a3a">'
    + mLabel + '</text>';

  let legend = '<span><i style="background:#8a6a3a"></i>全班接住率</span>'
    + '<span><i style="background:#c9b98f"></i>细线＝每名学生</span>';

  // 峰的位置
  const pr = strongest ? Number(strongest.round) : 0;
  if (strongest && xi.has(pr)) {
    const px = x(pr), py = y(Number(strongest.toR) || 0);
    g += '<line x1="' + f1(px) + '" y1="' + T + '" x2="' + f1(px) + '" y2="' + (T + ph) + '" stroke="#b0492f" stroke-width="1" stroke-dasharray="3 3" stroke-opacity="0.65"/>';
    g += '<circle cx="' + f1(px) + '" cy="' + f1(py) + '" r="5.5" fill="none" stroke="#b0492f" stroke-width="2"/>';
    g += '<circle cx="' + f1(px) + '" cy="' + f1(py) + '" r="2.2" fill="#b0492f"/>';
    const anchor = px > L + pw * 0.62 ? 'end' : 'start';
    g += '<text x="' + f1(anchor === 'end' ? px - 9 : px + 9) + '" y="' + f1(py - 9) + '" text-anchor="' + anchor
      + '" font-size="10" font-weight="700" fill="#b0492f">' + escapeHtml(String(strongest.student || ''))
      + ' 的探测被接住' + '</text>';
    legend += '<span><i style="background:#b0492f"></i>跃迁 · 第 ' + pr + ' 轮</span>';
  }

  // 横轴刻度（最多约 8 个，避免挤成一团）
  const step = Math.max(1, Math.ceil(rounds.length / 8));
  rounds.forEach((r, i) => {
    if (i % step && i !== rounds.length - 1) return;
    g += '<text x="' + f1(x(r)) + '" y="' + (T + ph + 14) + '" text-anchor="middle" font-size="9" fill="#9a8f78">' + r + '</text>';
  });
  g += '<text x="' + L + '" y="' + (H - 4) + '" font-size="9" fill="#9a8f78">纵轴＝他问的有没有被你答到</text>';
  g += '<text x="' + (L + pw) + '" y="' + (H - 4) + '" text-anchor="end" font-size="9" fill="#9a8f78">横轴＝第几轮 →</text>';

  return '<div class="chartwrap"><div class="legend">' + legend
    + (flat ? '<span style="color:#7a2c20">全程低于 0.15 —— 学生问的东西你一句都没接住（或整课没回话），曲线贴着底不是图坏了</span>' : '')
    + '</div>'
    + '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="学生问出的探测被答到的比例，随课堂轮次变化的曲线">' + g + '</svg></div>';
}
function queueTimelineHtml(interleaved, now, opts) {
  const o = opts || {};
  const items = Array.isArray(interleaved) ? interleaved : [];
  if (!items.length) {
    return '<div style="font-size:12px;color:#6b6355;margin-top:8px">还没有排上复习的卡——上完一课，这里就会开始排。</div>';
  }
  const days = items.map((c) => Math.max(1, Math.round(((Number(c.dueAt) || now) - now) / 86400000)));
  // ⚠️ 刻度**锚在绝对天数**（1 天…1 年），不按本组最大值归一化。
  //    归一化的话，"这一课的三张卡都是 3 天后"会被全画成 100% —— 长度就不携带任何量级信息，
  //    跨课也没法比（上一课的 100% 和这一课的 100% 不是一回事）。绝对刻度才能一眼读出"这张是 3 天，那张是 1 年"。
  const SCALE_MAX_DAYS = 365;
  const scale = (d) => Math.max(4, Math.round(100 * Math.log(1 + d) / Math.log(1 + SCALE_MAX_DAYS)));
  const topics = [...new Set(items.map((c) => String(c.topic || '一课')))];
  const colorOf = (t) => LINE_COLORS[Math.abs(hashStr(t)) % LINE_COLORS.length];

  const rows = items.map((c, i) => {
    const late = !!c.overdue;
    // 逾期的不算"还有几天"（负数没意义），直接压到 0 → 条最短 + 标红，
    // 视觉上就是"最该现在复习的排最前"。若沿用 Math.max(1,...)，逾期会和"1 天后"长得一样。
    const d = late ? 0 : Math.max(1, Math.round((Number(c.dueAt) - now) / 86400000));
    const lateDays = late ? Math.max(1, Math.round((now - (Number(c.dueAt) || now)) / 86400000)) : 0;
    return '<div class="tl-row">'
      + '<span class="tl-name" title="' + escapeHtml(c.concept) + '">' + escapeHtml(c.concept) + '</span>'
      + '<span class="tl-track"><i style="width:' + scale(d) + '%;background:' + colorOf(c.topic) + '"></i></span>'
      + '<span class="tl-days' + (late ? ' tl-due' : '') + '">' + (late ? '已到期 ' + lateDays + ' 天' : d + ' 天后') + '</span>'
      + '</div>';
  }).join('');

  const legend = topics.map((t) => '<span><i style="background:' + colorOf(t) + '"></i>' + escapeHtml(t) + '</span>').join('');
  // 刻度尺：把"条长"翻译成天数。没有它，条长只是相对长短，读不出量级。
  const RULER = [1, 7, 30, 90, 365];
  const ruler = '<div class="tl-axis"><span class="sp"></span><span class="ruler">'
    + RULER.map((d) => '<i style="left:' + scale(d) + '%">' + (d === 365 ? '1年' : d + '天') + '</i>').join('')
    + '</span><span class="sp2"></span></div>';
  return (o.upcoming
      ? '<p class="chart-cap" style="color:#7a2c20;font-weight:600">今天没有到期的卡 —— 下面是接下来该复习的，按时间排。</p>'
      : '')
    + '<p class="chart-cap">按"回忆概率掉到 90%"定下次复习时刻。条长用<b>对数刻度、锚在 1 天到 1 年</b>'
    + '（线性刻度会让长间隔全挤在右端看不出差别；锚绝对值才能跨课比较）。'
    + '相邻几张来自不同课题（交错复习），颜色即课题。</p>'
    + (legend ? '<div class="legend">' + legend + '</div>' : '')
    + '<div class="tl">' + rows + '</div>'
    + ruler;
}
function preDiffHtml(cons, ev) {
  const cover = (ev && ev.conceptCover) || [];
  const attempts = (cons && cons.attempts) || [];
  const left = attempts.map((a) => '<li>' + a.index + '. 「' + escapeHtml(a.gist) + '」'
    + (a.touched && a.touched.length
      ? '<br><span class="hit">当时碰到：' + a.touched.map((t) => escapeHtml(String(t).slice(0, 10))).join('、') + '</span>'
      : '')
    + '</li>').join('');
  const right = cover.map((c) => {
    const got = Number(c.hit) >= 0.2;
    return '<span class="' + (got ? 'hit' : 'gap') + '">' + (got ? '✓ ' : '○ ') + escapeHtml(c.concept) + '</span>';
  }).join('');
  const got = cover.filter((c) => Number(c.hit) >= 0.2).length;
  const pct = cover.length ? Math.round(got / cover.length * 100) : 0;
  return '<div class="diff">'
    + '<div><h4>你课前的那两次尝试</h4><ol>' + (left || '<li>（这次没留下尝试）</li>') + '</ol></div>'
    + '<div><h4>先生这段讲的 · 你课前碰到了几个</h4><div class="cchips">'
    + (right || '<span class="gap">（这次没提炼出概念）</span>') + '</div></div>'
    + '</div>'
    + '<div class="gapbar"><span>课前先摸到 ' + got + '/' + cover.length + ' 个</span>'
    + '<span class="t"><i style="width:' + pct + '%"></i></span><span>' + pct + '%</span></div>';
}
function whyHtml(summary, body) {
  return '<details class="why"><summary>' + escapeHtml(summary) + '</summary><div class="body">' + body + '</div></details>';
}
export { peakChartSvg, queueTimelineHtml, preDiffHtml, whyHtml, hashStr };