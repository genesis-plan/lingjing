'use strict';
/*
 * 灵境数学框架 · 降阶层（POD/SVD）与"全息"压缩（标注为隐喻）
 * --------------------------------------------------------------------------
 *   - POD 用 method-of-snapshots：对 C = XᵀX 做 Jacobi 特征分解
 *     （X 为去均值快照矩阵，列 = 快照）。快照数 n 通常远小于维数 d，故高效。
 *   - lstsq 用 Householder QR（向后稳定），避免 XᵀX 法方程把条件数平方（病态必崩）。
 *   - holographicCompress：高维 bulk 状态 ↔ 低维 boundary 模态。
 *
 *   ⚠️ 诚实标注：这是 ROM 意义下的"体↔边界"压缩映射，数学上是 POD/SVD，
 *      绝非字面 AdS/CFT（那是一条物理猜想）。此处只作隐喻，不可当严格定理基础。
 *      哥德尔不完备定理不进本模块（它推不出"意识不可算法模拟"）。
 */

// ---- 对称矩阵 Jacobi 特征分解（经典循环 Jacobi）----
function jacobiEigen(S, maxIter = 500, tol = 1e-12) {
  const n = S.length;
  const A = S.map(r => r.slice());
  const V = [];
  for (let i = 0; i < n; i++) { V.push(new Array(n).fill(0)); V[i][i] = 1; }
  for (let iter = 0; iter < maxIter; iter++) {
    let p = 0, q = 1, max = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (Math.abs(A[i][j]) > max) { max = Math.abs(A[i][j]); p = i; q = j; }
    if (max < tol) break;
    const app = A[p][p], aqq = A[q][q], apq = A[p][q];
    const theta = 0.5 * Math.atan2(2 * apq, app - aqq);
    const c = Math.cos(theta), s = Math.sin(theta);
    for (let k = 0; k < n; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
    for (let k = 0; k < n; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
    for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
  }
  const values = [];
  for (let i = 0; i < n; i++) values.push(A[i][i]);
  return { values, vectors: V }; // vectors 为列向量
}

// ---- POD（method of snapshots）----
// 关键：候选模态用"修正 Gram-Schmidt"重正交，残余 < gsTol·原长 的丢弃
//       （近退化 / 数值噪声模态在归一化后会与真实模态平行，污染重建 —— 必须剔除）
function pod(snapshots, { floor = 1e-12, gsTol = 1e-3 } = {}) {
  const n = snapshots.length;
  const d = snapshots[0].length;
  // 去均值（列均值）
  const mean = new Float64Array(d);
  for (const s of snapshots) for (let i = 0; i < d; i++) mean[i] += s[i];
  for (let i = 0; i < d; i++) mean[i] /= n;
  const Dc = snapshots.map(s => { const v = new Float64Array(d); for (let i = 0; i < d; i++) v[i] = s[i] - mean[i]; return v; });
  // C = Dcᵀ Dc  (n × n)
  const C = []; for (let i = 0; i < n; i++) C.push(new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) { let s = 0; for (let k = 0; k < d; k++) s += Dc[i][k] * Dc[j][k]; C[i][j] = s; }
  const { values, vectors } = jacobiEigen(C);
  const order = [...Array(n).keys()].sort((a, b) => values[b] - values[a]);
  const lambdaMax = Math.max(values[order[0]], 0);
  const modes = [], singularValues = [];
  let total = 0; for (let i = 0; i < n; i++) total += values[i];
  for (const k of order) {
    if (values[k] < lambdaMax * floor) continue; // 噪声地板：谱衰减到浮点噪声层的小 λ 是数值垃圾
    // 候选模态 phi = Dcᵀ w_k
    const phi = new Float64Array(d);
    for (let i = 0; i < d; i++) { let s = 0; for (let j = 0; j < n; j++) s += Dc[j][i] * vectors[j][k]; phi[i] = s; }
    let origNorm = 0; for (let i = 0; i < d; i++) origNorm += phi[i] * phi[i]; origNorm = Math.sqrt(origNorm);
    // 修正 Gram-Schmidt：减去已接受模态的投影
    for (const m of modes) {
      let dot = 0; for (let i = 0; i < d; i++) dot += phi[i] * m[i];
      for (let i = 0; i < d; i++) phi[i] -= dot * m[i];
    }
    let norm = 0; for (let i = 0; i < d; i++) norm += phi[i] * phi[i]; norm = Math.sqrt(norm);
    if (norm < gsTol * Math.max(origNorm, 1e-12)) continue; // 残余过小 = 数值依赖/噪声，丢弃
    for (let i = 0; i < d; i++) phi[i] /= norm;
    modes.push(phi);
    singularValues.push(Math.sqrt(Math.max(values[k], 0)));
  }
  const energy = modes.length > 0
    ? singularValues.reduce((a, b) => a + b * b, 0) / Math.max(total, 1e-30)
    : 0;
  return { modes, singularValues, energy, rank: modes.length, d, n };
}

// ---- Householder QR 最小二乘 ----
// 不累积 Q：直接把每个反射子 H_k 按同一顺序作用到 b 上得到 Qᵀb（避免 Q 累积顺序坑，向后稳定）
function householderQR(Ain) {
  const m = Ain.length, n = Ain[0].length;
  const A = Ain.map(r => r.slice());
  const Q = []; for (let i = 0; i < m; i++) { Q.push(new Array(m).fill(0)); Q[i][i] = 1; }
  const reflectors = [];
  for (let k = 0; k < n; k++) {
    let norm = 0; for (let i = k; i < m; i++) norm += A[i][k] * A[i][k]; norm = Math.sqrt(norm);
    if (norm < 1e-15) continue;
    const sign = A[k][k] >= 0 ? 1 : -1;
    const u1 = A[k][k] + sign * norm;
    const u = new Array(m).fill(0); u[k] = u1; for (let i = k + 1; i < m; i++) u[i] = A[i][k];
    let u2 = u1 * u1; for (let i = k + 1; i < m; i++) u2 += u[i] * u[i];
    const beta = 2 / u2;
    for (let j = k; j < n; j++) {
      let dot = 0; for (let i = 0; i < m; i++) dot += u[i] * A[i][j];
      for (let i = 0; i < m; i++) A[i][j] -= beta * dot * u[i];
    }
    reflectors.push({ u, beta });
  }
  // Q = H_{n-1}·…·H_0：按反射子顺序逆序右乘累积，保证 A = Q R
  for (let k = n - 1; k >= 0; k--) {
    const { u, beta } = reflectors[k];
    for (let j = 0; j < m; j++) {
      let dot = 0; for (let i = 0; i < m; i++) dot += u[i] * Q[i][j];
      for (let i = 0; i < m; i++) Q[i][j] -= beta * dot * u[i];
    }
  }
  return { Q, R: A };
}

function lstsq(Ain, bin) {
  const m = Ain.length, n = Ain[0].length;
  const A = Ain.map(r => r.slice());
  const c = bin.slice();
  for (let k = 0; k < n; k++) {
    let norm = 0; for (let i = k; i < m; i++) norm += A[i][k] * A[i][k]; norm = Math.sqrt(norm);
    if (norm < 1e-15) continue;
    const sign = A[k][k] >= 0 ? 1 : -1;
    const u1 = A[k][k] + sign * norm;
    const u = new Array(m).fill(0); u[k] = u1; for (let i = k + 1; i < m; i++) u[i] = A[i][k];
    let u2 = u1 * u1; for (let i = k + 1; i < m; i++) u2 += u[i] * u[i];
    const beta = 2 / u2;
    for (let j = k; j < n; j++) {
      let dot = 0; for (let i = 0; i < m; i++) dot += u[i] * A[i][j];
      for (let i = 0; i < m; i++) A[i][j] -= beta * dot * u[i];
    }
    // c := H_k c  （与 A 同一顺序）→ 终态 c = Qᵀ b
    let dotc = 0; for (let i = 0; i < m; i++) dotc += u[i] * c[i];
    for (let i = 0; i < m; i++) c[i] -= beta * dotc * u[i];
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = c[i];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
    x[i] = Math.abs(A[i][i]) < 1e-15 ? 0 : s / A[i][i];
  }
  return x;
}

// ---- "全息"压缩（标注隐喻）----
function holographicCompress(snapshots, { floor = 1e-12 } = {}) {
  const res = pod(snapshots, { floor });
  const d = res.d, rank = res.rank, n = snapshots.length;
  const mean = new Float64Array(d);
  for (const s of snapshots) for (let i = 0; i < d; i++) mean[i] += s[i];
  for (let i = 0; i < d; i++) mean[i] /= n;
  // boundary 系数：coeffs[i][k] = modes[k] · (snapshot_i − mean)
  const coeffs = [];
  for (let i = 0; i < n; i++) {
    const centered = new Float64Array(d);
    for (let j = 0; j < d; j++) centered[j] = snapshots[i][j] - mean[j];
    const c = new Array(rank).fill(0);
    for (let k = 0; k < rank; k++) { let s = 0; for (let j = 0; j < d; j++) s += res.modes[k][j] * centered[j]; c[k] = s; }
    coeffs.push(c);
  }
  return {
    modes: res.modes, singularValues: res.singularValues, energy: res.energy,
    rank, d, n, mean: Array.from(mean), coeffs,
    note: 'ROM compression (POD/SVD). Metaphor for bulk<->boundary, NOT literal AdS/CFT.',
  };
}

// 由 boundary 系数重建 bulk 快照（验证压缩可逆性）
function reconstruct(holo, i) {
  const d = holo.d, c = holo.coeffs[i];
  const out = Float64Array.from(holo.mean);
  for (let k = 0; k < holo.rank; k++)
    for (let j = 0; j < d; j++) out[j] += c[k] * holo.modes[k][j];
  return out;
}

module.exports = { pod, lstsq, holographicCompress, reconstruct, jacobiEigen };
