'use strict';
/*
 * 灵境数学框架 · 核心世界模型
 * --------------------------------------------------------------------------
 * 世界 = ⟨S, R, M, T⟩
 *   公理1: 世界 = 状态空间 + 结构（S=状态, R=关系, M=测度, T=离散时钟）
 *   公理3: 人类 = 不可计算外部输入（人类教师的内容不由引擎生成，只能被注入）
 *
 * 设计原则：
 *   - 纯结构/代数，确定性、可持久、可审计。
 *   - 物理 / 职业 / 学科 是"可插拔内容层"（见 physics.js / teaching.js），
 *     不属于世界骨架本身。
 *   - step() 的并发一致性：按 agentId 字典序确定合并，任意提交顺序得到同一世界。
 */

function newId(prefix) {
  return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 10);
}

class World {
  constructor(opts = {}) {
    this.S = new Map();   // id -> 状态对象 {id, kind, owner, state?, payload?}
    this.R = new Map();   // relationId -> {id, type, from, to, payload}
    this.M = { energy: 0, info: 0, value: 0, artifactCount: 0 }; // 测度（累计）
    this.T = 0;           // 离散时钟（tick）
  }

  // agent: {id?, kind, owner?, state?}
  addAgent(agent) {
    const a = Object.assign({ kind: 'agent', _isAgent: true }, agent);
    if (!a.id) a.id = newId('agent');
    this.S.set(a.id, a);
    this.M.info += 1;
    return a.id;
  }

  // 持久作品：教案 / 学生笔记 / 物理快照 等
  addArtifact({ owner, kind = 'artifact', payload, tick }) {
    const id = newId('art');
    const art = { id, owner, kind, payload, tick: (tick != null ? tick : this.T) };
    this.S.set(id, art);
    this.M.artifactCount += 1;
    this.M.info += JSON.stringify(payload).length * 1e-4; // 信息量代理
    return id;
  }

  addRelation(type, from, to, payload = {}) {
    const id = newId('rel');
    const rel = { id, type, from, to, payload };
    this.R.set(id, rel);
    return id;
  }

  // 并发一致性：按 agentId 字典序确定合并，保证任意顺序提交得到同一世界
  step(actions) {
    const sorted = [...actions].sort((a, b) =>
      String(a.agentId) < String(b.agentId) ? -1 :
      String(a.agentId) > String(b.agentId) ? 1 : 0);
    for (const a of sorted) {
      const agent = this.S.get(a.agentId);
      if (!agent) throw new Error('UNKNOWN_AGENT:' + a.agentId);
      if (a.payload != null) {
        // 公理3: 人类外部输入直接写入，引擎不生成
        agent.state = Object.assign({}, agent.state, a.payload);
      }
      this.T += 1;
    }
    return this.T;
  }

  measure() {
    let agents = 0;
    for (const v of this.S.values()) if (v._isAgent) agents++;
    return Object.assign({}, this.M, { T: this.T, agents, artifacts: this.M.artifactCount });
  }

  snapshot() {
    return JSON.parse(JSON.stringify({
      S: [...this.S.entries()],
      R: [...this.R.entries()],
      M: this.M,
      T: this.T,
    }));
  }

  save(path) {
    const fs = require('fs');
    fs.writeFileSync(path, JSON.stringify(this.snapshot(), null, 2));
  }

  static load(path) {
    const fs = require('fs');
    const o = JSON.parse(fs.readFileSync(path, 'utf8'));
    const w = new World();
    w.S = new Map(o.S);
    w.R = new Map(o.R);
    w.M = o.M;
    w.T = o.T;
    return w;
  }
}

module.exports = { World, newId };
