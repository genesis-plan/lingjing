'use strict';
/*
 * galois.js — 镜子即伽罗瓦连接（Galois connection）
 * ----------------------------------------------------------------------------
 * 数学根据（实查，非记忆）：
 *   FCA 的派生算子  ↑:P(G)→P(M), ↓:P(M)→P(G) 构成伽罗瓦连接：
 *     X ⊆ ↓↑(X)（扩张性），且 ↑ 反单调；复合 ↓↑、↑↓ 是闭包算子（扩张/幂等/单调）。
 *   形式概念 = (A,B) 满足 A=↓(B), B=↑(A) = 该伽罗瓦连接的【不动点】。
 *   （Basic Theorem of Formal Concept Analysis, Wille 1982；
 *    "Yoneda Philosophy in Engineering", Wiley 2013, §3）
 *
 * 产品语义（灵境 · 镜子本体）：
 *   人类"所说的关系"（一个形式背景 I⊆G×M）经伽罗瓦连接闭包后，得到形式概念。
 *   镜子照出的**盲区** = 所说开集 ≠ 其闭包 —— 你以为讲了一个点，其实牵连了一片却没说。
 *   这是把 yoneda（关系决定对象）+ tarski（闭包=不动点）+ lattice（FCA 概念格）
 *   统一到同一个构造的数学根据。
 *
 * 红线：不评分、不上权重、不臆造结论。闭包算不出就诚实拒绝。
 * 范围：本模块算"派生/闭包/单对象概念/盲区"，【不】算全概念格（指数级）；
 *      全格由 lattice.js 负责，这里只调用其思路。
 */

function intersectMany(sets) {
  // sets: 可迭代的 Set 列表，返回交集；空列表返回 null（调用方处理）
  let acc = null;
  for (const s of sets) {
    const set = s instanceof Set ? s : new Set(s);
    if (acc === null) acc = new Set(set);
    else { for (const x of [...acc]) if (!set.has(x)) acc.delete(x); }
  }
  return acc;
}

class GaloisContext {
  /**
   * @param {Object} cfg
   *   G: Array<string>           对象（如概念）
   *   M: Array<string>           属性（如概念，可 = G 做自反背景）
   *   I: Array<[string,string]>  关联 (g,m) ∈ G×M
   *   opts.out/in/up/down        可选，预计算的邻接（自反背景可从 mapmodel 构造）
   */
  constructor(cfg) {
    this.G = new Set(cfg.G);
    this.M = new Set(cfg.M);
    this.up = {};   // up[g] = Set(m) : g 拥有（指向/关联）的属性
    this.down = {}; // down[m] = Set(g) : 拥有该属性的对象
    for (const g of this.G) this.up[g] = new Set();
    for (const m of this.M) this.down[m] = new Set();
    for (const [g, m] of cfg.I) {
      if (!this.G.has(g) || !this.M.has(m)) continue;
      this.up[g].add(m);
      this.down[m].add(g);
    }
    // 若调用方已给自反邻接（fromMapModel），覆盖之
    if (cfg.up) for (const g of Object.keys(cfg.up)) if (this.G.has(g)) this.up[g] = new Set(cfg.up[g]);
    if (cfg.down) for (const m of Object.keys(cfg.down)) if (this.M.has(m)) this.down[m] = new Set(cfg.down[m]);
  }

  /** ↑(X) = { m∈M | ∀g∈X, gIm } —— X 中对象共有的属性（交集） */
  deriveUp(X) {
    const xs = X instanceof Set ? X : new Set(X);
    if (xs.size === 0) return new Set(this.M); // 空集的像 = 全属性（伽罗瓦连接约定）
    const common = intersectMany([...xs].map((g) => this.up[g] || new Set()));
    return common || new Set();
  }

  /** ↓(Y) = { g∈G | ∀m∈Y, gIm } —— 拥有 Y 中全部属性的对象（交集） */
  deriveDown(Y) {
    const ys = Y instanceof Set ? Y : new Set(Y);
    if (ys.size === 0) return new Set(this.G);
    const common = intersectMany([...ys].map((m) => this.down[m] || new Set()));
    return common || new Set();
  }

  /** Extent 闭包 ↓↑(X) */
  closureExtent(X) { return this.deriveDown(this.deriveUp(X)); }
  /** Intent 闭包 ↑↓(Y) */
  closureIntent(Y) { return this.deriveUp(this.deriveDown(Y)); }

  /**
   * 单对象概念（对象概念）：给定 g，返回 (extent, intent) = (↓↑{g}, ↑{g})。
   * intent 是 g 直接拥有的属性；extent 是"与 g 共享全部这些属性"的所有对象。
   */
  objectConcept(g) {
    if (!this.G.has(g)) return null;
    const intent = this.deriveUp(new Set([g]));
    const extent = this.deriveDown(intent);
    return { object: g, extent: [...extent], intent: [...intent] };
  }

  /**
   * 镜子盲区：所说 = {g}，其闭包 = closureExtent({g})。
   * 盲区 = 闭包中除自己、且自己没直接陈述连接的概念。
   * 这是"你以为讲了一个点，其实牵连了一片却没说"的定量表述。
   * @param {string} g
   * @param {Object} opts { statedFrom?: (g)=>string[] } 显式陈述的邻接（默认用 up+down 自反）
   */
  blindSpot(g, opts = {}) {
    if (!this.G.has(g)) {
      return { concept: g, ok: false, reason: '概念不在背景中', closure: [], stated: [], blind: [] };
    }
    const closure = this.closureExtent(new Set([g]));
    closure.delete(g);
    const stated = new Set(opts.statedFrom ? opts.statedFrom(g) : [...(this.up[g] || []), ...(this.down[g] || [])]);
    stated.delete(g);
    const blind = [...closure].filter((x) => !stated.has(x));
    return {
      concept: g, ok: true,
      closure: [...closure], stated: [...stated], blind,
      line: blind.length
        ? `你讲了「${g}」，但顺着你给出的关系，它其实牵连到 ${blind.join('、')}——` +
          `这些是你没明说、却已经被你的讲授结构蕴含的。镜子照出：这是你这片的盲区。`
        : `你讲的「${g}」自身已构成一个封闭概念（所说即所闭），这片没有额外牵连。`,
    };
  }

  /**
   * 伽罗瓦连接基本律自检（测试/诚实用）：
   *   (1) 扩张性 X ⊆ ↓↑(X)  (2) 幂等 ↓↑↓↑ = ↓↑  (3) 反单调 X⊆X' ⇒ ↑(X')⊆↑(X)
   * 返回 { extensive, idempotent, antimonotone } 三项布尔 + 详情。
   */
  selfCheck(samples) {
    const out = { extensive: true, idempotent: true, antimonotone: true, details: [] };
    for (const X of samples) {
      const xs = X instanceof Set ? X : new Set(X);
      const cl = this.closureExtent(xs);
      for (const x of xs) if (!cl.has(x)) { out.extensive = false; out.details.push(`扩张性破: ${x}∉↓↑X`); }
      const cl2 = this.closureExtent(cl);
      if (cl2.size !== cl.size || [...cl].some((x) => !cl2.has(x))) { out.idempotent = false; out.details.push('幂等破'); }
    }
    // 反单调：取两个有包含关系的样本
    for (let i = 0; i < samples.length; i++) {
      for (let j = 0; j < samples.length; j++) {
        const A = samples[i] instanceof Set ? samples[i] : new Set(samples[i]);
        const B = samples[j] instanceof Set ? samples[j] : new Set(samples[j]);
        if (A.size && B.size && [...A].every((x) => B.has(x)) && A.size < B.size) {
          const uA = this.deriveUp(A), uB = this.deriveUp(B);
          if (![...uB].every((m) => uA.has(m))) { out.antimonotone = false; out.details.push('反单调破'); }
        }
      }
    }
    return out;
  }
}

/**
 * 从 mapmodel 构造自反背景：G=M=概念集，I=边关系（含自反环，使每个概念"拥有自己"）。
 * 这样 ↑({g}) = g 的全部关系邻居（出+入+自身），闭包 ↓↑({g}) = 与 g 共享全部关系的概念。
 * @param {Object} model 具 concepts() / maps() 的 mapmodel 实例
 */
function fromMapModel(model) {
  const concepts = model.concepts();
  const G = [...new Set(concepts)];
  const I = [];
  const up = {}, down = {};
  for (const c of G) { up[c] = new Set([c]); down[c] = new Set([c]); } // 自反
  for (const m of model.maps()) {
    if (!up[m.from] || !up[m.to]) continue;
    up[m.from].add(m.to);
    down[m.to].add(m.from);
    I.push([m.from, m.to]);
  }
  return new GaloisContext({ G, M: [...G], I, up, down });
}

module.exports = { GaloisContext, fromMapModel, galoisNote:
  '镜子即伽罗瓦连接：closure=↓↑，概念=连接的不动点，盲区=所说≠闭包。' };
