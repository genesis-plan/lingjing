// 灵境数学框架 · 浏览器 ESM 移植版
// --------------------------------------------------------------------------
// 与 node 端 physics.js / world.js 算法保持一致（确定性、可审计、fail-closed）。
// 仅去掉了 node 专属的 fs 持久化（浏览器无 fs）。修改时务必与 physics.js / world.js 同步。
//
// 用途：让 3D 课室（classroom3d.html）真实使用咱们的数学，而不是装饰。
//   - HeatWorld3D：3D 热传导 FTCS，作为「教学的物理载体」（框架原文：物理是载体，不声称模拟真实世界）。
//   - World：世界 = ⟨S, R, M, T⟩，公理3：人类=不可计算外部输入。

function idx(x, y, z, n) { return z * n * n + y * n + x; }

// ===== 物理载体层：3D 热传导 FTCS =====
class HeatWorld3D {
  constructor({ n = 11, dx = 1, alpha = 0.1, dt = 0.1, bc = 'dirichlet' } = {}) {
    if (n % 2 === 0) throw new Error('GRID_MUST_BE_ODD'); // 唯一原点在中心
    this.n = n; this.dx = dx; this.alpha = alpha; this.dt = dt; this.bc = bc;
    const lambda = alpha * dt / (dx * dx);
    this.lambda = lambda;
    if (lambda > 1 / 6) {
      // 3D FTCS 稳定条件：λ = α·dt/dx² ≤ 1/6；超限直接拒绝（fail-closed）
      throw new Error('CFL_VIOLATION: 3D FTCS needs lambda<=1/6, got ' + lambda.toFixed(4));
    }
    this.u = new Float64Array(n * n * n);
    this.t = 0;
  }

  init(f) {
    const n = this.n, c = (n - 1) / 2;
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++)
          this.u[idx(x, y, z, n)] = f((x - c) * this.dx, (y - c) * this.dx, (z - c) * this.dx);
  }

  step() {
    const n = this.n, u = this.u, lap = this.lambda;
    const unew = Float64Array.from(u);
    for (let z = 1; z < n - 1; z++)
      for (let y = 1; y < n - 1; y++)
        for (let x = 1; x < n - 1; x++) {
          const i = idx(x, y, z, n);
          const lapU =
            u[idx(x + 1, y, z, n)] + u[idx(x - 1, y, z, n)] +
            u[idx(x, y + 1, z, n)] + u[idx(x, y - 1, z, n)] +
            u[idx(x, y, z + 1, n)] + u[idx(x, y, z - 1, n)] - 6 * u[i];
          unew[i] = u[i] + lap * lapU;
        }
    this.u = unew; this.t += this.dt;
  }

  // 在中心注入一团"能量"（老师讲解 = 把注意力/能量注入课室场）
  injectAt(center, amount) {
    const n = this.n, c = (n - 1) / 2;
    const r = Math.max(1, Math.round(center || 1));
    for (let z = c - r; z <= c + r; z++)
      for (let y = c - r; y <= c + r; y++)
        for (let x = c - r; x <= c + r; x++) {
          if (x < 1 || y < 1 || z < 1 || x >= n - 1 || y >= n - 1 || z >= n - 1) continue;
          const d2 = (x - c) ** 2 + (y - c) ** 2 + (z - c) ** 2;
          this.u[idx(x, y, z, n)] += amount * Math.exp(-d2 / (2 * (r * 0.7) ** 2));
        }
  }

  vec() { return Float64Array.from(this.u); }

  energy() {
    let e = 0;
    for (let i = 0; i < this.u.length; i++) e += this.u[i] * this.u[i];
    return e * this.dx * this.dx * this.dx;
  }

  max() { let m = 0; for (let i = 0; i < this.u.length; i++) m = Math.max(m, this.u[i]); return m; }
}

// ===== 核心世界模型：世界 = ⟨S, R, M, T⟩ =====
class World {
  constructor(opts = {}) {
    this.S = new Map();
    this.R = new Map();
    this.M = { energy: 0, info: 0, value: 0, artifactCount: 0 };
    this.T = 0;
  }

  addAgent(agent) {
    const a = Object.assign({ kind: 'agent', _isAgent: true }, agent);
    if (!a.id) a.id = (agent && agent.id) || ('agent_' + Math.random().toString(36).slice(2, 10));
    this.S.set(a.id, a);
    this.M.info += 1;
    return a.id;
  }

  addArtifact({ owner, kind = 'artifact', payload, tick }) {
    const id = 'art_' + Math.random().toString(36).slice(2, 10);
    const art = { id, owner, kind, payload, tick: (tick != null ? tick : this.T) };
    this.S.set(id, art);
    this.M.artifactCount += 1;
    return id;
  }

  addRelation(type, from, to, payload = {}) {
    const id = 'rel_' + Math.random().toString(36).slice(2, 10);
    const rel = { id, type, from, to, payload };
    this.R.set(id, rel);
    return id;
  }

  // 公理3：人类外部输入直接写入，引擎不生成
  step(actions) {
    const sorted = [...actions].sort((a, b) =>
      String(a.agentId) < String(b.agentId) ? -1 : String(a.agentId) > String(b.agentId) ? 1 : 0);
    for (const a of sorted) {
      const agent = this.S.get(a.agentId);
      if (!agent) throw new Error('UNKNOWN_AGENT:' + a.agentId);
      if (a.payload != null) agent.state = Object.assign({}, agent.state, a.payload);
      this.T += 1;
    }
    return this.T;
  }

  measure() {
    let agents = 0;
    for (const v of this.S.values()) if (v._isAgent) agents++;
    return Object.assign({}, this.M, { T: this.T, agents, artifacts: this.M.artifactCount });
  }
}

export { HeatWorld3D, World, idx };
