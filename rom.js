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

  /**
   * 三维热传导：∂tφ = α∇²φ + s
   * 显式 FTCS 七点格式；稳定条件 α·dt/dx² ≤ 1/6（3D，比 2D 的 1/4 更严）。
   * 展平序 idx(i,j,k) = (k*ny + j)*nx + i，与 NumPy (nz,ny,nx) 的 C 序一致。
   *
   * 与 2D 版的一处【刻意不同】：2D 版 JS 的 init() 不施加边界、要等第一次 step()，
   * 而 Python 版 init() 立即施加，导致交叉验证初始 mean 差 1e-4（README §5 已记）。
   * 3D 版两轨统一在 init() 就施加边界——初值本应满足边界条件，这是更正确的做法，
   * 故 3D 的 JS/Python 交叉验证从 t=0 起即逐位可比。
   */
  class HeatWorld3D {
    constructor(nx, ny, nz, opts) {
      const o = opts || {};
      this.nx = nx; this.ny = ny; this.nz = nz; this.N = nx * ny * nz;
      this.alpha = o.alpha != null ? o.alpha : 0.2;
      this.dt = o.dt != null ? o.dt : 0.5;
      this.dx = o.dx != null ? o.dx : 1;
      this.boundary = o.boundary != null ? o.boundary : 0;
      this.lam = this.alpha * this.dt / (this.dx * this.dx);
      if (this.lam > 1 / 6) {
        throw new Error('CFL 不稳定：α·dt/dx² = ' + this.lam.toFixed(4) + ' > 1/6（3D 显式 FTCS 上限）。请调小 dt 或 alpha。');
      }
      this.field = new Float64Array(this.N);
      this.sources = new Float64Array(this.N);
      this._buf = new Float64Array(this.N);
      this.time = 0;
    }
    idx(i, j, k) { return (k * this.ny + j) * this.nx + i; }

    /* ================= 世界坐标系 =================
       唯一原点 (0,0,0) 在网格【正中心】，X/Y/Z 各有正负半轴。
       网格取奇数时原点落在真实格点上（如 n=21 → 索引 10 的坐标恰为 0，正负各 10 格）；
       取偶数时原点落在两个格点中间，world().originOnGridPoint 会如实报 false。
       物理坐标 x = (i - ox)·dx ，反过来 i = round(x/dx + ox)。 */
    get ox() { return (this.nx - 1) / 2; }
    get oy() { return (this.ny - 1) / 2; }
    get oz() { return (this.nz - 1) / 2; }
    xOf(i) { return (i - this.ox) * this.dx; }
    yOf(j) { return (j - this.oy) * this.dx; }
    zOf(k) { return (k - this.oz) * this.dx; }
    iOf(x) { return Math.round(x / this.dx + this.ox); }
    jOf(y) { return Math.round(y / this.dx + this.oy); }
    kOf(z) { return Math.round(z / this.dx + this.oz); }
    /** 世界坐标 -> 展平下标；越界返回 -1 */
    indexAt(x, y, z) {
      const i = this.iOf(x), j = this.jOf(y), k = this.kOf(z);
      if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return -1;
      return this.idx(i, j, k);
    }
    /** 展平下标 -> 世界坐标 {x,y,z} */
    coordsOf(p) {
      const i = p % this.nx, j = Math.floor(p / this.nx) % this.ny, k = Math.floor(p / (this.nx * this.ny));
      return { x: this.xOf(i), y: this.yOf(j), z: this.zOf(k) };
    }
    /** 世界的几何描述（UI / 验真用） */
    world() {
      return {
        xmin: this.xOf(0), xmax: this.xOf(this.nx - 1),
        ymin: this.yOf(0), ymax: this.yOf(this.ny - 1),
        zmin: this.zOf(0), zmax: this.zOf(this.nz - 1),
        dx: this.dx,
        originIndex: [this.ox, this.oy, this.oz],
        originOnGridPoint: Number.isInteger(this.ox) && Number.isInteger(this.oy) && Number.isInteger(this.oz),
      };
    }

    /** 初始场 f(x,y,z) -> value，坐标为【物理世界坐标，带正负】，不是网格索引 */
    init(f) {
      const { nx, ny, nz } = this;
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        this.field[this.idx(i, j, k)] = f(this.xOf(i), this.yOf(j), this.zOf(k));
      }
      this._applyBoundary();
      return this.field;
    }
    /** 源/汇（正值加热，负值冷却），坐标为物理世界坐标 */
    setSource(x, y, z, v) {
      const p = this.indexAt(x, y, z);
      if (p >= 0) this.sources[p] = v;
    }
    clearSources() { this.sources.fill(0); }
    _applyBoundary() {
      const { nx, ny, nz, boundary } = this, f = this.field;
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
        f[this.idx(0, j, k)] = boundary; f[this.idx(nx - 1, j, k)] = boundary;
      }
      for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
        f[this.idx(i, 0, k)] = boundary; f[this.idx(i, ny - 1, k)] = boundary;
      }
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        f[this.idx(i, j, 0)] = boundary; f[this.idx(i, j, nz - 1)] = boundary;
      }
    }
    /** 推进一步（L1 物理演化，七点格式） */
    step() {
      const { nx, ny, nz, lam, dt, field, _buf, sources, boundary } = this;
      const stride_y = nx, stride_z = nx * ny;
      for (let k = 0; k < nz; k++) {
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            const p = (k * ny + j) * nx + i;
            if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) { _buf[p] = boundary; continue; }
            const c = field[p];
            const s = field[p - 1] + field[p + 1] + field[p - stride_y] + field[p + stride_y] + field[p - stride_z] + field[p + stride_z];
            _buf[p] = c + lam * (s - 6 * c) + dt * sources[p];
          }
        }
      }
      this.field.set(_buf);
      this.time += dt;
      return this.field;
    }
    stats() {
      let mx = -Infinity, mn = Infinity, sum = 0;
      for (let k = 0; k < this.N; k++) { const v = this.field[k]; if (v > mx) mx = v; if (v < mn) mn = v; sum += v; }
      return { max: mx, min: mn, mean: sum / this.N };
    }
    /** 取 z=k 的切片（返回 nx*ny 的 Float64Array，行序 j） */
    sliceZ(k) { return this.field.subarray(k * this.ny * this.nx, (k + 1) * this.ny * this.nx); }
    /** 按【物理坐标】取 z 平面切片（取最近的一层） */
    sliceAtZ(z) { return this.sliceZ(this.kOf(z)); }
    flat() { return this.field; }
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
      /* ★ 数值秩护栏（两道）
         谱会一直衰减到浮点噪声层。那里的"模态"不是物理方向，而是数值垃圾：
         彼此不正交（实测 Gram 非对角元可达 0.876——几乎平行），加进基里不但不降误差，
         反而把重建误差从 0.000007% 恶化到 0.00274%。
         第一道 · λ 噪声地板：λ_m ≤ λ_max·1e-12 直接不取。
                 依据：C 由 N~1e4 项累加而成，相对误差 ~√N·eps ≈ 2e-14，取 100 倍安全余量。
         第二道 · 修正 Gram-Schmidt 重正交：保证 ΦᵀΦ = I，这是 project/reconstruct
                 作为"正交投影"的前提；正交后残余过小者（与已有模态线性相关）丢弃。 */
      const lamMax = eig.values.length ? Math.max(eig.values[0], 0) : 0;
      const noiseFloor = lamMax * 1e-12;
      const modes = [], lam = [];
      for (let m = 0; m < rr; m++) {
        const v = eig.vectors[m], lv = Math.max(eig.values[m], 0);
        if (lv <= noiseFloor) break;                // 第一道：噪声地板之下不取
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
        // 第二道：对已接受的模态做两轮 MGS（两轮足以压到机器精度）
        for (let pass = 0; pass < 2; pass++) {
          for (let q = 0; q < modes.length; q++) {
            const qv = modes[q];
            let d = 0; for (let k = 0; k < N; k++) d += qv[k] * mode[k];
            for (let k = 0; k < N; k++) mode[k] -= d * qv[k];
          }
        }
        let n2 = 0; for (let k = 0; k < N; k++) n2 += mode[k] * mode[k];
        if (Math.sqrt(n2) < 1e-3) continue;         // 与已有模态近乎线性相关 → 丢弃
        const nn = Math.sqrt(n2);
        for (let k = 0; k < N; k++) mode[k] /= nn;
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
    /**
     * 有效秩：λ_m > λ_max·tol 的模态个数（默认 tol=1e-6）。
     * 为什么必须报这个数：能量捕获率对【数值噪声模态】不敏感——一批高度相关的快照
     * 会让谱在某处断崖，此后补进的模态纯属噪声却仍算"已捕获"，使百分比逼近 100%，
     * 好看却无表示能力。Python 版有同款 effective_rank()，此处为双轨可比而补齐。
     */
    effectiveRank(tol) {
      if (!this.allLambda || !this.allLambda.length) return 0;
      const t = tol == null ? 1e-6 : tol;
      const lamMax = this.allLambda[0];
      if (!(lamMax > 0)) return 0;
      let n = 0;
      for (let i = 0; i < this.allLambda.length; i++) if (this.allLambda[i] > lamMax * t) n++;
      return n;
    }
    /** 谱断崖位置：第一个 λ_{m+1}/λ_m < 1/factor 的索引 m+1；无断崖返回 -1。 */
    cliffIndex(factor) {
      if (!this.allLambda || this.allLambda.length < 2) return -1;
      const f = factor == null ? 1e3 : factor;
      const lam = this.allLambda.filter(function (v) { return v > 0; });
      for (let m = 0; m < lam.length - 1; m++) {
        if (lam[m + 1] / lam[m] < 1 / f) return m + 1;
      }
      return -1;
    }
    /** 相对谱 λ_m/λ_0（降序），断崖一眼可见。 */
    spectrumRatios() {
      if (!this.allLambda || !this.allLambda.length) return null;
      const l0 = this.allLambda[0];
      return l0 > 0 ? this.allLambda.map(function (v) { return v / l0; }) : null;
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

  /**
   * 仿射拟合：ψ_{t+1} = A ψ_t + b
   *
   * 为什么必须有这一版：ψ = Φᵀ(φ − φ̄) 含【减均值】，故即使物理演化 φ_{t+1}=Mφ_t
   * 是严格线性的，投影后的低维动力学也是仿射的：
   *     ψ_{t+1} = ΦᵀMΦ·ψ_t + Φᵀ(Mφ̄ − φ̄)      ← 第二项（均值漂移）一般非零
   * 只拟合 A（fitLinear）会系统性欠拟合。实测本场景：线性拟合残差 1.5e-1、
   * 6 步预测误差 79%；改仿射后残差降到机器精度级，多步预测随之可用。
   *
   * 返回 {A (r×(r+1)，最后一列即 b), r, rms, relErr}
   */
  function fitAffine(psiSeq) {
    const T = psiSeq.length, r = psiSeq[0].length;
    if (T < r + 3) return null;
    const d = r + 1;
    const M = [];
    for (let a = 0; a < d; a++) {
      const row = new Array(d).fill(0);
      for (let b = 0; b < d; b++) {
        let s = 0;
        for (let t = 0; t < T - 1; t++) {
          const xa = a < r ? psiSeq[t][a] : 1, xb = b < r ? psiSeq[t][b] : 1;
          s += xa * xb;
        }
        row[b] = s;
      }
      M.push(row);
    }
    const A = [];
    let resid = 0;
    for (let o = 0; o < r; o++) {
      const rhs = new Array(d).fill(0);
      for (let a = 0; a < d; a++) {
        let s = 0;
        for (let t = 0; t < T - 1; t++) { const xa = a < r ? psiSeq[t][a] : 1; s += xa * psiSeq[t + 1][o]; }
        rhs[a] = s;
      }
      const sol = gaussSolve(M.map(row => row.slice()), rhs);
      if (!sol) { A.push(new Array(d).fill(0)); continue; }
      A.push(sol);
      for (let t = 0; t < T - 1; t++) {
        let p = sol[r];
        for (let a = 0; a < r; a++) p += sol[a] * psiSeq[t][a];
        const e = p - psiSeq[t + 1][o]; resid += e * e;
      }
    }
    let scale = 0;
    for (let t = 1; t < T; t++) for (let o = 0; o < r; o++) scale += psiSeq[t][o] * psiSeq[t][o];
    return { A, r, affine: true, rms: Math.sqrt(resid / Math.max(T - 1, 1)), relErr: scale > 0 ? Math.sqrt(resid / scale) : 0 };
  }

  /** 用仿射模型做多步预测：ψ_t, ψ_{t+1}, ... */
  function predictAffine(A, psi0, steps) {
    const r = psi0.length;
    const seq = [psi0.slice()];
    let cur = psi0.slice();
    for (let s = 0; s < steps; s++) {
      const nxt = new Array(r).fill(0);
      for (let o = 0; o < A.length; o++) {
        let v = A[o][r];
        for (let a = 0; a < r; a++) v += A[o][a] * cur[a];
        nxt[o] = v;
      }
      seq.push(nxt); cur = nxt;
    }
    return seq;
  }

  return { jacobiEigen, gaussSolve, HeatWorld, HeatWorld3D, HoloMap, fitLinear, fitAffine, predict, predictAffine };
});
