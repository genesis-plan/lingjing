// tools/test_conjugacy.mjs — 拓扑共轭应用（conjugacy.js）回归
// 运行：node tools/test_conjugacy.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const conj = require('../conjugacy.js');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  ' + extra : '')); }
}

// 评分红线词（守 A2）：任何输出都不得出现
const BAN = ['掌握', '掌握度', '理解度', '评分', '评级', '得分', 'grade', 'score', 'level', '你错了', '你答错'];
function noScore(s) {
  const t = String(s || '');
  return !BAN.some((w) => t.includes(w));
}

console.log('— 拓扑共轭 —');

// 1. 学生轨迹与教材顺序一致 ⇒ 共轭
{
  const lesson = ['映射', '单射', '满射', '双射'];
  const rounds = [['映射'], ['单射'], ['满射'], ['双射']];
  const r = conj.analyzeConjugacy(rounds, lesson);
  ok('顺序一致 ⇒ 共轭', r.ok && r.conjugate === true, JSON.stringify(r.studentTraj));
  ok('共轭输出守 A2', noScore(r.line) && noScore(r.note));
}

// 2. 学生轨迹是教材的逆序 ⇒ 仍共轭（仅重标号）
{
  const lesson = ['映射', '单射', '满射', '双射'];
  const rounds = [['双射'], ['满射'], ['单射'], ['映射']];
  const r = conj.analyzeConjugacy(rounds, lesson);
  ok('逆序 ⇒ 仍共轭（仅重标号）', r.ok && r.conjugate === true, JSON.stringify(r.studentTraj));
}

// 3. 学生漏掉一个概念（结构不同）⇒ 不共轭
{
  const lesson = ['映射', '单射', '满射', '双射'];
  const rounds = [['映射'], ['单射'], ['双射']]; // 跳过 满射
  const r = conj.analyzeConjugacy(rounds, lesson);
  ok('漏概念 ⇒ 不共轭', r.ok && r.conjugate === false);
  ok('不共轭输出守 A2', noScore(r.line) && noScore(r.note));
}

// 4. 学生多绕一个教材没有的概念 ⇒ 不共轭
{
  const lesson = ['映射', '单射'];
  const rounds = [['映射'], ['单射'], ['复合']]; // 复合 不在教材脉络
  const r = conj.analyzeConjugacy(rounds, lesson);
  ok('多概念 ⇒ 不共轭', r.ok && r.conjugate === false);
}

// 5. 空输入 ⇒ 诚实拒绝
{
  const r1 = conj.analyzeConjugacy([], ['映射', '单射']);
  const r2 = conj.analyzeConjugacy([['映射']], []);
  ok('学生空 ⇒ 拒绝(ok:false)', r1.ok === false);
  ok('教材空 ⇒ 拒绝(ok:false)', r2.ok === false);
}

// 6. graphSignature 对重标号稳定（逆序同签名）
{
  const s1 = conj.graphSignature(['A', 'B', 'C']);
  const s2 = conj.graphSignature(['C', 'B', 'A']);
  ok('graphSignature 逆序不变', s1 === s2, `${s1} == ${s2}`);
  const s3 = conj.graphSignature(['A', 'B']);
  ok('graphSignature 结构不同则不同', s1 !== s3);
}

console.log(`\nconjugacy: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
