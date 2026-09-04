/**
 * 灵境 · 五层框架核心数学（最小真实实现，非画饼）
 * ----------------------------------------------------------------------------
 * 对应《"灵境"框架：三维物理现实+时间+全息对偶的通用虚拟空间》五层结构：
 *   L1 物理底座   : 二维热传导 PDE  ∂tφ = α∇²φ + s   （预置模型之一，MVP 只启用此模型）
 *   L2 体空间状态 : φ_h ∈ R^N（N = nx*ny 自由度）
 *   L3 全息映射   : POD/SVD 降阶 Φ_Holo ∈ R^{N×r}, r≪N；投影 ψ = Φᵀ(φ-φ̄)
 *   L4 边界智能层 : 低维动力学 ψ_{t+1} = A ψ_t（最小二乘拟合），预测 / 干预 / 规划
 *   L5 反向映射   : 重建 φ' ≈ Φ ψ' + φ̄
 *
 * 诚实边界：
 *   - 这是【框架的最小真实实现】，每一层的数学都真算（真 PDE 步进、真 SVD、真最小二乘），
 *     不是渲染假动画。MVP 仅启用热传导一个物理模型；刚体/弹性/流体/声学/电磁为后续接入。
 *   - ROM 是近似：重建有误差，页面如实显示重建误差与能量捕获率，不谎称"完全等价"。
 *
 * 浏览器：window.LingJingROM ；Node：module.exports。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.LingJingROM = api;
  if (typeof globalThis !== 'undefined') globalThis.LingJingROM = api;
})(this, function () {
  'use strict';

  // ============================ 数值工具 ============================

  /** 对称矩阵 Jacobi 特征分解（循环旋转），返回降序 {values, vectors(列向量)} */
  function jacobiEigen(Ain, n, maxSweep) {
    const A = Ain.map(r => r.slice());
    let V = []; for (let i = 0; i < n; i++) { V.push(new Array(n).fill(0)); V[i][i] = 1; }
    const sweeps = maxSweep || 60;
    for (let s = 0; s < sweeps; s++) {
      let off = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
      if (off < 1e-18) break;
      for (let p = 0; p < n; p++) {
        for (let q = p + 1; q < n; q++) {
          if (Math.abs(A[p][q]) < 1e-18) continue;
          const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
          const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
          const c = 1 / Math.sqrt(t * t + 1), sn = t * c;
          for (let k = 0; k < n; k++) {
            const akp = A[k][p], akq = A[k][q];
            A[k][p] = c * akp - sn * akq; A[k][q] = sn * akp + c * akq;
          }
          for (let k = 0; k < n; k++) {
            const apk = A[p][k], aqk = A[q][k];
            A[p][k] = c * apk - sn * aqk; A[q][k] = sn * apk + c * aqk;
          }
          for (let k = 0; k < n; k++) {
            const vkp = V[k][p], vkq = V[k][q];
            V[k][p] = c * vkp - sn * vkq; V[k][q] = sn * vkp + c * vkq;
          }
        }
      }
    }
    const idx = []; for (let i = 0; i < n; i++) idx.push(i);
    const vals = []; for (let i = 0; i < n; i++) vals.push(A[i][i]);
    idx.sort((a, b) => vals[b] - vals[a]);
    const values = idx.map(i => vals[i]);
    const vectors = [];
    for (let j = 0; j < n; j++) { const col = []; for (let i = 0; i < n; i++) col.push(V[i][idx[j]]); vectors.push(col); }
    return { values, vectors };
  }

  /** 高斯消元解 M x = b（M 为方阵，部分选主元） */
  function gaussSolve(Min, bin) {
    const n = Min.length;
    const M = Min.map((r, i) => r.slice().concat([bin[i]]));
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-14) return null;
      if (piv !== c) { const t = M[piv]; M[piv] = M[c]; M[c] = t; }
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c]; if (f === 0) continue;
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r, i) => r[n] / r[i === 0 ? 0 : i]);
  }

  // ==================== L1+L2：物理底座 + 体空间状态 ====================

  /**
   * 二维热传导：∂tφ = α∇²φ + s
   * 显式 FTCS 离散；稳定条件 α·dt/dx² ≤ 1/4（2D）。
   */
  class HeatWorld {
    constructor(nx, ny, opts) {
      const o = opts || {};
      this.nx = nx; this.ny = ny; this.N = nx * ny;
      this.alpha = o.alpha != null ? o.alpha : 0.2;
      this.dt = o.dt != null ? o.dt : 0.5;
      this.dx = o.dx != null ? o.dx : 1;
      this.field = new Float64Array(this.N);
      this.sources = new Float64Array(this.N);   // 源/汇 s（如冷却片）
      this.boundary = o.boundary != null ? o.boundary : 0; // Dirichlet 边界值
      this._buf = new Float64Array(this.N);
      this.time = 0;
    }
    at(i, j) { return this.field[j * this.nx + i]; }
    idx(i, j) { return j * this.nx + i; }
    /** 设置初始场（函数 f(i,j) -> value） */
    init(f) { for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) this.field[this.idx(i, j)] = f(i, j); }
    /** 施加源/汇（正值加热，负值冷却） */
    setSource(i, j, v) { if (i >= 0 && i < this.nx && j >= 0 && j < this.ny) this.sources[this.idx(i, j)] = v; }
    clearSources() { this.sources.fill(0); }
    /** 推进一步（L1 物理演化） */
    step() {
      const { nx, ny, alpha, dt, dx, field, _buf, sources, boundary } = this;
      const lam = alpha * dt / (dx * dx);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const k = this.idx(i, j);
          if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) { _buf[k] = boundary; continue; }
          const c = field[k];
          const l = field[k - 1], r = field[k + 1], u = field[k - nx], d = field[k + nx];
          _buf[k] = c + lam * (l + r + u + d - 4 * c) + dt * sources[k];
        }
      }
      this.field.set(_buf);
      this.time += dt;
      return this.field;
    }
    /** 场的最大/最小/总能量（用于安全门与统计） */
    stats() {
      let mx = -Infinity, mn = Infinity, sum = 0;
      for (let k = 0; k < this.N; k++) { const v = this.field[k]; if (v > mx) mx = v; if (v < mn) mn = v; sum += v; }
      return { max: mx, min: mn, mean: sum / this.N };
    }
  }

  // ==================== L3：全息映射（POD/SVD 降阶） ====================

  /**
   * HoloMap：Φ_Holo ∈ R^{N×r}
   * 用 method of snapshots：C = XᵀX（T×T，T≪N），特征分解后取前 r 个模态。
   */
  class HoloMap {
    constructor(N, maxSnap) {
      this.N = N;
      this.maxSnap = maxSnap || 80;
      this.snaps = [];
      this.mean = null;
      this.modes = null;   // r 个 N 维模态（数组 of Float64Array）
      this.lambda = null;  // 对应特征值（降序）
      this.r = 0;
    }
    /** 收集快照（体状态向量） */
    collect(phi) {
      const v = Array.prototype.slice.call(phi);
      this.snaps.push(v);
      if (this.snaps.length > this.maxSnap) this.snaps.shift();
    }
    get T() { return this.snaps.length; }
    /** 构建全息映射核：离线阶段 = SVD/POD */
    build(r) {
      const T = this.snaps.length;
      if (T < 4) return null;
      const N = this.N;
      // 均值 φ̄
      const mean = new Float64Array(N);
      for (const s of this.snaps) for (let k = 0; k < N; k++) mean[k] += s[k] / T;
      this.mean = mean;
      // 去中心化快照矩阵 X（N×T）
      const X = [];
      for (const s of this.snaps) { const c = new Float64Array(N); for (let k = 0; k < N; k++) c[k] = s[k] - mean[k]; X.push(c); }
      // C = Xᵀ X（T×T）
      const C = [];
      for (let a = 0; a < T; a++) {
        const row = new Array(T).fill(0);
        for (let b = 0; b < T; b++) {
          let s = 0; for (let k = 0; k < N; k++) s += X[a][k] * X[b][k];
          row[b] = s / T;
        }
        C.push(row);
      }
      const eig = jacobiEigen(C, T);
      const rr = Math.min(r || 4, T - 1);
      const modes = [], lam = [];
      for (let m = 0; m < rr; m++) {
        const v = eig.vectors[m], lv = Math.max(eig.values[m], 0);
        if (lv <= 1e-14) break;
        const mode = new Float64Array(N);
        for (let a = 0; a < T; a++) {
          const coef = v[a];
          if (coef === 0) continue;
          for (let k = 0; k < N; k++) mode[k] += coef * X[a][k];
        }
        let nrm = 0; for (let k = 0; k < N; k++) nrm += mode[k] * mode[k];
        nrm = Math.sqrt(nrm);
        if (nrm < 1e-14) continue;
        for (let k = 0; k < N; k++) mode[k] /= nrm;
        modes.push(mode); lam.push(lv);
      }
      this.modes = modes; this.lambda = lam; this.r = modes.length;
      // 保存全部特征值（正值），用于计算真实能量捕获率：前 r 模态 / 全部模态
      this.allLambda = eig.values.filter(function (v) { return v > 0; });
      return { r: this.r, lambda: lam, energy: this.energy() };
    }
    /**
     * 真实能量捕获率：前 r 个模态的特征值之和 / 全部模态特征值之和。
     * （分母必须是【全部】模态，否则恒等于 100%，属自欺指标。）
     */
    energy() {
      if (!this.lambda || !this.allLambda || !this.allLambda.length) return 0;
      let tot = 0; for (let i = 0; i < this.allLambda.length; i++) tot += this.allLambda[i];
      let got = 0; for (let i = 0; i < this.lambda.length; i++) got += this.lambda[i];
      return tot > 0 ? got / tot : 0;
    }
    /** L3 投影：φ -> ψ（低维边界） */
    project(phi) {
      if (!this.modes) return null;
      const psi = [];
      for (const mode of this.modes) {
        let s = 0; for (let k = 0; k < this.N; k++) s += mode[k] * (phi[k] - this.mean[k]);
        psi.push(s);
      }
      return psi;
    }
    /** L5 反向映射：ψ -> φ'（重建体状态） */
    reconstruct(psi) {
      const out = new Float64Array(this.N);
      for (let k = 0; k < this.N; k++) out[k] = this.mean[k];
      for (let m = 0; m < this.modes.length; m++) {
        const c = psi[m], mode = this.modes[m];
        for (let k = 0; k < this.N; k++) out[k] += c * mode[k];
      }
      return out;
    }
    /**
     * 自适应更新（对应框架 §3「当真实数据和低维模型预测偏差超过阈值时，触发重新训练」）。
     * 监测重建误差；超阈值则吸收该观测进快照库并重算 POD 核。
     * 诚实边界：自适应对【已观测/邻近】状态精度提升显著；对全新分布状态仍需扩充快照重训练。
     */
    maybeAdapt(phi, threshold, r) {
      const err = this.reconError(phi);
      if (!(err > (threshold == null ? 0.05 : threshold))) return { adapted: false, err };
      this.collect(phi);
      this.build(r || Math.max(this.r, 4));
      return { adapted: true, errBefore: err, errAfter: this.reconError(phi) };
    }
    /** 重建相对 L2 误差（诚实指标） */
    reconError(phi) {
      const psi = this.project(phi); if (!psi) return NaN;
      const rec = this.reconstruct(psi);
      let num = 0, den = 0;
      for (let k = 0; k < this.N; k++) { const d = rec[k] - phi[k]; num += d * d; den += phi[k] * phi[k]; }
      return den > 0 ? Math.sqrt(num / den) : 0;
    }
  }

  // ==================== L4：边界智能层（低维动力学） ====================

  /**
   * 最小二乘拟合 ψ_{t+1} = A ψ_t
   * psiSeq: [[...r], [...r], ...] 时间序列
   * 返回 A（r×r）与拟合残差
   */
  function fitLinear(psiSeq) {
    const T = psiSeq.length; const r = psiSeq[0].length;
    if (T < r + 2) return null;
    // P = [ψ_0..ψ_{T-2}]^T ((T-1)×r), Q = [ψ_1..ψ_{T-1}]
    const M = []; // PᵀP (r×r)
    for (let a = 0; a < r; a++) {
      const row = new Array(r).fill(0);
      for (let b = 0; b < r; b++) { let s = 0; for (let t = 0; t < T - 1; t++) s += psiSeq[t][a] * psiSeq[t][b]; row[b] = s; }
      M.push(row);
    }
    const A = [];
    let resid = 0;
    for (let o = 0; o < r; o++) {
      const rhs = new Array(r).fill(0);
      for (let a = 0; a < r; a++) { let s = 0; for (let t = 0; t < T - 1; t++) s += psiSeq[t][a] * psiSeq[t + 1][o]; rhs[a] = s; }
      const sol = gaussSolve(M.map(row => row.slice()), rhs);
      if (!sol) { A.push(new Array(r).fill(0)); continue; }
      A.push(sol); // A[o][a] 行=输出分量 o
      for (let t = 0; t < T - 1; t++) {
        let pred = 0; for (let a = 0; a < r; a++) pred += sol[a] * psiSeq[t][a];
        const e = pred - psiSeq[t + 1][o]; resid += e * e;
      }
    }
    let scale = 0; for (let t = 1; t < T; t++) for (let o = 0; o < r; o++) scale += psiSeq[t][o] * psiSeq[t][o];
    return { A, rms: Math.sqrt(resid / Math.max(T - 1, 1)), relErr: scale > 0 ? Math.sqrt(resid / scale) : 0 };
  }

  /** 用 A 做多步预测：ψ_t, ψ_{t+1}, ... */
  function predict(A, psi0, steps) {
    const seq = [psi0.slice()];
    let cur = psi0.slice();
    for (let s = 0; s < steps; s++) {
      const nxt = new Array(cur.length).fill(0);
      for (let o = 0; o < A.length; o++) { let v = 0; for (let a = 0; a < cur.length; a++) v += A[o][a] * cur[a]; nxt[o] = v; }
      seq.push(nxt); cur = nxt;
    }
    return seq;
  }

  return { jacobiEigen, gaussSolve, HeatWorld, HoloMap, fitLinear, predict };
});
