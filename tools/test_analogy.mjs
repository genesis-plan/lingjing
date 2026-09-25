// test_analogy.mjs — 类比结构分析算子（方案1）回归测试
// 强制无 LLM 环境：删掉所有 key，保证走启发式回退（可重复、不依赖外网）。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
['LINGJING_ZHIPU_KEY', 'ZHIPU_API_KEY', 'LINGJING_LLM_PROVIDER', 'LINGJING_OR_KEY',
 'SILICONFLOW_KEY', 'OPENROUTER_KEY', 'LINGJING_SF_KEY'].forEach((k) => delete process.env[k]);

const alm = require('../analogy.js');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

// 1. detectAnalogy 命中"奶茶排队"类比
const d = alm.detectAnalogy('排队买奶茶，队伍是A，奶茶是B，同款奶茶有两个人拿');
ok('detectAnalogy 命中奶茶排队类比', d.isAnalogy === true && d.cues.length > 0);

// 2. 纯定义复述不被误判为类比
const d2 = alm.detectAnalogy('映射是集合A到B的对应，每个元素唯一确定');
ok('纯定义复述不被判为类比', d2.isAnalogy === false);

// 2b. 数学术语「原像」里的"像"不能误触发（真实 bug：单字 cue 误命中）
const d3 = alm.detectAnalogy('单射是一个原像只对应一个像');
ok('数学术语"原像"不误判为类比', d3.isAnalogy === false);

(async () => {
  // 3. 启发式能指出"同款/两个人"破坏唯一确定（映射课真实回答场景）
  const res = await alm.analyzeAnalogMapping({
    rounds: [{ round: 1, text: '排队买奶茶，队伍是A，奶茶是B，同款奶茶有两个人拿' }],
    targetConcept: '映射',
    lessonContent: '',
  });
  ok('无 LLM 时返回 found=true', res.found === true);
  ok('启发式指出"同款/两个人"破坏唯一确定', /同款|两个人|多对一|唯一确定/.test(res.body));
  ok('无 LLM 时带字面核对注', /字面核对/.test(res.note));

  // 4. 守 A2 红线：输出不含评分词
  const bad = alm.REDLINE_WORDS.filter((w) => res.body.includes(w));
  ok('输出不含 A2 红线词（掌握/评分/对错…）', bad.length === 0);

  // 5. 无类比时不谎报
  const res2 = await alm.analyzeAnalogMapping({
    rounds: [{ round: 1, text: '映射是集合之间的对应，每个元素唯一确定' }],
    targetConcept: '映射',
  });
  ok('无类比时 found=false（不谎报）', res2.found === false);

  // 6. 空输入安全
  const res3 = await alm.analyzeAnalogMapping({});
  ok('空输入不崩', res3.found === false);

  // 7. 多轮：一轮类比、一轮非类比，只照有类比的轮
  const res4 = await alm.analyzeAnalogMapping({
    rounds: [
      { round: 1, text: '映射就是对应' },
      { round: 2, text: '好比排队买奶茶，两个人拿到同款' },
    ],
    targetConcept: '映射',
  });
  ok('多轮只照有类比的轮（found=true）', res4.found === true);
  ok('多轮报告里含第2轮、不含第1轮', /第2轮/.test(res4.body) && !/第1轮/.test(res4.body));

  console.log(`\nanalogy: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
