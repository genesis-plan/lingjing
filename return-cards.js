'use strict';
// 会回来的卡 return-cards：你没答上的问题，隔天回来找你；你答到了，它变成账本里的闭环时刻。
// 对打「知识坟场」：flomo 是 AI 挑旧笔记给你看，这里是**你自己留下的问题回来找你**。
//
// 四条硬约束（与 share-card / blindspot-ledger 同源）：
//   A1 只用可观测事实 —— 卡片只来自镜子问过、你没答的追问（probes 无 answer）；
//                        uncovered 派生问题沿用 takeawayQuestion 的固定句式。
//   A2 判定权归人      —— 回卡只有二元自判「答到了 / 还没」，绝无 AI 评分、绝无分数等级。
//                        「还没」不惩罚、不清零羞辱：明天再来一次。
//   A3 append-only     —— recordAnswer 返回新队列，绝不改写入参；作答记录只追加。
//   A4 诚实降级        —— 无卡 ⇒ 空队列 + 说明；不编造问题。
//
// 调度（确定性，无随机无 AI）：「答到了」 streak+1，间隔 3/7/14/30/60 天递进；
//                              「还没」 明天再来；问题在同一课里再次未答 ⇒ 保持明天。

function norm(s) { return String(s || '').trim(); }
function normKey(s) { return norm(s).replace(/\s+/g, ''); }

function addDays(dateStr, n) {
  if (!dateStr) return dateStr;
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d)) return dateStr;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// LEVELS[streak-1]：第 1 次答到 → 3 天后回访，第 2 次 → 7 天……封顶 60 天。
const LEVELS = [3, 7, 14, 30, 60];

// 从一次课的 result 收集候选卡（key 与盲区账本同命名空间：'Q::'+normKey）
function collectCards(result, date) {
  const r = (result || {});
  const probes = Array.isArray(r.probes) ? r.probes : [];
  const uncovered = (Array.isArray(r.uncovered) ? r.uncovered : []).map(norm).filter(Boolean);
  const out = [];
  for (const p of probes) {
    const text = norm(p && (p.say || p.text || p.prompt));
    if (!text || p.answer) continue;
    out.push({ key: 'Q::' + normKey(text), question: text, kind: 'probe' });
  }
  for (const u of uncovered) {
    const q = `「${u}」你提到了，但没再往下讲——它卡在哪一步？`;
    const key = 'Q::' + normKey(q);
    if (!out.some((c) => c.key === key)) out.push({ key, question: q, kind: 'derived' });
  }
  return out.map((c) => ({ ...c, date: norm(date) }));
}

// 折叠多节课 → 队列（append-only；不改动入参；同课重复未答保持「明天」）
function buildQueue(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  const ordered = list
    .map((raw, idx) => ({ raw, idx }))
    .sort((a, b) => String((a.raw && a.raw.date) || '').localeCompare(String((b.raw && b.raw.date) || '')));
  const map = new Map();
  for (const { raw } of ordered) {
    const date = norm(raw && raw.date);
    for (const c of collectCards(raw && raw.result, date)) {
      const g = map.get(c.key);
      if (!g) {
        map.set(c.key, {
          id: c.key, question: c.question, kind: c.kind,
          firstAsked: date, dueDate: addDays(date, 1), streak: 0, answers: [],
        });
      } else if (date && date > (g.firstAsked || '')) {
        // 后来又碰到同一枚仍未答 ⇒ 仍保持尽快回来（明天）
        g.dueDate = addDays(date, 1);
      }
    }
  }
  return { cards: [...map.values()], honestEmpty: map.size ? null : '队列为空：还没有留下的追问。空着不编。' };
}

// 回卡自判（A2 二元）：said='yes'（答到了）| 'no'（还没）。返回新队列，不改入参（A3）。
function recordAnswer(queue, id, { date, said } = {}) {
  const q = queue || { cards: [] };
  const d = norm(date);
  const cards = q.cards.map((c) => {
    if (c.id !== id) return c;
    const yes = said === 'yes';
    const streak = yes ? c.streak + 1 : c.streak;
    const interval = yes ? LEVELS[Math.min(streak - 1, LEVELS.length - 1)] : 1;
    return {
      ...c,
      streak,
      dueDate: addDays(d, interval),
      answers: [...c.answers, { date: d, said: yes ? 'yes' : 'no' }],   // 只追加
    };
  });
  return { cards, honestEmpty: cards.length ? null : '队列为空。' };
}

// 今天到期的卡（按最早提出优先）
function dueCards(queue, { today } = {}) {
  const t = norm(today);
  return (queue && Array.isArray(queue.cards) ? queue.cards : [])
    .filter((c) => c.dueDate && (!t || c.dueDate <= t))
    .sort((a, b) => String(a.firstAsked).localeCompare(String(b.firstAsked)));
}

// 已答到的卡 → 账本闭环时刻的事实来源（与 blindspot-ledger 的 closureMoments 同构衔接）
function closureFacts(queue, n = 3) {
  return (queue && Array.isArray(queue.cards) ? queue.cards : [])
    .filter((c) => c.answers.some((a) => a.said === 'yes'))
    .sort((a, b) => {
      const la = a.answers.filter((x) => x.said === 'yes').pop();
      const lb = b.answers.filter((x) => x.said === 'yes').pop();
      return String(lb && lb.date).localeCompare(String(la && la.date));
    })
    .slice(0, Math.max(0, n))
    .map((c) => {
      const last = c.answers.filter((x) => x.said === 'yes').pop();
      return { question: c.question, firstAsked: c.firstAsked, closedDate: last.date, streak: c.streak };
    });
}

module.exports = { collectCards, buildQueue, recordAnswer, dueCards, closureFacts, addDays, LEVELS };
