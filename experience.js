/**
 * 灵境 · 经验持久存储（ExperienceStore）
 * ============================================================================
 * 机器人学到的规律 = 它自己的经验：一个持久信念 μ±δ（区间律）与已积累的
 * 证据量 nObs，跨会话/跨进程落盘成单个 JSON 文件。
 *
 *  - state()   返回 {nObs, mu, delta, band}（band=μ±δ 上下界 = 机器人"承认的
 *              不知道"范围；nObs=0 时 delta/band 为 null —— 诚实：还没学过）。
 *  - absorb()  新交互来了，精度加权融合新证据（nObs 大=可信）；新旧冲突时
 *              δ 放大 = 承认"我可能错了"（这是 adapt_loop.py 的核心语义）。
 *  - save()    落盘；load() 在 constructor 自动做（文件存在时）。
 *
 * absorb() 的数学与 adapt_loop.py 的 Experience.absorb 逐位一致（IEEE754
 * double 四则，双轨可对照）：μ 按 n 加权平均；δ 取 pooled 方差与新旧冲突
 * |newμ−fitμ| 的逐分量较大者。
 *
 * 文件格式：{schema:1, mu:[4], delta:[4]|null, nObs:int}；delta=null ⇔ 空经验。
 * 损坏文件 fail-closed：抛错（不静默清零 —— 否则重启会让机器人误以为
 * 自己从未学过）。
 * 零外部依赖。
 */
'use strict';

const fs = require('fs');

const DIM = 4; // 基 [1/r², 1/r, 1, 1/r³]

function checkFiniteVec(x, name, len) {
  if (!Array.isArray(x) || x.length !== len || x.some(v => typeof v !== 'number' || !isFinite(v))) {
    throw new Error(name + ' 需为 ' + len + ' 个有限数的数组');
  }
  return x.slice();
}

class ExperienceStore {
  /**
   * @param {string} filePath 经验文件路径（不存在 = 从空经验开始，首次 absorb 后 save 即创建）
   */
  constructor(filePath) {
    this.path = filePath;
    this.mu = [0, 0, 0, 0];
    this.delta = null;   // null ⇔ 空经验（nObs=0）；JSON 无法存 Infinity，用 null 表达"未知"
    this.nObs = 0;
    if (fs.existsSync(filePath)) this.load();
  }

  load() {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(this.path, 'utf8')); }
    catch (e) { throw new Error('经验文件损坏（无法解析 JSON）: ' + this.path + ' ← ' + e.message); }
    const mu = checkFiniteVec(raw.mu, 'mu', DIM);
    let delta = null, nObs = 0;
    if (raw.delta != null) {
      delta = checkFiniteVec(raw.delta, 'delta', DIM);
      if (delta.some(v => v < 0)) throw new Error('delta 含负值（经验文件损坏）: ' + this.path);
    }
    if (!Number.isInteger(raw.nObs) || raw.nObs < 0) {
      throw new Error('nObs 需为非负整数（经验文件损坏）: ' + this.path);
    }
    nObs = raw.nObs;
    if (nObs === 0 && delta !== null) delta = null;      // 空经验：统一 delta=null
    if (nObs > 0 && delta === null) {
      throw new Error('nObs>0 但 delta 缺失（经验文件损坏）: ' + this.path);
    }
    this.mu = mu; this.delta = delta; this.nObs = nObs;
  }

  /** 当前经验（机器可读）。nObs=0 → delta/band=null（还没学过，诚实）。 */
  state() {
    const s = { nObs: this.nObs, mu: this.mu.slice() };
    if (this.delta === null) {
      s.delta = null;
      s.band = null;
      s.note = '空经验：还没有吸收过任何一次观察（先 law_learn 再 experience_absorb）。';
    } else {
      s.delta = this.delta.slice();
      s.band = {
        lo: this.mu.map((x, i) => x - this.delta[i]),
        hi: this.mu.map((x, i) => x + this.delta[i])
      };
      s.note = '经验律 μ=band 中点，δ=不确定度（split-half 统计半宽 + 冲突放大）；' +
        '只含统计性不确定，不含候选基可辨识性的系统偏差（见 law_learn.note）。';
    }
    return s;
  }

  /**
   * 融合一次新交互的证据（与 adapt_loop.py Experience.absorb 逐位一致）。
   * @param {number[]} fitMu    新学出的律（law_learn 的 mu）
   * @param {number[]} fitDelta 新学出的不确定（law_learn 的 delta；可全 0）
   * @param {number}   n        本次证据量（= 该次拟合用的轨迹点数，n 大=可信）
   */
  absorb(fitMu, fitDelta, n) {
    fitMu = checkFiniteVec(fitMu, 'mu', DIM);
    fitDelta = checkFiniteVec(fitDelta, 'delta', DIM);
    if (fitDelta.some(v => v < 0)) throw new Error('delta 需为非负数');
    if (!Number.isInteger(n) || n < 1) throw new Error('nObs 需为正整数（该次拟合的轨迹点数）');
    if (this.nObs === 0) {
      this.mu = fitMu;
      this.delta = fitDelta;
      this.nObs = n;
      return;
    }
    const tot = this.nObs + n;
    const newMu = this.mu.map((x, i) => (this.nObs * x + n * fitMu[i]) / tot);
    const pooled = this.delta.map((d, i) => Math.sqrt((this.nObs * d * d + n * fitDelta[i] * fitDelta[i]) / tot));
    const conflict = newMu.map((x, i) => Math.abs(x - fitMu[i]));
    this.mu = newMu;
    this.delta = pooled.map((d, i) => Math.max(d, conflict[i]));   // 冲突 → 放大 δ（承认不确定）
    this.nObs = tot;
  }

  save() {
    const out = { schema: 1, mu: this.mu, delta: this.delta, nObs: this.nObs };
    fs.writeFileSync(this.path, JSON.stringify(out, null, 1));
  }
}

module.exports = ExperienceStore;
