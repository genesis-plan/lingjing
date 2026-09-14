'use strict';
/*
 * 灵境数学框架 · 物理载体层（可插拔内容层）
 * --------------------------------------------------------------------------
 * 真实确定性数值：3D 热传导 FTCS。CFL 护栏 fail-closed。
 *
 * 说明（诚实）：
 *   - 物理世界是"教学的载体"（框架原文）。此处用真实 PDE 作载体，
 *     但只声称是载体，不声称模拟真实世界。Phase2 可加 波/泊松/平流扩散。
 *   - 网格取奇数，唯一原点在网格正中心（X/Y/Z 各有正负半轴），与框架约定一致。
 */

function idx(x, y, z, n) { return z * n * n + y * n + x; }

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

  vec() { return Float64Array.from(this.u); }

  energy() {
    let e = 0;
    for (let i = 0; i < this.u.length; i++) e += this.u[i] * this.u[i];
    return e * this.dx * this.dx * this.dx;
  }
}

module.exports = { HeatWorld3D, idx };
