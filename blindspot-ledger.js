'use strict';
// 盲区账本 blindspot-ledger：append-only 的「未知地图」。
// 别人管理你知道的；这里只记录你没讲圆的，以及你后来把它讲圆了的那一刻。
//
// 四条硬约束（与 share-card 同源）：
//   A1 只用可观测事实 —— 条目只来自 uncovered（你提到但没讲完）与未答追问（镜子问过、你没答）。
//   A2 零评分        —— 输出只有计数与日期；「闭环」是你后来真的讲到了它，不是 AI 估的掌握度。
//   A3 append-only   —— 只读输入，绝不改写；闭环是追加事实，不是修改历史。
//   A4 诚实降级      —— 无观测 ⇒ 空账本 + 说明，不编造。
//
// 闭环判定（纯可观测）：概念 X 第 i 次被记为盲区后，若存在更晚的第 j 次
//   满足 X ∈ concepts_j 且 X ∉ uncovered_j ⇒ X 于第 j 次闭环（你后来讲到它了）。
//   只做去空白精确匹配 —— 模糊/语义匹配＝AI 判断，违背判定权归人；要模糊请人自判后追加。

function norm(s) { return String(s || '').trim(); }
function normKey(s) { return norm(s).replace(/\s+/g, ''); }

function daysBetween(a, b) {
  if (!a || !b) return 0;
  const t = new Date(b) - new Date(a);
  return isNaN(t) ? 0 : Math.max(0, Math.round(t / 86400000));
}

// sessions：按时间的镜面课记录数组 [{ date:'YYYY-MM-DD', result:{ concepts, uncovered, probes, mineRounds } }]
// 顺序不限（内部按 date 排序副本，绝不改动入参）。
function buildLedger(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  const ordered = list
    .map((raw, idx) => ({ raw, idx }))
    .sort((a, b) => String((a.raw && a.raw.date) || '').localeCompare(String((b.raw && b.raw.date) || '')));

  const map = new Map(); // key -> gap

  for (const { raw } of ordered) {
    const date = norm(raw && raw.date);
    const r = (raw && raw.result) || {};
    const uncovered = (Array.isArray(r.uncovered) ? r.uncovered : []).map(norm);
    const uncoveredKeys = new Set(uncovered.map(normKey).filter(Boolean));
    const conceptSet = new Set((Array.isArray(r.concepts) ? r.concepts : []).map(normKey).filter(Boolean));
    const probes = Array.isArray(r.probes) ? r.probes : [];

    // 1) 本次的盲区观测：新开或推进 lastSeen（同轮既讲又没讲完 ⇒ 仍是盲区，自证不闭环）
    for (const u of uncovered) {
      if (!u) continue;
      const k = normKey(u);
      const g = map.get(k);
      if (!g) map.set(k, { label: u, kind: 'uncovered', firstDate: date, lastSeenDate: date, status: 'open', closedDate: null });
      else if (date && date > (g.lastSeenDate || '')) g.lastSeenDate = date;
    }

    // 2) 闭环判定：先前 open 的盲区，本次被真正讲到（∈concepts 且 ∉uncovered，且晚于首记日）
    for (const g of map.values()) {
      if (g.kind !== 'uncovered' || g.status !== 'open') continue;
      const k = normKey(g.label);
      if (date && date > (g.firstDate || '') && conceptSet.has(k) && !uncoveredKeys.has(k)) {
        g.status = 'closed';
        g.closedDate = date;
      }
    }

    // 3) 未答追问：记录为 question 盲区；闭环需要你亲口答到（接线钩子：probe.answer 出现时不再新增）
    for (const p of probes) {
      const text = norm(p && (p.say || p.text || p.prompt));
      if (!text || p.answer) continue;
      const k = 'Q::' + normKey(text);
      if (!map.has(k)) map.set(k, { label: text, kind: 'question', firstDate: date, lastSeenDate: date, status: 'open', closedDate: null });
    }
  }

  const gaps = [...map.values()].sort((a, b) => String(b.firstDate || '').localeCompare(String(a.firstDate || '')));
  const open = gaps.filter((g) => g.status === 'open');
  const closed = gaps.filter((g) => g.status === 'closed');

  return {
    gaps,
    totalGaps: gaps.length,
    openCount: open.length,
    closedCount: closed.length,
    longestOpenDays: open.reduce((m, g) => Math.max(m, daysBetween(g.firstDate, g.lastSeenDate)), 0),
    honestEmpty: gaps.length ? null : '账本为空：还没有任何「没讲完」的记录。空着不编。',
  };
}

// 闭环时刻（给「会回来的卡」/年报用）：最近闭合的 N 条，只有事实——哪天开的缝，哪天你讲圆了。
function closureMoments(ledger, n = 3) {
  const L = ledger || { gaps: [] };
  return (L.gaps || [])
    .filter((g) => g.status === 'closed')
    .sort((a, b) => String(b.closedDate || '').localeCompare(String(a.closedDate || '')))
    .slice(0, Math.max(0, n))
    .map((g) => ({ label: g.label, firstDate: g.firstDate, closedDate: g.closedDate, daysOpen: daysBetween(g.firstDate, g.closedDate) }));
}

module.exports = { buildLedger, closureMoments, daysBetween };
