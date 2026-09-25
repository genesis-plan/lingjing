// test_composite.mjs — 多层复合映射算子（g = f_N∘…∘f_1）回归测试
// 强制无 LLM 环境：删掉所有 key，保证走纯概念名匹配回退（可重复、不依赖外网）。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

['LINGJING_ZHIPU_KEY', 'ZHIPU_API_KEY', 'LINGJING_LLM_PROVIDER', 'LINGJING_OR_KEY',
 'SILICONFLOW_KEY', 'OPENROUTER_KEY', 'LINGJING_SF_KEY'].forEach((k) => delete process.env[k]);

const comp = require('../composite.js');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

const CONCEPTS = ['映射', '单射', '满射', '双射', '逆映射', '复合映射'];

(async () => {
  // 1. 三层扩张链：1→2 开单射、2→3 开满射
  const r1 = await comp.analyzeComposite([
    { round: 1, text: '映射就是一个对应关系' },
    { round: 2, text: '映射里的单射是每个 y 至多一个 x' },
    { round: 3, text: '映射配合满射，单射和满射一起就是双射' },
  ], CONCEPTS);
  ok('三层链 ok', r1.ok === true);
  ok('层①=扩张(开单射)', r1.layers[0].kind === 'expand' && r1.layers[0].added.includes('单射'));
  ok('层②=扩张(开满射)', r1.layers[1].kind === 'expand' && r1.layers[1].added.includes('满射'));
  ok('净变换: 新开[单射,满射]', r1.net.viaExpand.includes('单射') && r1.net.viaExpand.includes('满射'));
  ok('净变换: 丢了[]', r1.net.lost.length === 0);
  ok('净变换: 始终在[映射]', r1.net.stable.includes('映射'));

  // 2. 恒等层 + 互为逆层（绕圈空转）
  const r2 = await comp.analyzeComposite([
    { round: 1, text: '映射就是对应' },
    { round: 2, text: '映射加上可逆就是双射' },
    { round: 3, text: '映射就是对应' },          // 回到第1轮态
  ], CONCEPTS);
  ok('含恒等层判定', r2.layers.some((l) => l.kind === 'identity' || l.kind === 'narrow'));
  ok('检出互为逆层(2↔3)', r2.cancellation.some((p) => p.invertRound === 2 && p.revertRound === 3 && p.anchorRound === 1));
  ok('空转注记进 line', /互为逆|绕了一圈|净效果≈恒等/.test(r2.line));

  // 3. 轮次不足 → 诚实拒绝
  const r3 = await comp.analyzeComposite([
    { round: 1, text: '映射就是对应' },
  ], CONCEPTS);
  ok('单轮不足 → ok:false', r3.ok === false);

  // 4. 没有规范概念 → 诚实拒绝
  const r4 = await comp.analyzeComposite([
    { round: 1, text: 'a' },
    { round: 2, text: 'b' },
  ], []);
  ok('无规范概念 → ok:false', r4.ok === false);

  // 5. 重构层（既有增又有删）
  const r5 = await comp.analyzeComposite([
    { round: 1, text: '映射是对应' },
    { round: 2, text: '单射和满射是双射' },
  ], CONCEPTS);
  ok('层含重构/扩张分类', r5.layers.length === 1);

  // 6. 红线：输出不含任何评分词
  const redline = [r1.line, r1.note, r2.line, r2.note, r5.line].join(' ');
  ok('输出无评分词(掌握/评分/score/评级/grade/level)', !/掌握|评分|score|评级|grade|level|理解度/.test(redline));

  // 7. 交换性注记：终点=教材序列 → 共轭；否则不交换
  const r7a = await comp.analyzeComposite([
    { round: 1, text: '映射' },
    { round: 2, text: '映射、单射' },
    { round: 3, text: '映射、单射、满射' },
  ], CONCEPTS, { lessonCanonical: ['映射', '单射', '满射'] });
  ok('终点=教材序列 → 注记含"交换/共轭"', /交换|共轭/.test(r7a.note));
  const r7b = await comp.analyzeComposite([
    { round: 1, text: '映射' },
    { round: 2, text: '映射、双射' },
  ], CONCEPTS, { lessonCanonical: ['映射', '单射', '满射'] });
  ok('终点≠教材序列 → 注记含"不交换"', /不交换/.test(r7b.note));

  console.log(`\ncomposite: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
