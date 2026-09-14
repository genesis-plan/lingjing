// journal.mjs 单测：跨课个人知识库 + FSRS DSR 调度
// 重点：① DSR 三个函数要**自洽**（排的期与实际回忆概率对得上）
//       ② 交错队列真的交错（相邻卡不同主题），不是嘴上说说
//       ③ 跨课累积真的累积，不是每次重来
import {
  retrievability, nextIntervalDays, initialStability, reviewCard, reviewQueue,
  upsertJournal, newJournal, growthLine, journalToMarkdown,
  FSRS_FACTOR, FSRS_DECAY, TARGET_RETENTION,
} from '../public/journal.mjs';

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  ✅ ' : '  ❌ ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };
const DAY = 86400000;
const now = Date.now();

console.log('【1】DSR：回忆概率 R(t, S)');
ok(Math.abs(retrievability(0, 10) - 1) < 1e-9, 't=0 时 R=1（刚复习完必然记得）');
const rAtS = retrievability(10, 10);
ok(rAtS > 0 && rAtS < 1, 't=S 时 0 < R < 1', 'R=' + rAtS.toFixed(4));
ok(retrievability(1, 10) > retrievability(30, 10), 'R 随时间单调递减');
ok(retrievability(30, 20) > retrievability(30, 5), '同样时间下，S 越大 R 越高（S 就是"能扛多久"）');
ok(Math.abs(rAtS - Math.pow(1 + FSRS_FACTOR, FSRS_DECAY)) < 1e-9, '与 FSRS 公开形式 R=(1+F·t/S)^DECAY 一致');

console.log('\n【2】排期与 R 自洽（往返一致性）');
for (const S of [0.5, 3, 30, 200]) {
  const t = nextIntervalDays(S, 0.9);
  const back = retrievability(t, S);
  ok(Math.abs(back - 0.9) < 0.005, `S=${S} 排 ${t.toFixed(1)} 天后 R 回到 0.9`, '实际 R=' + back.toFixed(4));
}
ok(nextIntervalDays(30, 0.95) < nextIntervalDays(30, 0.85), '目标留存越高 ⇒ 间隔越短（复习越频繁）');
ok(nextIntervalDays(60) > nextIntervalDays(30), 'S 越大 ⇒ 间隔越长');

console.log('\n【3】初始稳定度：难度↑则记得短');
ok(initialStability(5) > initialStability(9), '难度小(5)的卡初始 S 更大（记得久）', `S(5)=${initialStability(5)} > S(9)=${initialStability(9)}`);
ok(initialStability(2) > initialStability(9), '难度大(9)的卡初始 S 更小（记得短）');
ok(initialStability(10) > 0, '再差也有正稳定度（不会排 0 天死循环）');

console.log('\n【4】复习更新：答对则 S 长、答错则 S 退且 D 升');
const mk = () => ({ key: 'k', concept: '概念', D: 5, S: 10, EF: 2.5, reps: 0, lapses: 0, lastAt: now - 9 * DAY });
const good = reviewCard(mk(), 3, now);
const bad = reviewCard(mk(), 0, now);
ok(good.S > 10, '「轻松」→ 稳定度增长', `S: 10 → ${good.S}`);
ok(bad.S < 10, '「忘了」→ 稳定度回落', `S: 10 → ${bad.S}`);
ok(bad.D > 5, '「忘了」→ 难度上升', `D: 5 → ${bad.D}`);
ok(bad.lapses === 1, '「忘了」计入 lapses');
ok(good.dueAt > now && good.dueAt <= now + 400 * DAY, '排出下一次到期时间');
ok([0, 1, 2, 3].every((r) => { const c = reviewCard(mk(), r, now); return c.S > 0 && c.dueAt > now; }), '四档评分都能排出合法的下次时间');

console.log('\n【5】跨课累积：同一概念跨课去重合并');
let j = newJournal('测试者');
const mkDeck = (topic, concept, diff) => ({ cards: [{ concept, difficulty: diff, front: 'Q', back: 'A' }] });
const r1 = upsertJournal(j, { topic: '光合作用', at: now - 10 * DAY, deck: mkDeck('光合作用', '阳光是能量来源', 5) });
j = r1.journal;
ok(r1.added === 1 && j.cards.length === 1, '第一课：新增 1 张卡');
const r2 = upsertJournal(j, { topic: '细胞呼吸', at: now, deck: mkDeck('细胞呼吸', '阳光是能量来源', 5) });
j = r2.journal;
ok(r2.added === 0 && r2.refreshed === 1 && j.cards.length === 1, '第二课讲到同一概念 → 合并而不是新增',
  `cards=${j.cards.length} refreshed=${r2.refreshed}`);
ok(Array.isArray(j.cards[0].gradeHistory) && j.cards[0].gradeHistory.length === 0, '新概念尚未复习 → 评分历史为空（等你来填，不自动编）');
ok(j.topics.length === 2, '两个课题都被记下', 'topics=' + j.topics.length);
ok(j.cards[0].reps === 1, '复课等于一次成功回忆，计入 reps');

console.log('\n【6】交错复习队列');
const jj = { version: 1, owner: 'x', createdAt: now, updatedAt: now, topics: [], cards: [] };
for (const [t, pref] of [['课题A', 'A'], ['课题B', 'B']]) {
  for (let i = 0; i < 3; i++) {
    jj.cards.push({
      key: pref + i, concept: pref + '概念' + i, D: 5, S: 10, EF: 2.5,
      reps: 1, lapses: 0, lastAt: now - 20 * DAY,
      dueAt: now - (5 - i) * DAY, firstTopic: t,
    });
  }
}
const q = reviewQueue(jj, now);
ok(q.interleaved.length === 6, '6 张到期卡都在队列里', 'len=' + q.interleaved.length);
let adjacentSame = 0;
for (let i = 1; i < q.interleaved.length; i++) if (q.interleaved[i].topic === q.interleaved[i - 1].topic) adjacentSame++;
ok(adjacentSame === 0, '相邻卡片来自不同课题（真的交错，不是简单排序）', '相邻同主题次数=' + adjacentSame);
let rAsc = true;
for (let i = 1; i < q.due.length; i++) if (q.due[i].R < q.due[i - 1].R - 1e-9) rAsc = false;
ok(rAsc, 'due 列表按"最快会忘"（R 升序）排');
ok(q.stats.memoryAssetDays > 0 && q.stats.dueCount === 6, '统计量正确', JSON.stringify(q.stats));
ok(q.upcoming.length === 0, '没有未到期的卡时 upcoming 为空');

console.log('\n【7】成长叙事 + Markdown');
j = upsertJournal(j, { topic: '光合作用', at: now, deck: { cards: [{ concept: '叶子发黄的原因', difficulty: 4 }] } }).journal;
const g = growthLine(j, now);
ok(g.metrics.cards === 2 && g.metrics.topics === 2, '叙事统计：2 概念 / 2 课题', JSON.stringify(g.metrics));
ok(/个概念|记忆值/.test(g.text), '叙事是事实陈述', g.text.slice(0, 40) + '…');
ok(!/你真棒|加油|再不|就白学|必须/.test(g.text), '无夸奖话术、无恐吓催促（不做暗黑模式）');
const md = journalToMarkdown(j, now);
ok(md.includes('# 我的知识库') && md.includes('难度 D'), 'Markdown 成文', md.length + ' 字');
ok(/简化骨架|不是 FSRS 17 参数/.test(md), '诚实标注：说明这是简化实现，不宣称达到 FSRS 基准');

console.log('\n【8】边界：空库不炸');
const empty = newJournal();
ok(reviewQueue(empty, now).interleaved.length === 0, '空库队列为空');
ok(growthLine(empty, now).metrics.cards === 0, '空库成长叙事给出"还没积累"而不是编数据');
ok(upsertJournal(null, { topic: 't', deck: { cards: [] } }).journal.cards.length === 0, '传入 null 也能自愈成空库');

console.log('\n' + (fails ? fails + ' 项未通过 ❌' : '全部通过 ✅'));
process.exit(fails ? 1 : 0);
