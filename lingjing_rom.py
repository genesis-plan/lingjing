"""
灵境 · 五层框架核心数学（Python / NumPy 版）
================================================================================
对应《"灵境"框架：三维物理现实+时间+全息对偶的通用虚拟空间》五层结构：

  L1 物理底座   : 二维热传导 PDE  ∂t φ = α∇²φ + s   （预置模型之一，MVP 只启用此模型）
  L2 体空间状态 : φ_h ∈ R^N（N = nx·ny 自由度）
  L3 全息映射   : POD/SVD 降阶 Φ_Holo ∈ R^{N×r}, r≪N；投影 ψ = Φᵀ(φ−φ̄)
  L4 边界智能层 : 低维动力学 ψ_{t+1} = A ψ_t（最小二乘），预测 / 干预 / 规划
  L5 反向映射   : 重建 φ' ≈ Φ ψ' + φ̄

与 JS 版（rom.js）的关系：
  - 语义逐一对齐，同一套验真数字可比（见 verify.py 与 verify.js）。
  - 本版是真升级，不是翻译：
      1. SVD 用 LAPACK（np.linalg.eigh）替代手写 Jacobi 旋转 —— 更稳、能上真规模；
      2. PDE 步长向量化，可扩展到十万~百万自由度（JS 版在 1200 维已显吃力）；
      3. 审计账本用【真 SHA-256】且【可重算】——JS 版 cyrb53 演示链把时间戳算进
         hash 却不落盘，导致 verify() 只能比对 prevHash 连续性，改内容仍返回 true
         （假绿）。本版把 ts 存入记录，verify 真正重算 hash，篡改必被抓。

诚实边界：
  - 这是【框架的最小真实实现】。每一层数学都真算（真 PDE 步进、真 SVD、真最小二乘），
    不是渲染假动画。MVP 仅启用热传导一个物理模型；刚体/弹性/流体/声学/电磁为后续。
  - ROM 是近似：重建有误差。分布外状态误差会飙升，这是 ROM【真实局限】而非 bug，
    本版如实暴露三个数：分布内 / 分布外 / 自适应后，不粉饰。
  - 灵数求解器（lingshu-solver）是 JS 实现，Python 侧无对应物；本模块不假装有。
    需要解方程时用 NumPy 求解，并在调用处如实标注"非灵数区间认证解"。

依赖：numpy（唯一第三方依赖）
"""
from __future__ import annotations

import hashlib
import json
import time
from typing import Callable, Dict, List, Optional, Sequence

import numpy as np

__all__ = [
    "HeatWorld", "HoloMap", "fit_linear", "predict",
    "VerifyLedger", "decide", "sha256",
]


# ==================== L1 + L2：物理底座 + 体空间状态 ====================

class HeatWorld:
    """
    二维热传导：∂t φ = α∇²φ + s
    显式 FTCS 离散。稳定条件（2D）：α·dt/dx² ≤ 1/4。
    场数组 shape = (ny, nx)，索引 field[j, i]，与 JS 版 j*nx+i 展平序一致。
    """

    def __init__(self, nx: int = 40, ny: int = 30, alpha: float = 0.2,
                 dt: float = 0.5, dx: float = 1.0, boundary: float = 0.0):
        self.nx, self.ny = int(nx), int(ny)
        self.N = self.nx * self.ny
        self.alpha, self.dt, self.dx = float(alpha), float(dt), float(dx)
        self.boundary = float(boundary)
        self.lam = self.alpha * self.dt / (self.dx ** 2)
        if self.lam > 0.25:
            # 不静默：显式格式超过 CFL 会数值爆炸，必须让调用方知道
            raise ValueError(
                f"CFL 不稳定：α·dt/dx² = {self.lam:.4f} > 0.25（2D 显式 FTCS 上限）。"
                f"请调小 dt 或 alpha，或调大 dx。"
            )
        self.field = np.zeros((self.ny, self.nx), dtype=np.float64)
        self.sources = np.zeros((self.ny, self.nx), dtype=np.float64)
        self.time = 0.0

    def init(self, f: Callable[[int, int], float]) -> np.ndarray:
        """
        设置初始场。f(i, j) -> value，i 为 x 方向、j 为 y 方向。

        与 JS 版（rom.js）的一处【已知的语义差异】，如实标注：
            本版在 init 时就施加 Dirichlet 边界；JS 版 init 不碰边界，要等第一次
            step() 才把边界设为 boundary 值。物理上本版更正确（初始条件本身应当
            满足边界条件）。代价是交叉验证时初始 mean 会略小于 JS（本例 0.10453
            vs 0.10463，差 1e-4），第一步之后两版即完全一致（末态 mean 同为
            0.10287）。这不是 bug，是差异，故在此写明而未强行迁就 JS。
        """
        ii, jj = np.meshgrid(np.arange(self.nx), np.arange(self.ny))
        vf = np.vectorize(f, otypes=[np.float64])
        self.field = vf(ii, jj).astype(np.float64)
        self._apply_boundary()
        return self.field

    def set_source(self, i: int, j: int, v: float) -> None:
        """施加源/汇（正值加热，负值冷却）。"""
        if 0 <= i < self.nx and 0 <= j < self.ny:
            self.sources[j, i] = float(v)

    def clear_sources(self) -> None:
        self.sources[:] = 0.0

    def _apply_boundary(self) -> None:
        b = self.boundary
        self.field[0, :] = b
        self.field[-1, :] = b
        self.field[:, 0] = b
        self.field[:, -1] = b

    def step(self) -> np.ndarray:
        """推进一步（L1 物理演化，向量化）。"""
        f = self.field
        lap = (f[:-2, 1:-1] + f[2:, 1:-1] + f[1:-1, :-2] + f[1:-1, 2:]
               - 4.0 * f[1:-1, 1:-1])
        new = f.copy()
        new[1:-1, 1:-1] = (f[1:-1, 1:-1] + self.lam * lap
                           + self.dt * self.sources[1:-1, 1:-1])
        self.field = new
        self._apply_boundary()
        self.time += self.dt
        return self.field

    def flat(self) -> np.ndarray:
        """体状态向量 φ_h ∈ R^N（C 序展平，与 JS 版 j*nx+i 一致）。"""
        return self.field.reshape(-1)

    def stats(self) -> Dict[str, float]:
        return {"max": float(self.field.max()),
                "min": float(self.field.min()),
                "mean": float(self.field.mean())}


# ==================== L3：全息映射（POD / SVD 降阶） ====================

class HoloMap:
    """
    Φ_Holo ∈ R^{N×r}，method of snapshots：
        C = Xᵀ X / T （T×T，T ≪ N）→ 特征分解 → 取前 r 个模态，模态 = X·v 后归一化。
    """

    def __init__(self, N: int, max_snap: int = 80):
        self.N = int(N)
        self.max_snap = int(max_snap)
        self.snaps: List[np.ndarray] = []
        self.mean: Optional[np.ndarray] = None
        self.modes: Optional[np.ndarray] = None      # (N, r)
        self.lambda_: Optional[np.ndarray] = None    # 已取模态特征值（降序）
        self.all_lambda: Optional[np.ndarray] = None  # 全部正特征值
        self.r = 0

    @property
    def T(self) -> int:
        return len(self.snaps)

    def collect(self, phi) -> None:
        """收集体状态快照 φ_h。"""
        v = np.asarray(phi, dtype=np.float64).reshape(-1)
        if v.size != self.N:
            raise ValueError(f"快照维度 {v.size} ≠ 声明 N {self.N}")
        self.snaps.append(v.copy())
        if len(self.snaps) > self.max_snap:
            self.snaps.pop(0)

    def build(self, r: int = 4) -> Optional[Dict]:
        """构建全息映射核（离线阶段 = POD/SVD）。"""
        T = len(self.snaps)
        if T < 4:
            return None
        X = np.stack(self.snaps, axis=1)          # (N, T)
        self.mean = X.mean(axis=1)
        Xc = X - self.mean[:, None]

        C = (Xc.T @ Xc) / T                        # (T, T) 对称
        vals, vecs = np.linalg.eigh(C)             # LAPACK：比手写 Jacobi 更稳
        order = np.argsort(vals)[::-1]
        vals, vecs = vals[order], vecs[:, order]
        self.all_lambda = vals[vals > 0.0]

        rr = min(int(r), T - 1)
        modes, lam = [], []
        for m in range(rr):
            lv = float(max(vals[m], 0.0))
            if lv <= 1e-14:
                break
            mode = Xc @ vecs[:, m]
            nrm = float(np.linalg.norm(mode))
            if nrm < 1e-14:
                continue
            modes.append(mode / nrm)
            lam.append(lv)

        if not modes:
            self.modes, self.lambda_, self.r = None, np.array([]), 0
            return None
        self.modes = np.stack(modes, axis=1)       # (N, r)
        self.lambda_ = np.asarray(lam, dtype=np.float64)
        self.r = self.modes.shape[1]
        return {"r": self.r, "lambda": self.lambda_, "energy": self.energy()}

    def energy(self) -> float:
        """
        真实能量捕获率：前 r 个模态特征值之和 / 【全部】正特征值之和。
        （分母必须是全部模态。若只用已取模态做分母，结果恒为 100%，属自欺指标。）
        """
        if self.lambda_ is None or self.all_lambda is None or self.all_lambda.size == 0:
            return 0.0
        tot = float(self.all_lambda.sum())
        got = float(self.lambda_.sum())
        return got / tot if tot > 0 else 0.0

    def effective_rank(self, tol: float = 1e-6) -> int:
        """
        有效秩：λ_m > λ_max·tol 的模态个数（默认 tol=1e-6）。

        为什么要单独报这个数：能量捕获率对【数值噪声模态】不敏感——
        一批高度相关的快照会让谱在某个位置断崖（如 λ 从 1e2 跌到 1e-3），
        此后补进来的模态纯属噪声，却仍被算作"已捕获"，使能量捕获率逼近 100%，
        看起来极漂亮、实则毫无表示能力。所以能量捕获率必须与有效秩一起看：
        r > 有效秩，就说明多出来的模态是噪声，该收窄 r 或扩充快照多样性。

        诚实边界：有效秩依赖 tol，是个判据相关的量，不存在唯一"正确"值。
        因此另提供 spectrum_ratios() 把 λ_m/λ_0 全序列摆出来，由读者自行判断
        断崖在哪——比任何单一阈值都诚实。
        """
        if self.all_lambda is None or self.all_lambda.size == 0:
            return 0
        lam_max = float(self.all_lambda[0])
        if lam_max <= 0:
            return 0
        return int(np.sum(self.all_lambda > lam_max * tol))

    def spectrum_ratios(self) -> Optional[np.ndarray]:
        """相对谱 λ_m / λ_0（降序）。断崖位置一眼可见。"""
        if self.all_lambda is None or self.all_lambda.size == 0:
            return None
        l0 = float(self.all_lambda[0])
        return self.all_lambda / l0 if l0 > 0 else None

    def cliff_index(self, factor: float = 1e3) -> int:
        """
        谱断崖位置：第一个满足 λ_{m+1}/λ_m < 1/factor 的索引 m+1。
        无断崖返回 -1。断崖之前才是真正"主导"的自由度数。
        """
        if self.all_lambda is None or self.all_lambda.size < 2:
            return -1
        lam = self.all_lambda[self.all_lambda > 0]
        for m in range(len(lam) - 1):
            if lam[m + 1] / lam[m] < 1.0 / factor:
                return m + 1
        return -1

    def project(self, phi) -> Optional[np.ndarray]:
        """L3 投影 φ → ψ（低维边界状态）。"""
        if self.modes is None:
            return None
        v = np.asarray(phi, dtype=np.float64).reshape(-1)
        return self.modes.T @ (v - self.mean)

    def reconstruct(self, psi) -> np.ndarray:
        """L5 反向映射 ψ → φ'（重建体状态）。"""
        psi = np.asarray(psi, dtype=np.float64).reshape(-1)
        return self.mean + self.modes @ psi

    def recon_error(self, phi) -> float:
        """重建相对 L2 误差（诚实指标，不取整）。"""
        v = np.asarray(phi, dtype=np.float64).reshape(-1)
        psi = self.project(v)
        if psi is None:
            return float("nan")
        rec = self.reconstruct(psi)
        den = float(np.linalg.norm(v))
        return float(np.linalg.norm(rec - v) / den) if den > 0 else 0.0

    def maybe_adapt(self, phi, threshold: float = 0.05, r: Optional[int] = None) -> Dict:
        """
        自适应更新（对应框架 §3「偏差超阈值时触发重新训练」）。
        超阈值 → 吸收该观测进快照库 → 重算 POD 核。
        诚实边界：对已观测/邻近状态精度提升显著；全新分布仍需扩充快照重训练。
        """
        err = self.recon_error(phi)
        if not (err > threshold):
            return {"adapted": False, "err": err}
        self.collect(phi)
        self.build(r if r is not None else max(self.r, 4))
        return {"adapted": True, "err_before": err, "err_after": self.recon_error(phi)}


# ==================== L4：边界智能层（低维动力学） ====================

def fit_linear(psi_seq: Sequence[Sequence[float]]) -> Optional[Dict]:
    """
    最小二乘拟合 ψ_{t+1} = A ψ_t。
    返回 {A (r×r), rms, rel_err, r}。A[o][a]：pred_o = Σ_a A[o][a]·ψ_a
    """
    S = np.asarray(psi_seq, dtype=np.float64)
    if S.ndim != 2 or S.shape[0] < 3:
        return None
    T, r = S.shape
    P, Q = S[:-1], S[1:]                       # P:(T-1,r)  Q:(T-1,r)
    # Q ≈ P @ A.T  →  A = lstsq(P, Q).T
    sol, *_ = np.linalg.lstsq(P, Q, rcond=None)
    A = sol.T
    resid = float(((P @ A.T - Q) ** 2).sum())
    scale = float((S[1:] ** 2).sum())
    return {
        "A": A,
        "r": int(r),
        "rms": float(np.sqrt(resid / max(T - 1, 1))),
        "rel_err": float(np.sqrt(resid / scale)) if scale > 0 else 0.0,
    }


def predict(A: np.ndarray, psi0: Sequence[float], steps: int) -> List[np.ndarray]:
    """用 A 做多步预测：返回 [ψ_t, ψ_{t+1}, ..., ψ_{t+steps}]。"""
    A = np.asarray(A, dtype=np.float64)
    cur = np.asarray(psi0, dtype=np.float64).reshape(-1)
    seq = [cur.copy()]
    for _ in range(int(steps)):
        cur = A @ cur
        seq.append(cur.copy())
    return seq


# ==================== 灵脑风格：可审计决策核（真 SHA-256） ====================

def sha256(obj) -> str:
    """确定性 SHA-256（sort_keys 保证 dict 序列化稳定）。"""
    s = obj if isinstance(obj, str) else json.dumps(obj, sort_keys=True,
                                                    separators=(",", ":"),
                                                    ensure_ascii=False)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


class VerifyLedger:
    """
    不可篡改审计账本（SHA-256 哈希链）。

    与 JS 版的关键差别（修掉一个假绿）：
      JS 版把 Date.now() 算进 hash 却不存时间戳，verify() 只能比对 prevHash 连续性，
      【改掉某条 entry 内容仍返回 true】。本版把 ts 写入记录，verify() 用记录里的
      ts 真正重算 hash —— 内容篡改、断链、重排都会被抓出来。
    """

    def __init__(self, namespace: str = "lingjing"):
        self.namespace = namespace
        self.genesis = sha256(f"GENESIS::{namespace}")
        self._head = self.genesis
        self.chain: List[Dict] = []

    @staticmethod
    def _body(prev: str, ts: float, entry) -> str:
        return json.dumps({"prev": prev, "ts": ts, "e": entry},
                          sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                          default=str)

    def append(self, entry) -> Dict:
        ts = time.time()
        prev = self._head
        h = sha256(self._body(prev, ts, entry))
        rec = {"seq": len(self.chain) + 1, "ts": ts, "prev_hash": prev,
               "hash": h, "entry": entry}
        self.chain.append(rec)
        self._head = h
        return rec

    def verify(self) -> bool:
        """重算每一条 hash 并校验链连续。任一处被篡改即 False。"""
        head = self.genesis
        for rec in self.chain:
            if rec["prev_hash"] != head:
                return False                       # 断链 / 重排
            if sha256(self._body(rec["prev_hash"], rec["ts"], rec["entry"])) != rec["hash"]:
                return False                       # 内容篡改
            head = rec["hash"]
        return head == self._head

    def __len__(self) -> int:
        return len(self.chain)


def decide(task, ctx: Dict) -> Dict:
    """
    FIREWALL 信任防火墙 + fail-closed 决策门。
    任一约束不满足 → approved=False（零释放）。未知即拒，绝不默认放行。
    门：G1 电量 / G2 容量 / G3 路径冲突 / G4 证据来源 / G5 热安全（灵境物理安全）
    """
    ctx = ctx or {}
    gates: List[Dict] = []

    floor = ctx.get("power_floor", 0.2)
    power = ctx.get("power")
    ok_power = isinstance(power, (int, float)) and power >= floor
    gates.append({"name": "G1-power", "pass": bool(ok_power),
                  "detail": f"power={'未知' if power is None else round(float(power), 4)} floor={floor}"})

    cap = ctx.get("cap", 1)
    load = ctx.get("load")
    ok_cap = isinstance(load, (int, float)) and load <= cap
    gates.append({"name": "G2-capacity", "pass": bool(ok_cap),
                  "detail": f"load={'未知' if load is None else load} cap={cap}"})

    ok_path = not ctx.get("conflict", False)
    gates.append({"name": "G3-path", "pass": bool(ok_path),
                  "detail": "路径冲突" if ctx.get("conflict") else "无冲突"})

    ok_ev = bool(task and (task.get("from") if isinstance(task, dict) else None))
    gates.append({"name": "G4-evidence", "pass": bool(ok_ev),
                  "detail": f"from={task.get('from')}" if ok_ev else "无来源"})

    if ctx.get("temp_limit") is not None:
        limit = ctx["temp_limit"]
        tmax = ctx.get("temp_max")
        ok_temp = isinstance(tmax, (int, float)) and tmax <= limit
        gates.append({"name": "G5-thermal", "pass": bool(ok_temp),
                      "detail": f"tempMax={'未知' if tmax is None else round(float(tmax), 4)} limit={limit}"})

    blocked = [g for g in gates if not g["pass"]]
    if blocked:
        return {"approved": False, "gate": "deny",
                "reason": "FIREWALL-DENY: " + "; ".join(f"{g['name']}({g['detail']})" for g in blocked),
                "blocked": blocked}
    return {"approved": True, "gate": "allow",
            "reason": "FIREWALL-ALLOW: 全部约束通过", "blocked": []}
