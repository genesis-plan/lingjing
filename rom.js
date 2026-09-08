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

  /**
   * 稳定最小二乘：求 x 使 ‖X·x − y‖ 最小（X: m×n, m≥n）。
   *
   * ⚠️ 为什么不能用法方程（XᵀX 再高斯消元）：
   *   法方程把条件数【平方】。X 病态时（例如声波 AR(2) 的设计矩阵里相邻快照近乎
   *   共线），XᵀX 的病态被放大到高斯消元连部分主元都救不回来——实测声波场景
   *   6 步样本外预测误差爆到 **1.346（134%）**，而 Python 轨 np.linalg.lstsq（SVD，
   *   直接解 X 不平方条件数）得 **8.65e-3（0.865%）**，恰好等于 L5 投影底线。
   *
   *   本函数用 Householder QR 直接解原方程（与 SVD 同为向后稳定算法），
   *   满秩时与 np.linalg.lstsq 数字对齐到 ~1e-12。
   */
  function lstsq(X, y) {
    const m = X.length, n = X[0].length;
    const A = new Array(m);
    for (let i = 0; i < m; i++) A[i] = X[i].concat([y[i]]);   // 增广 [X | y]
    for (let k = 0; k < n; k++) {
      let alpha = 0;
      for (let i = k; i < m; i++) alpha += A[i][k] * A[i][k];
      alpha = Math.sqrt(alpha);
      if (alpha < 1e-300) continue;                            // 该列已零
      const a0 = A[k][k];
      const sigma = a0 >= 0 ? -alpha : alpha;
      const v = new Array(m - k);                              // Householder 向量
      v[0] = a0 - sigma;
      for (let i = k + 1; i < m; i++) v[i - k] = A[i][k];
      const vnorm2 = v[0] * v[0] + (alpha * alpha - a0 * a0);
      const beta = 2 / vnorm2;
      for (let j = k; j <= n; j++) {                           // H = I − β v vᵀ 作用到第 k..n 列
        let dot = v[0] * A[k][j];
        for (let i = k + 1; i < m; i++) dot += v[i - k] * A[i][j];
        const s = beta * dot;
        A[k][j] -= s * v[0];
        for (let i = k + 1; i < m; i++) A[i][j] -= s * v[i - k];
      }
    }
    const x = new Array(n).fill(0);                            // 回代 R x = d
    for (let i = n - 1; i >= 0; i--) {
      if (Math.abs(A[i][i]) < 1e-14) { x[i] = 0; continue; }
      let s = A[i][n];
      for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
      x[i] = s / A[i][i];
    }
    return x;
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
   * Grid3D：三维世界的【公共底座】——网格 + 世界坐标系 + 边界 + 七点拉普拉斯。
   * 所有物理世界（热传导 / 声波 / 静电势 / 流体输运）都继承它，
   * 这样"唯一原点居中、XYZ 有正负半轴"这套坐标系只有一份实现，不会各写各的。
   *
   * 展平序 idx(i,j,k) = (k*ny + j)*nx + i，与 NumPy (nz,ny,nx) 的 C 序一致。
   */
  class Grid3D {
    constructor(nx, ny, nz, opts) {
      const o = opts || {};
      this.nx = nx; this.ny = ny; this.nz = nz; this.N = nx * ny * nz;
      this.dx = o.dx != null ? o.dx : 1;
      this.boundary = o.boundary != null ? o.boundary : 0;
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
    /** 六面 Dirichlet 边界。arr 省略时作用于主场；对蛙跳的 prev 层也必须施加 */
    _applyBoundary(arr) {
      const { nx, ny, nz, boundary } = this, f = arr || this.field;
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
    /** 内部格点是否为边界格（边界格不参与演化） */
    isBoundary(i, j, k) {
      return i === 0 || j === 0 || k === 0 || i === this.nx - 1 || j === this.ny - 1 || k === this.nz - 1;
    }
    /**
     * 七点拉普拉斯的邻点和（不含中心项）。
     * 返回 s = Σ(六邻) ，调用方自行算 s - 6·c。
     */
    _neighborSum(field, p, i, j, k) {
      const sy = this.nx, sz = this.nx * this.ny;
      return field[p - 1] + field[p + 1] + field[p - sy] + field[p + sy] + field[p - sz] + field[p + sz];
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

  /**
   * 三维热传导：∂tφ = α∇²φ + s
   * 显式 FTCS 七点格式；稳定条件 α·dt/dx² ≤ 1/6（3D，比 2D 的 1/4 更严）。
   *
   * 与 2D 版的一处【刻意不同】：2D 版 JS 的 init() 不施加边界、要等第一次 step()，
   * 而 Python 版 init() 立即施加，导致交叉验证初始 mean 差 1e-4（README §5 已记）。
   * 3D 版两轨统一在 init() 就施加边界——初值本应满足边界条件，这是更正确的做法，
   * 故 3D 的 JS/Python 交叉验证从 t=0 起即逐位可比。
   */
  class HeatWorld3D extends Grid3D {
    constructor(nx, ny, nz, opts) {
      super(nx, ny, nz, opts);
      const o = opts || {};
      this.alpha = o.alpha != null ? o.alpha : 0.2;
      this.dt = o.dt != null ? o.dt : 0.5;
      this.lam = this.alpha * this.dt / (this.dx * this.dx);
      if (this.lam > 1 / 6) {
        throw new Error('CFL 不稳定：α·dt/dx² = ' + this.lam.toFixed(4) + ' > 1/6（3D 显式 FTCS 上限）。请调小 dt 或 alpha。');
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
  }

  // ==================== L1 物理规律之二：声波（双曲型 PDE） ====================
  /**
   * 三维声波：∂²u/∂t² = c²∇²u − γ·∂u/∂t
   * Leapfrog（蛙跳）显式格式；3D 稳定条件 Courant 数 c·dt/dx ≤ 1/√3 ≈ 0.5774。
   * 与热传导【根本不同】：热是抛物型（平滑、不可逆、有耗散），波是双曲型（不平滑、可逆、能量守恒）。
   * 因此这里用【能量守恒】而不是"衰减到 0"来验真——波跑一圈回来还是那个波。
   */
  class WaveWorld3D extends Grid3D {
    constructor(nx, ny, nz, opts) {
      super(nx, ny, nz, opts);
      const o = opts || {};
      this.c = o.c != null ? o.c : 1;
      this.dt = o.dt != null ? o.dt : 0.2;
      this.damping = o.damping != null ? o.damping : 0;
      this.courant = this.c * this.dt / this.dx;
      if (this.courant > 1 / Math.sqrt(3)) {
        throw new Error('CFL 不稳定：c·dt/dx = ' + this.courant.toFixed(4)
          + ' > 1/√3≈0.5774（3D 波动方程上限）。请调小 dt 或 c。');
      }
      this.prev = new Float64Array(this.N);
    }
    /** f(x,y,z)=初始位移 u₀；g(x,y,z)=初始速度 ∂u/∂t|₀（可选，默认 0） */
    init(f, g) {
      const { nx, ny, nz } = this;
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const p = this.idx(i, j, k);
        const x = this.xOf(i), y = this.yOf(j), z = this.zOf(k);
        const u0 = f(x, y, z);
        this.field[p] = u0;
        this.prev[p] = g ? u0 - this.dt * g(x, y, z) : u0;   // u^{-1} = u⁰ − dt·v₀
      }
      this._applyBoundary();
      // ★ prev 层同样要满足边界条件。漏掉这一步会让 u⁻¹ 在边界非零，
      //   动能项凭空多出 ½(b/dt)²，误差随 dt 缩小反而【放大】（实测 dt 减半误差 ×4）。
      this._applyBoundary(this.prev);
      return this.field;
    }
    step() {
      const { nx, ny, nz, dt, field, _buf, prev, sources } = this;
      const C2 = this.courant * this.courant;
      const a = 1 + this.damping * dt / 2, b = 1 - this.damping * dt / 2;
      const sy = nx, sz = nx * ny;
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const p = (k * ny + j) * nx + i;
        if (this.isBoundary(i, j, k)) { _buf[p] = this.boundary; continue; }
        const c0 = field[p];
        const s = field[p - 1] + field[p + 1] + field[p - sy] + field[p + sy] + field[p - sz] + field[p + sz];
        _buf[p] = (2 * c0 - b * prev[p] + C2 * (s - 6 * c0)) / a + dt * dt * sources[p];
      }
      prev.set(field);
      this.field.set(_buf);
      this.time += dt;
      return this.field;
    }
    /**
     * 蛙跳格式的【严格守恒量】。
     * ⚠️ 不能用 ½Σ((u−u_prev)/dt)² + ½c²Σ|∇u|² 这种"看起来对"的写法：
     *    动能项在 t−½ 层、势能项在 t 层，错开半层会让能量测出 O(dt) 的假漂移
     *    （实测虚报 2.9% 衰减，而蛙跳本不该耗散）。
     * 正确的守恒量是势能用【相邻两层的前向差分沿边内积】（与七点模板严格分部求和匹配）：
     *    E = ½‖(uⁿ⁺¹−uⁿ)/dt‖²·dx³ + (c²/2)·Σ_edges (Δuⁿ⁺¹)(Δuⁿ)/dx² · dx³
     * 注意是【前向差分沿边求和、含贴边那些边】，不是中心差分——用中心差分同样测不出守恒
     * （实测中心差分版本虚报 19% 漂移）。
     */
    energy() {
      const { nx, ny, nz, field, prev, dt, c, dx } = this;
      const sy = nx, sz = nx * ny;
      let kin = 0, pot = 0;
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const p = (k * ny + j) * nx + i;
        const v = (field[p] - prev[p]) / dt;
        kin += v * v;
        if (i + 1 < nx) { const q = p + 1; pot += (field[q] - field[p]) * (prev[q] - prev[p]); }
        if (j + 1 < ny) { const q = p + sy; pot += (field[q] - field[p]) * (prev[q] - prev[p]); }
        if (k + 1 < nz) { const q = p + sz; pot += (field[q] - field[p]) * (prev[q] - prev[p]); }
      }
      pot *= c * c / (dx * dx);
      return 0.5 * (kin + pot) * dx * dx * dx;
    }
  }

  // ==================== L1 物理规律之三：静电势（椭圆型 PDE） ====================
  /**
   * 静电势：∇²φ = −ρ/ε₀，Dirichlet 边界。
   * 椭圆型——没有时间演化，是"瞬时平衡"问题，用 Jacobi 迭代求解。
   * 它是【线性的】，所以可以严格验证叠加原理：两个电荷的解 = 各自解的逐点和。
   */
  class PoissonWorld3D extends Grid3D {
    constructor(nx, ny, nz, opts) {
      super(nx, ny, nz, opts);
      const o = opts || {};
      this.eps0 = o.eps0 != null ? o.eps0 : 1;
      this.iters = 0; this.residual = Infinity;
    }
    /** 设置电荷密度 ρ(x,y,z)（复用 sources 数组，语义为 ρ 而非源项） */
    setRho(fn) {
      const { nx, ny, nz } = this;
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        this.sources[this.idx(i, j, k)] = fn(this.xOf(i), this.yOf(j), this.zOf(k));
      }
      return this.sources;
    }
    /** 点电荷（离散到最近格点，数值上等价于在该格放一个库仑源） */
    addPointCharge(x, y, z, q) {
      const p = this.indexAt(x, y, z);
      if (p >= 0) this.sources[p] += q / (this.dx * this.dx * this.dx);
    }
    /** Jacobi 迭代；返回 {iters, residual}，residual = max|∇²φ + ρ/ε₀| */
    solve(maxIter, tol) {
      const it = maxIter != null ? maxIter : 3000, tv = tol != null ? tol : 1e-9;
      const { nx, ny, nz, field, _buf, sources, eps0, dx } = this;
      const C2 = dx * dx / eps0;
      const sy = nx, sz = nx * ny;
      let res = Infinity, n = 0;
      for (n = 1; n <= it; n++) {
        for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const p = (k * ny + j) * nx + i;
          if (this.isBoundary(i, j, k)) { _buf[p] = this.boundary; continue; }
          const s = field[p - 1] + field[p + 1] + field[p - sy] + field[p + sy] + field[p - sz] + field[p + sz];
          _buf[p] = (s + C2 * sources[p]) / 6;
        }
        this.field.set(_buf);
        if (n % 10 === 0 || n === it) {
          res = 0;
          for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
            const p = (k * ny + j) * nx + i;
            const s = field[p - 1] + field[p + 1] + field[p - sy] + field[p + sy] + field[p - sz] + field[p + sz];
            res = Math.max(res, Math.abs((s - 6 * field[p]) / (dx * dx) + sources[p] / eps0));
          }
          if (res < tv) break;
        }
      }
      this.iters = n; this.residual = res;
      return { iters: n, residual: res };
    }
  }

  // ==================== L1 物理规律之四：流体标量输运（对流–扩散） ====================
  /**
   * 对流–扩散方程：∂φ/∂t + u·∇φ = α∇²φ
   * 对流项用【一阶迎风】（稳定但带数值扩散），扩散项用 FTCS。
   * 稳定条件两者分别检查：Σ|uᵢ|·dt/dx ≤ 1 且 α·dt/dx² ≤ 1/6，超任一个 fail-closed。
   *
   * 这一类对降阶模型【天然不友好】：对流主导的问题 Kolmogorov n-width 衰减很慢，
   * 即"很少的模态抓不住一个平移/旋转的斑"。验真会如实报出它的有效秩远高于热传导。
   */
  class AdvectDiffuseWorld3D extends Grid3D {
    constructor(nx, ny, nz, opts) {
      super(nx, ny, nz, opts);
      const o = opts || {};
      this.alpha = o.alpha != null ? o.alpha : 0.0;
      this.dt = o.dt != null ? o.dt : 0.2;
      this.omega = o.omega != null ? o.omega : 0.1;   // 绕 Z 轴刚体旋转的角速度
      this.lam = this.alpha * this.dt / (this.dx * this.dx);
      if (this.lam > 1 / 6) {
        throw new Error('CFL 不稳定（扩散）：α·dt/dx² = ' + this.lam.toFixed(4) + ' > 1/6。');
      }
      // 采样速度场，求 Σ|uᵢ|·dt/dx 的上界
      let vcfl = 0;
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const u = this.velocityAt(this.xOf(i), this.yOf(j), this.zOf(k));
        const s = (Math.abs(u[0]) + Math.abs(u[1]) + Math.abs(u[2])) * this.dt / this.dx;
        if (s > vcfl) vcfl = s;
      }
      this.flowCFL = vcfl;
      if (vcfl > 1) {
        throw new Error('CFL 不稳定（对流）：Σ|uᵢ|·dt/dx = ' + vcfl.toFixed(4) + ' > 1。请调小 dt 或 omega。');
      }
    }
    /** 速度场：绕 Z 轴的刚体旋转 u = (−ωy, ωx, 0)（无散度，不会人为压缩/拉伸物质） */
    velocityAt(x, y, z) { return [-this.omega * y, this.omega * x, 0]; }
    step() {
      const { nx, ny, nz, dt, dx, field, _buf, alpha, sources } = this;
      const sy = nx, sz = nx * ny;
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const p = (k * ny + j) * nx + i;
        if (this.isBoundary(i, j, k)) { _buf[p] = this.boundary; continue; }
        const u = this.velocityAt(this.xOf(i), this.yOf(j), this.zOf(k));
        // 迎风：速度指向哪边，就用那一侧的差商
        const dphidx = u[0] >= 0 ? (field[p] - field[p - 1]) / dx : (field[p + 1] - field[p]) / dx;
        const dphidy = u[1] >= 0 ? (field[p] - field[p - sy]) / dx : (field[p + sy] - field[p]) / dx;
        const dphidz = u[2] >= 0 ? (field[p] - field[p - sz]) / dx : (field[p + sz] - field[p]) / dx;
        const adv = u[0] * dphidx + u[1] * dphidy + u[2] * dphidz;
        const s = field[p - 1] + field[p + 1] + field[p - sy] + field[p + sy] + field[p - sz] + field[p + sz];
        const dif = alpha * (s - 6 * field[p]) / (dx * dx);
        _buf[p] = field[p] + dt * (dif - adv + sources[p]);
      }
      this.field.set(_buf);
      this.time += dt;
      return this.field;
    }
    /** 物质总量 Σφ·dx³（纯对流无源时应近似守恒，边界会漏，故只作参考） */
    mass() { let s = 0; for (let i = 0; i < this.N; i++) s += this.field[i]; return s * this.dx ** 3; }
    /** 质心（世界坐标）——纯旋转时，转一整圈质心应回到出发点 */
    centroid() {
      let m = 0, cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < this.nz; k++) for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
        const v = this.field[this.idx(i, j, k)];
        m += v; cx += v * this.xOf(i); cy += v * this.yOf(j); cz += v * this.zOf(k);
      }
      if (Math.abs(m) < 1e-300) return { x: 0, y: 0, z: 0, mass: 0 };
      return { x: cx / m, y: cy / m, z: cz / m, mass: m };
    }
  }

  // ==================== L1 物理规律之五：刚体（牛顿力学，非场） ====================
  /**
   * 刚体动力学（牛顿–欧拉方程）：这不是场，是世界里的"物体"。
   *   平动：m·a = ΣF（含重力）        转动：I·ω̇ + ω×(I·ω) = τ
   * 姿态用四元数 q 积分（避免万向锁）。惯性张量简化为【对角】(Ix,Iy,Iz)。
   *
   * 积分器：平动用【速度 Verlet】（恒力下位置精确，自由落体误差掉到 1e-16 量级），
   * 转动用【RK2 中点】（比显式欧拉的角动量漂移小两个量级）。
   * 诚实边界：无碰撞检测、无约束求解、无摩擦；仍是有限阶，长时间能量仍有缓慢漂移。
   * 可严格验证的量：动量（恒力下逐位守恒）、无力矩时的角动量、自由落体与解析解的偏差。
   */
  class RigidBody3D {
    constructor(opts) {
      const o = opts || {};
      this.mass = o.mass != null ? o.mass : 1;
      this.Ix = o.Ix != null ? o.Ix : 1;
      this.Iy = o.Iy != null ? o.Iy : 1;
      this.Iz = o.Iz != null ? o.Iz : 1;
      this.pos = (o.pos || [0, 0, 0]).slice();
      this.vel = (o.vel || [0, 0, 0]).slice();
      this.q = (o.q || [0, 0, 0, 1]).slice();          // [x,y,z,w]
      this.omega = (o.omega || [0, 0, 0]).slice();      // 体坐标系角速度
      this.gravity = (o.gravity || [0, 0, 0]).slice();
      this._F = [0, 0, 0]; this._tau = [0, 0, 0];
      this.time = 0;
    }
    cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
    /** 施加力 F（世界系）；r 为相对质心的作用点，非空则同时产生力矩 r×F */
    applyForce(F, r) {
      this._F[0] += F[0]; this._F[1] += F[1]; this._F[2] += F[2];
      if (r) { const t = this.cross(r, F); this._tau[0] += t[0]; this._tau[1] += t[1]; this._tau[2] += t[2]; }
    }
    applyTorque(t) { this._tau[0] += t[0]; this._tau[1] += t[1]; this._tau[2] += t[2]; }
    /** 四元数乘法 */
    _qmul(a, b) {
      return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
      ];
    }
    /** 角加速度：ω̇ = I⁻¹(τ − ω×(Iω))（体坐标系） */
    _omegaDot(w, tau) {
      const Iw = [this.Ix * w[0], this.Iy * w[1], this.Iz * w[2]];
      const gyro = this.cross(w, Iw);
      return [(tau[0] - gyro[0]) / this.Ix, (tau[1] - gyro[1]) / this.Iy, (tau[2] - gyro[2]) / this.Iz];
    }
    /** 速度 Verlet（平动） + RK2 中点（转动与姿态） */
    step(dt) {
      const m = this.mass, g = this.gravity;
      const acc = [(this._F[0] / m) + g[0], (this._F[1] / m) + g[1], (this._F[2] / m) + g[2]];
      // 平动：x += v·dt + ½a·dt²；v += a·dt（恒加速度下位置精确）
      for (let i = 0; i < 3; i++) { this.pos[i] += this.vel[i] * dt + 0.5 * acc[i] * dt * dt; this.vel[i] += acc[i] * dt; }
      // 转动：RK2 中点法
      const w0 = this.omega, tau = this._tau;
      const k1 = this._omegaDot(w0, tau);
      const wm = [w0[0] + 0.5 * dt * k1[0], w0[1] + 0.5 * dt * k1[1], w0[2] + 0.5 * dt * k1[2]];
      const k2 = this._omegaDot(wm, tau);
      this.omega = [w0[0] + dt * k2[0], w0[1] + dt * k2[1], w0[2] + dt * k2[2]];
      // 姿态用中点角速度积分
      const wq = [wm[0], wm[1], wm[2], 0];
      const dq = this._qmul(wq, this.q).map(function (v) { return v * dt; });
      for (let i = 0; i < 4; i++) this.q[i] += dq[i];
      const nq = Math.hypot(this.q[0], this.q[1], this.q[2], this.q[3]) || 1;
      for (let i = 0; i < 4; i++) this.q[i] /= nq;
      this.time += dt;
      this._F = [0, 0, 0]; this._tau = [0, 0, 0];
      return this;
    }
    /** 体坐标 → 世界坐标 */
    bodyToWorld(v) {
      const [x, y, z, w] = this.q;
      const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
      return [
        v[0] + w * t[0] + (y * t[2] - z * t[1]),
        v[1] + w * t[1] + (z * t[0] - x * t[2]),
        v[2] + w * t[2] + (x * t[1] - y * t[0]),
      ];
    }
    momentum() { return [this.mass * this.vel[0], this.mass * this.vel[1], this.mass * this.vel[2]]; }
    /** 角动量（世界系）：L = R·(I·ω_body) */
    angularMomentum() {
      return this.bodyToWorld([this.Ix * this.omega[0], this.Iy * this.omega[1], this.Iz * this.omega[2]]);
    }
    energy(groundY) {
      const v2 = this.vel[0] ** 2 + this.vel[1] ** 2 + this.vel[2] ** 2;
      const w = this.omega;
      const rot = this.Ix * w[0] ** 2 + this.Iy * w[1] ** 2 + this.Iz * w[2] ** 2;
      const gy = groundY != null ? groundY : 0;
      return 0.5 * this.mass * v2 + 0.5 * rot + this.mass * 9.81 * (this.pos[1] - gy);
    }
  }

  // ==================== 真实世界（原点=地球中心 · 中心引力 + 多体 + 数学规律） ====================
  /**
   * RealWorld3D：把"三维虚拟空间"升级为更接近真实世界的系统。
   *   - 物理层（现实规律，含运动）：以原点模拟为地球中心，默认产生反平方中心引力
   *       F = −G·M·m·r̂ / r²；可选物体间互引力（N 体）；可选弹性碰撞。
   *       ◆ 可给 centralLaw=[c0,c1,c2,c3]（候选基 [1/r²,1/r,1,1/r³] 上的系数）替换默认律——
   *         用"机器人学出的经验律"跑世界（如 SINDy 从真实轨迹学回；见 verify_experience.js）。
   *   - 数学层（数学规律，区别于物理力）：
   *       ◇ MG 几何约束律：物体被约束在给定半径的球面上（纯数学结构，非力，每步投影）。
   *       ◇ MI 不变量律：三大连续对称对应的守恒量——能量(时间平移)、角动量(SO(3)旋转)、
   *         动量(平移)——由对称性推出，显式测量其漂移作为"数学规律在生效"的证据。
   *       ◇ 反平方专属数学律（Bertrand）：离心率矢量 e_vec 守恒 ⇒ 所有束缚轨道是闭合椭圆。
   * 积分器：速度 Verlet（辛，长期能量漂移远低于显式欧拉）。
   * 诚实边界：无广义相对论修正、无潮汐、碰撞为简化弹性、球约束后"速度切向化"是数学约束非物理。
   */
  class RealWorld3D {
    constructor(opts) {
      const o = opts || {};
      this.G = o.G != null ? o.G : 1.0;            // 引力常数
      this.M = o.M != null ? o.M : 1000.0;          // 原点处中心质量（地球）
      this.centralLaw = o.centralLaw || null;       // null | [c0,c1,c2,c3] 学出的经验律（基 [1/r²,1/r,1,1/r³]）
      this.rMin = o.rMin != null ? o.rMin : 0.5;    // 奇点护栏：距原点过近直接拒
      this.mutual = !!o.mutual;                     // 是否启用物体间互引力
      this.collide = o.collide != null ? o.collide : false;  // 弹性碰撞
      this.constraint = o.constraint || null;       // null | {type:'sphere', R}
      this.bodies = [];                             // {pos,vel,mass,radius}
      this.time = 0;
    }
    addBody(pos, vel, mass, radius) {
      this.bodies.push({ pos: pos.slice(), vel: vel.slice(), mass: mass, radius: radius || 0.2 });
      return this;
    }
    _accel() {
      const bs = this.bodies, n = bs.length, GM = this.G * this.M, law = this.centralLaw;
      const A = bs.map(function () { return [0, 0, 0]; });
      for (let i = 0; i < n; i++) {
        const r = bs[i].pos;
        const rr = Math.hypot(r[0], r[1], r[2]);
        if (rr < this.rMin) throw new Error('中心引力奇点：物体#' + i + ' 距原点 ' + rr.toExponential(2) + ' < rMin=' + this.rMin + '（fail-closed）');
        let aMag;
        const irr = 1 / rr;
        if (law) {
          const irr2 = irr * irr;                 // 经验律：a_mag(r) = Σ cᵢ·bᵢ(r)
          aMag = law[0] * irr2 + law[1] * irr + law[2] + law[3] * irr2 * irr;
        } else {
          aMag = -GM * irr * irr;                 // 默认硬写：−GM/r²
        }
        const f = aMag / rr;                      // accel = a_mag·r̂ = (a_mag/rr)·r
        A[i][0] += f * r[0]; A[i][1] += f * r[1]; A[i][2] += f * r[2];
        if (this.mutual) {
          for (let j = 0; j < n; j++) {
            if (j === i) continue;
            const d = [r[0] - bs[j].pos[0], r[1] - bs[j].pos[1], r[2] - bs[j].pos[2]];
            const dd = Math.hypot(d[0], d[1], d[2]);
            if (dd < 1e-9) continue;
            const g = -this.G * bs[j].mass / (dd * dd * dd);
            A[i][0] += g * d[0]; A[i][1] += g * d[1]; A[i][2] += g * d[2];
          }
        }
      }
      return A;
    }
    step(dt) {
      const bs = this.bodies, n = bs.length;
      const A0 = this._accel();
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) bs[i].pos[k] += bs[i].vel[k] * dt + 0.5 * A0[i][k] * dt * dt;
      const A1 = this._accel();
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) bs[i].vel[k] += 0.5 * (A0[i][k] + A1[i][k]) * dt;
      if (this.collide) this._collide();
      if (this.constraint) this._applyConstraint();
      this.time += dt;
      return this;
    }
    _collide() {
      const bs = this.bodies;
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i], b = bs[j];
        const d = [a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]];
        const dist = Math.hypot(d[0], d[1], d[2]), rs = a.radius + b.radius;
        if (dist < rs && dist > 1e-9) {
          const nrm = [d[0] / dist, d[1] / dist, d[2] / dist];
          const rel = (a.vel[0] - b.vel[0]) * nrm[0] + (a.vel[1] - b.vel[1]) * nrm[1] + (a.vel[2] - b.vel[2]) * nrm[2];
          if (rel < 0) {
            const ma = a.mass, mb = b.mass, imp = 2 * rel / (ma + mb);
            for (let k = 0; k < 3; k++) { a.vel[k] -= imp * mb * nrm[k]; b.vel[k] += imp * ma * nrm[k]; }
          }
        }
      }
    }
    _applyConstraint() {
      if (this.constraint.type === 'sphere') {
        const R = this.constraint.R;
        for (const b of this.bodies) {
          const rr = Math.hypot(b.pos[0], b.pos[1], b.pos[2]) || 1e-12, s = R / rr;
          for (let k = 0; k < 3; k++) b.pos[k] *= s;
          const rhat = [b.pos[0] / R, b.pos[1] / R, b.pos[2] / R];
          const vr = b.vel[0] * rhat[0] + b.vel[1] * rhat[1] + b.vel[2] * rhat[2];
          for (let k = 0; k < 3; k++) b.vel[k] -= vr * rhat[k];   // 切向化：数学约束非力
        }
      }
    }
    energy() {
      let E = 0; const GM = this.G * this.M, bs = this.bodies, law = this.centralLaw;
      for (let i = 0; i < bs.length; i++) {
        const b = bs[i], v2 = b.vel[0] ** 2 + b.vel[1] ** 2 + b.vel[2] ** 2;
        const r = Math.hypot(b.pos[0], b.pos[1], b.pos[2]);
        let V;                                        // 中心势（单位质量）：a_mag=−dV/dr
        if (law) V = law[0] / r + law[1] * Math.log(r) - law[2] * r + law[3] / (2 * r * r);
        else V = -GM / r;
        E += 0.5 * b.mass * v2 + b.mass * V;
        if (this.mutual) for (let j = 0; j < i; j++) {
          const d = Math.hypot(b.pos[0] - bs[j].pos[0], b.pos[1] - bs[j].pos[1], b.pos[2] - bs[j].pos[2]);
          E += -this.G * b.mass * bs[j].mass / d;
        }
      }
      return E;
    }
    angularMomentum() {
      let L = [0, 0, 0];
      for (const b of this.bodies) {
        L[0] += b.mass * (b.pos[1] * b.vel[2] - b.pos[2] * b.vel[1]);
        L[1] += b.mass * (b.pos[2] * b.vel[0] - b.pos[0] * b.vel[2]);
        L[2] += b.mass * (b.pos[0] * b.vel[1] - b.pos[1] * b.vel[0]);
      }
      return L;
    }
    momentum() {
      let P = [0, 0, 0];
      for (const b of this.bodies) { P[0] += b.mass * b.vel[0]; P[1] += b.mass * b.vel[1]; P[2] += b.mass * b.vel[2]; }
      return P;
    }
    com() {
      let c = [0, 0, 0], m = 0;
      for (const b of this.bodies) { c[0] += b.mass * b.pos[0]; c[1] += b.mass * b.pos[1]; c[2] += b.mass * b.pos[2]; m += b.mass; }
      return [c[0] / m, c[1] / m, c[2] / m];
    }
    /** 离心率矢量（反平方中心力的数学不变量）：e_vec = ((v²−μ/r)·r − (r·v)·v)/μ */
    eccVector(i) {
      const b = this.bodies[i], GM = this.G * this.M;
      const r = b.pos, v = b.vel;
      const rr = Math.hypot(r[0], r[1], r[2]);
      const v2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
      const rv = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
      const c = v2 - GM / rr;
      return [
        (c * r[0] - rv * v[0]) / GM,
        (c * r[1] - rv * v[1]) / GM,
        (c * r[2] - rv * v[2]) / GM,
      ];
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
    // P = [ψ_0..ψ_{T-2}]ᵀ ((T-1)×r), Q = [ψ_1..ψ_{T-1}]；稳定 QR 最小二乘直接解 P·x = Q_o
    const P = new Array(T - 1);
    for (let t = 0; t < T - 1; t++) P[t] = psiSeq[t].slice();
    const A = [];
    let resid = 0;
    for (let o = 0; o < r; o++) {
      const y = new Array(T - 1);
      for (let t = 0; t < T - 1; t++) y[t] = psiSeq[t + 1][o];
      const sol = lstsq(P, y);
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
    // P = [[ψ_t | 1]] ((T-1)×(r+1)), Q = ψ_{t+1}；稳定 QR 最小二乘
    const P = new Array(T - 1);
    for (let t = 0; t < T - 1; t++) P[t] = psiSeq[t].concat([1]);
    const A = [];
    let resid = 0;
    for (let o = 0; o < r; o++) {
      const y = new Array(T - 1);
      for (let t = 0; t < T - 1; t++) y[t] = psiSeq[t + 1][o];
      const sol = lstsq(P, y);
      A.push(sol); // sol 长度 r+1，最后一列即 b
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

  /**
   * 二阶（AR(2)）边界动力学：ψ_{t+1} = A·ψ_t + B·ψ_{t−1} + c
   *
   * ⚠️ 为什么必须有这个：**波动方程是二阶系统**。用一阶仿射 ψ_{t+1}=Aψ_t+b 去拟合它，
   * 是把二阶动力学塞进一阶模型——实测声波场景 6 步样本外预测误差 **7.5e+1（7532%）**，
   * 不是精度不够，是模型类用错。热传导/对流是一阶系统，用 fitAffine 即可。
   *
   * 返回 M：r × (2r+1) 矩阵，列序 [ψ_t (r列) | ψ_{t−1} (r列) | 常数 (1列)]
   */
  function fitAffine2(psiSeq) {
    const T = psiSeq.length, r = psiSeq[0].length;
    if (T < 2 * r + 4) return null;
    const d = 2 * r + 1;
    // P_t = [ψ_t | ψ_{t−1} | 1]，t = 1 .. T-2，目标 ψ_{t+1}；稳定 QR 最小二乘
    const rows = T - 2;
    const P = new Array(rows);
    for (let t = 1; t < T - 1; t++) P[t - 1] = psiSeq[t].concat(psiSeq[t - 1], [1]);
    const A = [];
    let resid = 0;
    for (let o = 0; o < r; o++) {
      const y = new Array(rows);
      for (let t = 1; t < T - 1; t++) y[t - 1] = psiSeq[t + 1][o];
      const sol = lstsq(P, y);
      A.push(sol); // sol 长度 2r+1，列序 [ψ_t | ψ_{t−1} | 1]
      for (let t = 1; t < T - 1; t++) {
        let p = sol[2 * r];
        for (let a = 0; a < r; a++) p += sol[a] * psiSeq[t][a] + sol[r + a] * psiSeq[t - 1][a];
        const e = p - psiSeq[t + 1][o]; resid += e * e;
      }
    }
    let scale = 0;
    for (let t = 1; t < T; t++) for (let o = 0; o < r; o++) scale += psiSeq[t][o] * psiSeq[t][o];
    return { A, r, order: 2, rms: Math.sqrt(resid / Math.max(T - 2, 1)), relErr: scale > 0 ? Math.sqrt(resid / scale) : 0 };
  }

  /** 用二阶模型做多步预测：从 (psiPrev, psi0) 出发递推 steps 次，返回 [psi0, psi1, ...] */
  function predictAffine2(M, psi0, psiPrev, steps) {
    const r = psi0.length;
    const seq = [psi0.slice()];
    let cur = psi0.slice(), prev = psiPrev.slice();
    for (let s = 0; s < steps; s++) {
      const nxt = new Array(r).fill(0);
      for (let o = 0; o < r; o++) {
        let v = M[o][2 * r];
        for (let a = 0; a < r; a++) v += M[o][a] * cur[a] + M[o][r + a] * prev[a];
        nxt[o] = v;
      }
      seq.push(nxt); prev = cur; cur = nxt;
    }
    return seq;
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

  return {
    jacobiEigen, gaussSolve, lstsq,
    HeatWorld, HeatWorld3D, WaveWorld3D, PoissonWorld3D, AdvectDiffuseWorld3D, RigidBody3D, Grid3D, RealWorld3D,
    HoloMap, fitLinear, fitAffine, fitAffine2, predict, predictAffine, predictAffine2,
  };
});
