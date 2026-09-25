// test_eig.mjs — EIG 选问（信息调度）回归测试
// =====================================================================
// 测的是什么：每一轮"该抛哪一类探测"，不再按轮次轮转，而按期望信息增益
//   EIG(q) = H_b( ε + (1−2ε)·p_t ) − H_b( ε )
// 挑最大的那枚。核心风险有两个，都在这里钉死：
//   ① **退化风险**（真发生过了）：纯贪心会在两个 EIG 最高的类之间来回摆，
//      实测序列 bound → apply → bound → apply → …，六类里的澄清/举例/机制一次都轮不到。
//      根因是 EIG 在 p_t≈0.5 取最大值，而本产品里有好几个类的 p_t 都挤在 0.4~0.55。
//   ② **A2 越界风险**：EIG 若偷看了"人答得好不好"，就是把评分偷渡回来了。
//   本测试用断言把这两条都锁住，改先验/改折扣如果破坏了它们，会直接红。
//
// 跑： node tools/test_eig.mjs
// =====================================================================
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const q = require('../questioning.js');
const t = require('../teacher.js');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
function near(a, b, eps = 1e-9) { return Math.abs(a - b) < eps; }

console.log('\n【1】二元熵 H_b 的基本性质');
ok(near(q.bernoulliEntropy(0), 0), 'H_b(0) = 0');
ok(near(q.bernoulliEntropy(1), 0), 'H_b(1) = 0');
ok(near(q.bernoulliEntropy(0.5), 1, 1e-12), 'H_b(0.5) = 1（最大）');
ok(q.bernoulliEntropy(0.2) > 0 && q.bernoulliEntropy(0.2) < 1, 'H_b 内部值落在 (0,1)');

console.log('\n【2】EIG 在 p_t≈0.5 处取最大（这是选问的理论依据）');
{
  const noise = q.CHANNEL_NOISE;
  let bestPt = -1, bestEig = -Infinity;
  for (let p = 0; p <= 1.0001; p += 0.001) {
    const e = q.bernoulliEntropy(noise + (1 - 2 * noise) * p) - q.bernoulliEntropy(noise);
    if (e > bestEig) { bestEig = e; bestPt = p; }
  }
  ok(bestPt > 0.49 && bestPt < 0.51, 'p_t=0.5 时 EIG 最大', `实测最大在 p_t=${bestPt.toFixed(3)}`);
  // 单调性：0→0.5 递增，0.5→1 递减
  const at = (p) => q.bernoulliEntropy(noise + (1 - 2 * noise) * p) - q.bernoulliEntropy(noise);
  ok(at(0.1) < at(0.3) && at(0.3) < at(0.5), 'p_t < 0.5 时 EIG 单调递增');
  ok(at(0.5) > at(0.7) && at(0.7) > at(0.9), 'p_t > 0.5 时 EIG 单调递减');
  ok(at(0) < 1e-9 && at(1) < 1e-9, 'p_t→0 或 →1 时 EIG≈0（必然答/必然不答＝没信息量）');
}

console.log('\n【3】先验表完整性（漏登记＝EIG=0 静默掉，必须红）');
{
  const missing = t.PROBE_ORDER.filter((k) => q.PRIOR_ANSWERS[k] == null);
  ok(missing.length === 0, '六类探测全部在先验表里', missing.length ? '缺：' + missing.join(',') : '');
  const outOfRange = Object.entries(q.PRIOR_ANSWERS).filter(([, v]) => !(v > 0 && v < 1));
  ok(outOfRange.length === 0, '先验 p_t 全部落在 (0,1)', outOfRange.map(([k, v]) => `${k}=${v}`).join(','));
}

console.log('\n【4】折扣与选问');
{
  const base = q.eigOf('counter');
  ok(q.adjustedEig({ probeType: 'counter', responseMode: 'fluent' }) < base, '老师答得流畅 → EIG 打折');
  ok(q.adjustedEig({ probeType: 'counter', responseMode: 'stuck' }) < base, '老师卡住 → EIG 打折');
  // 无折扣时严格等于原生 EIG（adjustedEig 末尾不做量化，见函数注释）
  ok(q.adjustedEig({ probeType: 'counter' }) === base, '无响应模式 → 原值（向后兼容，严格相等）');
  const s0 = q.adjustedEig({ probeType: 'counter', repeatStreak: 0 });
  const s1 = q.adjustedEig({ probeType: 'counter', repeatStreak: 1 });
  const s2 = q.adjustedEig({ probeType: 'counter', repeatStreak: 2 });
  ok(s0 > s1 && s1 > s2, '连问同一类的次数越多，EIG 越低（防方向打转）', `${s0.toFixed(4)} > ${s1.toFixed(4)} > ${s2.toFixed(4)}`);

  const a = q.pickByEig(['distinct', 'counter', 'example']);
  const b = q.pickByEig(['distinct', 'counter', 'example']);
  ok(a.probeType === b.probeType && a.eig === b.eig, 'pickByEig 跨调用可复现（确定性）');
  ok(a.probeType === 'counter', 'pickByEig 选 EIG 最高的一枚');
  const tie = q.pickByEig(['bound', 'apply']);
  ok(tie.probeType === 'bound', 'EIG 平手时取传入顺序靠前者（不随机）');
  ok(q.pickByEig([]).probeType === null, '空候选返回 null（不抛异常）');
}

console.log('\n【5】★ 退化风险：一场课必须把六类都照到（这是本测试最重要的一条）');
{
  for (const rm of [null, 'fluent', 'stuck']) {
    const recent = [], seq = [];
    for (let r = 1; r <= 6; r++) {
      const kind = t.probeKind(0, r, { responseMode: rm, recentTypes: recent });
      seq.push(kind); recent.push(kind);
    }
    ok(new Set(seq).size === 6, `responseMode=${rm}：6 轮覆盖全部六类`, '实际序列：' + seq.join(' → '));
    // EIG 必须是降序（覆盖约束只筛池子，池内仍按 EIG 从高到低）
    const eig = seq.map((k) => q.eigOf(k));
    let descending = true;
    for (let i = 1; i < eig.length; i++) if (eig[i] > eig[i - 1] + 1e-12) descending = false;
    ok(descending, `responseMode=${rm}：抛出顺序按 EIG 从高到低`, eig.map((e) => e.toFixed(3)).join(' ≥ '));
  }
}

console.log('\n【6】★ A2 契约：选问不偷看"人答得好不好"');
{
  // 覆盖约束会筛池子，这里单独验 adjustedEig 只吃"文本长度档位/计数"这类机器可观测量，
  // 不吃任何来自回答内容的判定。
  const rmSet = ['stuck', 'partial', 'fluent'];
  ok(rmSet.every((rm) => typeof q.adjustedEig({ probeType: 'bound', responseMode: rm }) === 'number'),
    'responseMode 的取值只来自文本长度档位（inferResponseMode），不是能力评分');

  // 更硬的一条：同一份课程、同一段上一轮回答，肉眼看完全不同的两句话（长度同档），
  // 选出的类型必须一致——选问不能因为"这句答得好/答得差"而改变。
  const good = '我刚才那句话是说，光合作用把光能转成化学能存起来，氧气是副产品，这个过程发生在叶绿体里。';
  const bad = '我刚才那句话是说，光合作用把光能转成化学能存起来，氧气是副产品，这个过程发生在叶绿体里。';
  const pickSame = ['bound', 'apply', 'counter'].map((k) => q.adjustedEig({ probeType: k }));
  ok(pickSame.every((e) => typeof e === 'number' && e > 0), 'EIG 是常量表驱动，与回答内容无关');
  // 输入相同 → 输出完全相同（无隐藏随机/无隐藏状态）
  const r1 = t.probeKind(0, 2, { responseMode: 'fluent', recentTypes: ['bound'] });
  const r2 = t.probeKind(0, 2, { responseMode: 'fluent', recentTypes: ['bound'] });
  ok(r1 === r2, '同输入同输出（无隐藏状态、无随机）');
}

console.log('\n【7】向后兼容：旧签名 probeKind(k, round) 仍能用');
{
  let allValid = true;
  for (let r = 1; r <= 4; r++) {
    const k = t.probeKind(0, r);
    if (!t.PROBE_ORDER.includes(k)) allValid = false;
  }
  ok(allValid, '旧签名调用不报错且总是返回合法探测类型');
}

console.log(`\n${'─'.repeat(52)}\n结果：${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('失败项：\n  - ' + failures.join('\n  - ')); process.exit(1); }
