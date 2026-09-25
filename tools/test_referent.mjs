// test_referent.mjs — 同指识别算子（复合映射纤维/商）回归测试
// 强制无 LLM 环境：删掉所有 key，保证走词面启发式回退（可重复、不依赖外网）。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

['LINGJING_ZHIPU_KEY', 'ZHIPU_API_KEY', 'LINGJING_LLM_PROVIDER', 'LINGJING_OR_KEY',
 'SILICONFLOW_KEY', 'OPENROUTER_KEY', 'LINGJING_SF_KEY'].forEach((k) => delete process.env[k]);

const ref = require('../referent.js');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

const CONCEPTS = ['映射', '单射', '满射', '双射', '逆映射', '复合映射'];

(async () => {
  // 1. 不同表达指同一概念（对应 / 映射 / 函数也是一种映射 都 → 映射）
  const r1 = await ref.referentCluster([
    { source: '你', round: 1, text: '映射就是对应，一个x对应唯一y' },
    { source: '你', round: 3, text: '函数其实也是一种映射，只是换了个名字' },
  ], CONCEPTS);
  ok('不同说法(对应/映射)被识别为同指', r1.ok && r1.clusters.some((c) => c.concept === '映射' && c.expressions.length === 2));

  // 2. 同义转述：一一对应 / 双射 都 → 双射
  const r2 = await ref.referentCluster([
    { source: '你', round: 1, text: '这就是一一对应' },
    { source: '你', round: 2, text: '双射就是可逆的，满单射' },
  ], CONCEPTS);
  ok('一一对应与双射被识别为同指', r2.ok && r2.clusters.some((c) => c.concept === '双射'));

  // 3. 轮数不足 → 诚实拒绝
  const r3 = await ref.referentCluster([
    { source: '你', round: 1, text: '映射就是对应' },
  ], CONCEPTS);
  ok('单轮不足 → ok:false', r3.ok === false);

  // 4. 没有规范概念 → 诚实拒绝
  const r4 = await ref.referentCluster([
    { source: '你', round: 1, text: 'a' },
    { source: '你', round: 2, text: 'b' },
  ], []);
  ok('无规范概念 → ok:false', r4.ok === false);

  // 5. 同文本重复 → 不算"不同表达"，不聚类
  const r5 = await ref.referentCluster([
    { source: '你', round: 1, text: '映射就是对应' },
    { source: '你', round: 2, text: '映射就是对应' },
  ], CONCEPTS);
  ok('相同文本不谎报同指簇', r5.ok === true && r5.clusters.length === 0);

  // 6. 红线：输出不含任何评分词
  const redline = [r1.line, r1.note, r2.line, r5.line].join(' ');
  ok('输出无评分词(掌握/评分/score/评级/grade/level)', !/掌握|评分|score|评级|grade|level|理解度/.test(redline));

  // 7. 跨体验者：不同 source 也能归并同指
  const r7 = await ref.referentCluster([
    { source: '甲', round: 1, text: '映射就是对应' },
    { source: '乙', round: 1, text: '函数也是一种映射' },
  ], CONCEPTS);
  ok('跨体验者同指识别', r7.ok && r7.clusters.some((c) => c.concept === '映射' && c.expressions.length === 2));

  console.log(`\nreferent: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
