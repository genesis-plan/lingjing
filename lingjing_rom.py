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
    "HeatWorld", "Grid3D", "HeatWorld3D", "WaveWorld3D", "PoissonWorld3D",
    "AdvectDiffuseWorld3D", "RigidBody3D", "HoloMap",
    "fit_linear", "fit_affine", "fit_affine2",
    "predict", "predict_affine", "predict_affine2",
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


class Grid3D:
    """
    三维世界的【公共底座】——网格 + 世界坐标系 + 边界 + 七点拉普拉斯。
    所有物理世界（热传导 / 声波 / 静电势 / 流体输运）都继承它，
    这样"唯一原点居中、XYZ 有正负半轴"这套坐标系只有一份实现，不会各写各的。

    场数组 shape = (nz, ny, nx)，展平为 C 序后与 JS 版 (k*ny + j)*nx + i 逐位一致。
    """

    def __init__(self, nx: int = 21, ny: int = 21, nz: int = 21,
                 dx: float = 1.0, boundary: float = 0.0):
        self.nx, self.ny, self.nz = int(nx), int(ny), int(nz)
        self.N = self.nx * self.ny * self.nz
        self.dx = float(dx)
        self.boundary = float(boundary)
        self.field = np.zeros((self.nz, self.ny, self.nx), dtype=np.float64)
        self.sources = np.zeros((self.nz, self.ny, self.nx), dtype=np.float64)
        self.time = 0.0

    def idx(self, i: int, j: int, k: int) -> int:
        return (k * self.ny + j) * self.nx + i

    # ------------------------------------------------------------------
    # 世界坐标系：唯一原点 (0,0,0) 在网格【正中心】，X/Y/Z 各有正负半轴。
    # 网格取奇数时原点落在真实格点上（n=21 → 索引 10 的坐标恰为 0，正负各 10 格）；
    # 取偶数时原点落在两格点中间，world()["origin_on_grid_point"] 会如实报 False。
    # 物理坐标 x = (i - ox)·dx ，反过来 i = round(x/dx + ox)。
    # ------------------------------------------------------------------
    @property
    def ox(self) -> float:
        return (self.nx - 1) / 2.0

    @property
    def oy(self) -> float:
        return (self.ny - 1) / 2.0

    @property
    def oz(self) -> float:
        return (self.nz - 1) / 2.0

    def x_of(self, i: int) -> float:
        return (i - self.ox) * self.dx

    def y_of(self, j: int) -> float:
        return (j - self.oy) * self.dx

    def z_of(self, k: int) -> float:
        return (k - self.oz) * self.dx

    def i_of(self, x: float) -> int:
        return int(round(x / self.dx + self.ox))

    def j_of(self, y: float) -> int:
        return int(round(y / self.dx + self.oy))

    def k_of(self, z: float) -> int:
        return int(round(z / self.dx + self.oz))

    def index_at(self, x: float, y: float, z: float) -> int:
        i, j, k = self.i_of(x), self.j_of(y), self.k_of(z)
        if not (0 <= i < self.nx and 0 <= j < self.ny and 0 <= k < self.nz):
            return -1
        return self.idx(i, j, k)

    def coords_of(self, p: int) -> Tuple[float, float, float]:
        i = p % self.nx
        j = (p // self.nx) % self.ny
        k = p // (self.nx * self.ny)
        return self.x_of(i), self.y_of(j), self.z_of(k)

    def world(self) -> dict:
        return {
            "xmin": self.x_of(0), "xmax": self.x_of(self.nx - 1),
            "ymin": self.y_of(0), "ymax": self.y_of(self.ny - 1),
            "zmin": self.z_of(0), "zmax": self.z_of(self.nz - 1),
            "dx": self.dx,
            "origin_index": [self.ox, self.oy, self.oz],
            "origin_on_grid_point": float(self.ox).is_integer()
            and float(self.oy).is_integer() and float(self.oz).is_integer(),
        }

    def init(self, f: Callable[[float, float, float], float]) -> np.ndarray:
        """设置初始场 f(x, y, z)，坐标为【物理世界坐标，带正负】，不是网格索引。"""
        # ⚠️ 场数组 shape = (nz, ny, nx)，必须按 (nz, ny, nx) 生成网格并用 kk, jj, ii 接收。
        #    写成 ii, jj, kk = meshgrid(nx, ny, nz) 会让 x/y/z 串位（形状相同不报错，极隐蔽）。
        kk, jj, ii = np.meshgrid(np.arange(self.nz), np.arange(self.ny),
                                 np.arange(self.nx), indexing="ij")
        xs = (ii - self.ox) * self.dx
        ys = (jj - self.oy) * self.dx
        zs = (kk - self.oz) * self.dx
        vf = np.vectorize(f, otypes=[np.float64])
        self.field = vf(xs, ys, zs).astype(np.float64)
        self._apply_boundary()
        return self.field

    def set_source(self, x: float, y: float, z: float, v: float) -> None:
        i, j, k = self.i_of(x), self.j_of(y), self.k_of(z)
        if 0 <= i < self.nx and 0 <= j < self.ny and 0 <= k < self.nz:
            self.sources[k, j, i] = float(v)

    def clear_sources(self) -> None:
        self.sources[:] = 0.0

    def _apply_boundary(self, arr=None) -> None:
        """六面 Dirichlet 边界。arr 省略时作用于主场；蛙跳的 prev 层也必须施加。"""
        f = self.field if arr is None else arr
        b = self.boundary
        f[:, :, 0] = b
        f[:, :, -1] = b
        f[:, 0, :] = b
        f[:, -1, :] = b
        f[0, :, :] = b
        f[-1, :, :] = b

    def is_boundary_mask(self) -> np.ndarray:
        """内部格点掩码：True 表示参与演化（非边界）。"""
        m = np.ones((self.nz, self.ny, self.nx), dtype=bool)
        m[0, :, :] = m[-1, :, :] = False
        m[:, 0, :] = m[:, -1, :] = False
        m[:, :, 0] = m[:, :, -1] = False
        return m

    def stats(self) -> Dict[str, float]:
        return {"max": float(self.field.max()),
                "min": float(self.field.min()),
                "mean": float(self.field.mean())}

    def flat(self) -> np.ndarray:
        """体状态向量 φ_h ∈ R^N（C 序展平，与 JS 版 (k*ny+j)*nx+i 一致）。"""
        return self.field.reshape(-1)

    def slice_z(self, k: int) -> np.ndarray:
        """取 z=k 的切片，shape (ny, nx)。"""
        return self.field[k]

    def slice_at_z(self, z: float) -> np.ndarray:
        """按【物理坐标】取 z 平面切片（取最近的一层），shape (ny, nx)。"""
        return self.field[self.k_of(z)]

    def _laplacian(self, a: np.ndarray) -> np.ndarray:
        """七点拉普拉斯 ∇²a（内部；边界返回 0）。"""
        lap = np.zeros_like(a)
        lap[1:-1, 1:-1, 1:-1] = (
            a[1:-1, 1:-1, :-2] + a[1:-1, 1:-1, 2:]
            + a[1:-1, :-2, 1:-1] + a[1:-1, 2:, 1:-1]
            + a[:-2, 1:-1, 1:-1] + a[2:, 1:-1, 1:-1]
            - 6.0 * a[1:-1, 1:-1, 1:-1]
        ) / (self.dx ** 2)
        return lap


class HeatWorld3D(Grid3D):
    """
    三维热传导：∂t φ = α∇²φ + s
    显式 FTCS 七点格式。稳定条件（3D）：α·dt/dx² ≤ 1/6（比 2D 的 1/4 更严）。

    与 2D 版的一处【刻意不同】：2D 版 JS 的 init() 不施加边界、要等第一次 step()，
    而 Python 版 init() 立即施加，导致交叉验证初始 mean 差 1e-4（README §5 已记）。
    3D 版两轨统一在 init() 就施加边界，故 3D 的 JS/Python 交叉验证从 t=0 起即逐位可比。
    """

    def __init__(self, nx: int = 21, ny: int = 21, nz: int = 21, alpha: float = 0.2,
                 dt: float = 0.5, dx: float = 1.0, boundary: float = 0.0):
        super().__init__(nx=nx, ny=ny, nz=nz, dx=dx, boundary=boundary)
        self.alpha, self.dt = float(alpha), float(dt)
        self.lam = self.alpha * self.dt / (self.dx ** 2)
        if self.lam > 1.0 / 6.0:
            raise ValueError(
                f"CFL 不稳定：α·dt/dx² = {self.lam:.4f} > 1/6（3D 显式 FTCS 上限）。"
                f"请调小 dt 或 alpha，或调大 dx。"
            )

    def step(self) -> np.ndarray:
        f = self.field
        nxt = f + self.dt * (self.alpha * self._laplacian(f) + self.sources)
        self._apply_boundary_arr(nxt)
        self.field = nxt
        self.time += self.dt
        return self.field

    def _apply_boundary_arr(self, arr: np.ndarray) -> None:
        b = self.boundary
        arr[0, :, :] = b
        arr[-1, :, :] = b
        arr[:, 0, :] = b
        arr[:, -1, :] = b
        arr[:, :, 0] = b
        arr[:, :, -1] = b


class WaveWorld3D(Grid3D):
    """
    三维声波（双曲型）：∂²u/∂t² = c²∇²u − γ·∂u/∂t
    Leapfrog（蛙跳）显式格式；3D 稳定条件 Courant 数 c·dt/dx ≤ 1/√3 ≈ 0.5774。

    与热传导【根本不同】：热是抛物型（平滑、不可逆、有耗散），波是双曲型（不平滑、可逆、能量守恒）。
    因此这里用【能量守恒】而不是"衰减到 0"来验真——波跑一圈回来还是那个波。
    """

    def __init__(self, nx: int = 21, ny: int = 21, nz: int = 21, c: float = 1.0,
                 dt: float = 0.2, dx: float = 1.0, boundary: float = 0.0,
                 damping: float = 0.0):
        super().__init__(nx=nx, ny=ny, nz=nz, dx=dx, boundary=boundary)
        self.c, self.dt = float(c), float(dt)
        self.damping = float(damping)
        self.courant = self.c * self.dt / self.dx
        if self.courant > 1.0 / np.sqrt(3.0):
            raise ValueError(
                f"CFL 不稳定：c·dt/dx = {self.courant:.4f} > 1/√3≈0.5774"
                f"（3D 波动方程上限）。请调小 dt 或 c。"
            )
        self.prev = np.zeros_like(self.field)

    def init(self, f, g=None) -> np.ndarray:
        """f(x,y,z)=初始位移 u₀；g(x,y,z)=初始速度（可选，默认 0）。"""
        super().init(f)
        if g is None:
            self.prev = self.field.copy()
        else:
            vf = np.vectorize(g, otypes=[np.float64])
            kk, jj, ii = np.meshgrid(np.arange(self.nz), np.arange(self.ny),
                                     np.arange(self.nx), indexing="ij")
            v0 = vf((ii - self.ox) * self.dx, (jj - self.oy) * self.dx,
                    (kk - self.oz) * self.dx)
            self.prev = self.field - self.dt * v0
        # ★ prev 层同样要满足边界条件；漏掉会让 u⁻¹ 在边界非零，
        #   动能项凭空多出 ½(b/dt)²，误差随 dt 缩小反而【放大】。
        self._apply_boundary(self.prev)
        return self.field

    def step(self) -> np.ndarray:
        a = 1.0 + self.damping * self.dt / 2.0
        b = 1.0 - self.damping * self.dt / 2.0
        lap = self._laplacian(self.field)
        nxt = (2.0 * self.field - b * self.prev
               + (self.c ** 2) * (self.dt ** 2) * lap) / a
        nxt = nxt + (self.dt ** 2) * self.sources
        self._apply_boundary(nxt)
        self.prev = self.field
        self.field = nxt
        self.time += self.dt
        return self.field

    def energy(self) -> float:
        """
        蛙跳格式的【严格守恒量】：
          E = ½‖(uⁿ⁺¹−uⁿ)/dt‖²·dx³ + (c²/2)·Σ_edges (Δuⁿ⁺¹)(Δuⁿ)/dx²·dx³
        势能用【相邻两层的前向差分沿边内积】（与七点模板严格分部求和匹配）。
        用中心差分或错半层都会测出假漂移（实测虚报 2.9% / 19%）。
        """
        du = self.field - self.prev
        kin = float(np.sum((du / self.dt) ** 2))   # 0.5 在 return 处统一乘，别乘两次
        pot = 0.0
        pot += float(np.sum((self.field[:, :, 1:] - self.field[:, :, :-1])
                            * (self.prev[:, :, 1:] - self.prev[:, :, :-1])))
        pot += float(np.sum((self.field[:, 1:, :] - self.field[:, :-1, :])
                            * (self.prev[:, 1:, :] - self.prev[:, :-1, :])))
        pot += float(np.sum((self.field[1:, :, :] - self.field[:-1, :, :])
                            * (self.prev[1:, :, :] - self.prev[:-1, :, :])))
        pot *= (self.c ** 2) / (self.dx ** 2)
        return 0.5 * (kin + pot) * (self.dx ** 3)


class PoissonWorld3D(Grid3D):
    """
    静电势（椭圆型）：∇²φ = −ρ/ε₀，Dirichlet 边界。
    椭圆型——没有时间演化，是"瞬时平衡"问题，用 Jacobi 迭代求解。
    它是【线性的】，所以可以严格验证叠加原理：两个电荷的解 = 各自解的逐点和。
    """

    def __init__(self, nx: int = 21, ny: int = 21, nz: int = 21,
                 dx: float = 1.0, boundary: float = 0.0, eps0: float = 1.0):
        super().__init__(nx=nx, ny=ny, nz=nz, dx=dx, boundary=boundary)
        self.eps0 = float(eps0)
        self.iters = 0
        self.residual = float("inf")

    def set_rho(self, fn) -> np.ndarray:
        kk, jj, ii = np.meshgrid(np.arange(self.nz), np.arange(self.ny),
                                 np.arange(self.nx), indexing="ij")
        vf = np.vectorize(fn, otypes=[np.float64])
        self.sources = vf((ii - self.ox) * self.dx, (jj - self.oy) * self.dx,
                          (kk - self.oz) * self.dx).astype(np.float64)
        return self.sources

    def add_point_charge(self, x: float, y: float, z: float, q: float) -> None:
        i, j, k = self.i_of(x), self.j_of(y), self.k_of(z)
        if 0 <= i < self.nx and 0 <= j < self.ny and 0 <= k < self.nz:
            self.sources[k, j, i] += q / (self.dx ** 3)

    def solve(self, max_iter: int = 3000, tol: float = 1e-9) -> Dict:
        c2 = (self.dx ** 2) / self.eps0
        phi = self.field
        res = float("inf")
        n = 0
        for n in range(1, int(max_iter) + 1):
            nxt = phi.copy()
            nxt[1:-1, 1:-1, 1:-1] = (
                phi[1:-1, 1:-1, :-2] + phi[1:-1, 1:-1, 2:]
                + phi[1:-1, :-2, 1:-1] + phi[1:-1, 2:, 1:-1]
                + phi[:-2, 1:-1, 1:-1] + phi[2:, 1:-1, 1:-1]
                + c2 * self.sources[1:-1, 1:-1, 1:-1]
            ) / 6.0
            self._apply_boundary(nxt)
            phi = nxt
            if n % 10 == 0 or n == int(max_iter):
                res = float(np.max(np.abs(
                    self._laplacian(phi)[1:-1, 1:-1, 1:-1]
                    + self.sources[1:-1, 1:-1, 1:-1] / self.eps0)))
                if res < tol:
                    break
        self.field = phi
        self.iters = n
        self.residual = res
        return {"iters": n, "residual": res}


class AdvectDiffuseWorld3D(Grid3D):
    """
    对流–扩散方程：∂φ/∂t + u·∇φ = α∇²φ
    对流项用【一阶迎风】（稳定但带数值扩散），扩散项用 FTCS。
    稳定条件两者分别检查：Σ|uᵢ|·dt/dx ≤ 1 且 α·dt/dx² ≤ 1/6，超任一个 fail-closed。

    这一类对降阶模型【天然不友好】：对流主导的问题 Kolmogorov n-width 衰减很慢，
    即"很少的模态抓不住一个平移/旋转的斑"。验真会如实报出它的有效秩远高于热传导。
    """

    def __init__(self, nx: int = 21, ny: int = 21, nz: int = 21, alpha: float = 0.0,
                 dt: float = 0.2, dx: float = 1.0, boundary: float = 0.0,
                 omega: float = 0.1):
        super().__init__(nx=nx, ny=ny, nz=nz, dx=dx, boundary=boundary)
        self.alpha, self.dt = float(alpha), float(dt)
        self.omega = float(omega)
        self.lam = self.alpha * self.dt / (self.dx ** 2)
        if self.lam > 1.0 / 6.0:
            raise ValueError(
                f"CFL 不稳定（扩散）：α·dt/dx² = {self.lam:.4f} > 1/6。"
            )
        kk, jj, ii = np.meshgrid(np.arange(self.nz), np.arange(self.ny),
                                 np.arange(self.nx), indexing="ij")
        xs = (ii - self.ox) * self.dx
        ys = (jj - self.oy) * self.dx
        self._U = (-self.omega * ys).astype(np.float64)
        self._V = (self.omega * xs).astype(np.float64)
        self._W = np.zeros_like(self._U)
        vsum = np.max(np.abs(self._U) + np.abs(self._V) + np.abs(self._W))
        self.flowCFL = float(vsum * self.dt / self.dx)
        if self.flowCFL > 1.0:
            raise ValueError(
                f"CFL 不稳定（对流）：Σ|uᵢ|·dt/dx = {self.flowCFL:.4f} > 1。"
                f"请调小 dt 或 omega。"
            )

    def velocity_at(self, x: float, y: float, z: float) -> Tuple[float, float, float]:
        """绕 Z 轴的刚体旋转 u = (−ωy, ωx, 0)（无散度，不会人为压缩/拉伸物质）。"""
        return (-self.omega * y, self.omega * x, 0.0)

    def step(self) -> np.ndarray:
        phi = self.field
        dx = self.dx
        dpx = np.where(self._U >= 0, phi - np.roll(phi, 1, axis=2), np.roll(phi, -1, axis=2) - phi) / dx
        dpy = np.where(self._V >= 0, phi - np.roll(phi, 1, axis=1), np.roll(phi, -1, axis=1) - phi) / dx
        dpz = np.where(self._W >= 0, phi - np.roll(phi, 1, axis=0), np.roll(phi, -1, axis=0) - phi) / dx
        adv = self._U * dpx + self._V * dpy + self._W * dpz
        nxt = phi + self.dt * (self.alpha * self._laplacian(phi) - adv + self.sources)
        self._apply_boundary(nxt)
        self.field = nxt
        self.time += self.dt
        return self.field

    def mass(self) -> float:
        return float(self.field.sum()) * (self.dx ** 3)

    def centroid(self) -> Dict[str, float]:
        kk, jj, ii = np.meshgrid(np.arange(self.nz), np.arange(self.ny),
                                 np.arange(self.nx), indexing="ij")
        m = float(self.field.sum())
        if abs(m) < 1e-300:
            return {"x": 0.0, "y": 0.0, "z": 0.0, "mass": 0.0}
        xs = (ii - self.ox) * self.dx
        ys = (jj - self.oy) * self.dx
        zs = (kk - self.oz) * self.dx
        return {"x": float((self.field * xs).sum() / m),
                "y": float((self.field * ys).sum() / m),
                "z": float((self.field * zs).sum() / m),
                "mass": m}


class RigidBody3D:
    """
    刚体动力学（牛顿–欧拉方程）：这不是场，是世界里的"物体"。
        平动：m·a = ΣF（含重力）        转动：I·ω̇ + ω×(I·ω) = τ
    姿态用四元数 q 积分（避免万向锁）。惯性张量简化为【对角】(Ix, Iy, Iz)。

    诚实边界：无碰撞检测、无约束求解、无摩擦。半隐式欧拉是一阶，能量有 O(dt) 漂移。
    可严格验证的量：动量（恒力下逐位守恒）、无力矩时的角动量、自由落体与解析解的偏差。
    """

    def __init__(self, mass: float = 1.0, Ix: float = 1.0, Iy: float = 1.0, Iz: float = 1.0,
                 pos=(0.0, 0.0, 0.0), vel=(0.0, 0.0, 0.0),
                 q=(0.0, 0.0, 0.0, 1.0), omega=(0.0, 0.0, 0.0),
                 gravity=(0.0, 0.0, 0.0)):
        self.mass = float(mass)
        self.Ix, self.Iy, self.Iz = float(Ix), float(Iy), float(Iz)
        self.pos = np.array(pos, dtype=np.float64)
        self.vel = np.array(vel, dtype=np.float64)
        self.q = np.array(q, dtype=np.float64)
        self.omega = np.array(omega, dtype=np.float64)
        self.gravity = np.array(gravity, dtype=np.float64)
        self._F = np.zeros(3)
        self._tau = np.zeros(3)
        self.time = 0.0

    def apply_force(self, F, r=None) -> None:
        F = np.asarray(F, dtype=np.float64)
        self._F += F
        if r is not None:
            self._tau += np.cross(np.asarray(r, dtype=np.float64), F)

    def apply_torque(self, t) -> None:
        self._tau += np.asarray(t, dtype=np.float64)

    @staticmethod
    def _qmul(a, b):
        return np.array([
            a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
            a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
            a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
            a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
        ])

    def _omega_dot(self, w, tau):
        Iw = np.array([self.Ix * w[0], self.Iy * w[1], self.Iz * w[2]])
        gyro = np.cross(w, Iw)
        I = np.array([self.Ix, self.Iy, self.Iz])
        return (np.asarray(tau, dtype=np.float64) - gyro) / I

    def step(self, dt: float):
        """速度 Verlet（平动，恒加速度下位置精确）+ RK2 中点（转动与姿态）。"""
        acc = self._F / self.mass + self.gravity
        self.pos = self.pos + self.vel * dt + 0.5 * acc * dt * dt
        self.vel = self.vel + acc * dt
        w0 = self.omega
        k1 = self._omega_dot(w0, self._tau)
        wm = w0 + 0.5 * dt * k1
        k2 = self._omega_dot(wm, self._tau)
        self.omega = w0 + dt * k2
        wq = np.array([wm[0], wm[1], wm[2], 0.0])
        self.q = self.q + self._qmul(wq, self.q) * dt
        self.q = self.q / (np.linalg.norm(self.q) or 1.0)
        self.time += float(dt)
        self._F = np.zeros(3)
        self._tau = np.zeros(3)
        return self

    def body_to_world(self, v) -> np.ndarray:
        x, y, z, w = self.q
        v = np.asarray(v, dtype=np.float64)
        t = np.array([2 * (y * v[2] - z * v[1]),
                      2 * (z * v[0] - x * v[2]),
                      2 * (x * v[1] - y * v[0])])
        return v + w * t + np.cross(np.array([x, y, z]), t)

    def momentum(self) -> np.ndarray:
        return self.mass * self.vel

    def angular_momentum(self) -> np.ndarray:
        return self.body_to_world(np.array([self.Ix * self.omega[0],
                                            self.Iy * self.omega[1],
                                            self.Iz * self.omega[2]]))

    def energy(self, ground_y: float = 0.0) -> float:
        v2 = float(self.vel @ self.vel)
        w = self.omega
        rot = self.Ix * w[0] ** 2 + self.Iy * w[1] ** 2 + self.Iz * w[2] ** 2
        return 0.5 * self.mass * v2 + 0.5 * rot + self.mass * 9.81 * (self.pos[1] - ground_y)


class RealWorld3D:
    """
    真实世界（原点=地球中心 · 中心引力 + 多体 + 数学规律）。

    物理层（现实规律，含运动）：
        - 以原点模拟为地球中心，默认从原点产生反平方中心引力 F = −G·M·m·r̂ / r²；
        - 可传 central_law=[c0,c1,c2,c3]（候选基 [1/r²,1/r,1,1/r³] 上的系数）替换默认律——
          用"机器人学出的经验律"跑世界（SINDy 从真实轨迹学回；见 verify_experience.py）；
        - 可选物体间互引力（N 体）；可选弹性碰撞（现实规律的相互作用）。
    数学层（数学规律，区别于物理力）：
        - MG 几何约束律：物体被约束在给定半径的球面上（纯数学结构，非力，每步投影）；
        - MI 不变量律：能量(时间平移对称)、角动量(SO(3)旋转对称)、动量(平移对称)
          由连续对称推出，显式测量其漂移作为"数学规律在生效"的证据；
        - 反平方专属数学律（Bertrand）：离心率矢量 e_vec 守恒 ⇒ 所有束缚轨道是闭合椭圆。

    积分器：速度 Verlet（辛，长期能量漂移远低于显式欧拉）。
    诚实边界：无广义相对论修正、无潮汐、碰撞为简化弹性、球约束后"速度切向化"是
    数学约束非物理力。
    """

    def __init__(self, G: float = 1.0, M: float = 1000.0, r_min: float = 0.5,
                 mutual: bool = False, collide: bool = False, constraint=None,
                 central_law=None):
        self.G = float(G)
        self.M = float(M)
        self.r_min = float(r_min)
        self.mutual = bool(mutual)
        self.collide = bool(collide)
        self.constraint = constraint  # None | {"type":"sphere","R":float}
        self.central_law = (None if central_law is None
                            else np.array(central_law, dtype=np.float64))
        self.bodies: List[Dict] = []
        self.time = 0.0

    def add_body(self, pos, vel, mass, radius: float = 0.2) -> "RealWorld3D":
        self.bodies.append({
            "pos": np.array(pos, dtype=np.float64),
            "vel": np.array(vel, dtype=np.float64),
            "mass": float(mass),
            "radius": float(radius),
        })
        return self

    def _accel(self):
        bs = self.bodies
        n = len(bs)
        GM = self.G * self.M
        law = self.central_law
        A = [np.zeros(3) for _ in range(n)]
        for i in range(n):
            r = bs[i]["pos"]
            rr = float(np.linalg.norm(r))
            if rr < self.r_min:
                raise RuntimeError(
                    f"中心引力奇点：物体#{i} 距原点 {rr:.2e} < r_min={self.r_min}（fail-closed）")
            if law is not None:
                irr = 1.0 / rr
                a_mag = law[0] * irr * irr + law[1] * irr + law[2] + law[3] * irr * irr * irr
            else:
                a_mag = -GM / (rr * rr)          # 默认硬写：−GM/r²
            A[i] = (a_mag / rr) * r              # accel = a_mag·r̂ = (a_mag/rr)·r
            if self.mutual:
                for j in range(n):
                    if j == i:
                        continue
                    d = r - bs[j]["pos"]
                    dd = float(np.linalg.norm(d))
                    if dd < 1e-9:
                        continue
                    g = -self.G * bs[j]["mass"] / (dd ** 3)
                    A[i] = A[i] + g * d
        return A

    def step(self, dt: float):
        bs = self.bodies
        n = len(bs)
        A0 = self._accel()
        for i in range(n):
            bs[i]["pos"] = bs[i]["pos"] + bs[i]["vel"] * dt + 0.5 * A0[i] * dt * dt
        A1 = self._accel()
        for i in range(n):
            bs[i]["vel"] = bs[i]["vel"] + 0.5 * (A0[i] + A1[i]) * dt
        if self.collide:
            self._collide()
        if self.constraint is not None:
            self._apply_constraint()
        self.time += float(dt)
        return self

    def _collide(self):
        bs = self.bodies
        for i in range(len(bs)):
            for j in range(i + 1, len(bs)):
                a, b = bs[i], bs[j]
                d = a["pos"] - b["pos"]
                dist = float(np.linalg.norm(d))
                rs = a["radius"] + b["radius"]
                if dist < rs and dist > 1e-9:
                    nrm = d / dist
                    rel = float((a["vel"] - b["vel"]) @ nrm)
                    if rel < 0:
                        ma, mb = a["mass"], b["mass"]
                        imp = 2 * rel / (ma + mb)
                        a["vel"] = a["vel"] - imp * mb * nrm
                        b["vel"] = b["vel"] + imp * ma * nrm

    def _apply_constraint(self):
        if self.constraint is not None and self.constraint.get("type") == "sphere":
            R = float(self.constraint["R"])
            for b in self.bodies:
                rr = float(np.linalg.norm(b["pos"])) or 1e-12
                b["pos"] = b["pos"] * (R / rr)
                rhat = b["pos"] / R
                vr = float(b["vel"] @ rhat)
                b["vel"] = b["vel"] - vr * rhat  # 切向化：数学约束非力

    def energy(self) -> float:
        E = 0.0
        GM = self.G * self.M
        bs = self.bodies
        law = self.central_law
        for i in range(len(bs)):
            b = bs[i]
            v2 = float(b["vel"] @ b["vel"])
            r = float(np.linalg.norm(b["pos"]))
            if law is not None:
                V = law[0] / r + law[1] * np.log(r) - law[2] * r + law[3] / (2 * r * r)
            else:
                V = -GM / r
            E += 0.5 * b["mass"] * v2 + b["mass"] * V
            if self.mutual:
                for j in range(i):
                    d = float(np.linalg.norm(b["pos"] - bs[j]["pos"]))
                    E += -self.G * b["mass"] * bs[j]["mass"] / d
        return E

    def angular_momentum(self) -> np.ndarray:
        L = np.zeros(3)
        for b in self.bodies:
            L += b["mass"] * np.cross(b["pos"], b["vel"])
        return L

    def momentum(self) -> np.ndarray:
        P = np.zeros(3)
        for b in self.bodies:
            P += b["mass"] * b["vel"]
        return P

    def com(self) -> np.ndarray:
        c = np.zeros(3)
        m = 0.0
        for b in self.bodies:
            c += b["mass"] * b["pos"]
            m += b["mass"]
        return c / m

    def ecc_vector(self, i: int) -> np.ndarray:
        """离心率矢量（反平方中心力的数学不变量）：e_vec = ((v²−μ/r)·r − (r·v)·v)/μ"""
        b = self.bodies[i]
        GM = self.G * self.M
        r = b["pos"]
        v = b["vel"]
        rr = float(np.linalg.norm(r))
        v2 = float(v @ v)
        rv = float(r @ v)
        c = v2 - GM / rr
        return (c * r - rv * v) / GM


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

        # ★ 数值秩护栏（两道），与 JS 轨同款。
        # 谱会衰减到浮点噪声层，那里的"模态"不是物理方向而是数值垃圾：
        # 彼此不正交（JS 侧实测 Gram 非对角元达 0.876；Python/LAPACK 侧 4.5e-5），
        # 加进基里不会降误差，只会污染。
        # 第一道 · λ 噪声地板：λ_m ≤ λ_max·1e-12 不取。
        # 第二道 · 修正 Gram-Schmidt 重正交：保证 ΦᵀΦ = I（正交投影的前提），
        #          正交后残余过小者（与已有模态线性相关）丢弃。
        rr = min(int(r), T - 1)
        lam_max = float(max(vals[0], 0.0)) if vals.size else 0.0
        noise_floor = lam_max * 1e-12
        modes, lam = [], []
        for m in range(rr):
            lv = float(max(vals[m], 0.0))
            if lv <= noise_floor:                    # 第一道
                break
            mode = Xc @ vecs[:, m]
            nrm = float(np.linalg.norm(mode))
            if nrm < 1e-14:
                continue
            mode = mode / nrm
            if modes:                                # 第二道：两轮 MGS
                Q = np.stack(modes, axis=1)          # (N, k)
                for _ in range(2):
                    mode = mode - Q @ (Q.T @ mode)
            n2 = float(np.linalg.norm(mode))
            if n2 < 1e-3:                            # 与已有模态近乎线性相关 → 丢弃
                continue
            modes.append(mode / n2)
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


def fit_affine(psi_seq: Sequence[Sequence[float]]) -> Optional[Dict]:
    """
    仿射拟合：ψ_{t+1} = A ψ_t + b

    为什么必须有这一版：ψ = Φᵀ(φ − φ̄) 含【减均值】，故即使物理演化 φ_{t+1}=Mφ_t
    是严格线性的，投影后的低维动力学也是仿射的：
        ψ_{t+1} = ΦᵀMΦ·ψ_t + Φᵀ(Mφ̄ − φ̄)      ← 第二项（均值漂移）一般非零
    只拟合 A（fit_linear）会系统性欠拟合。实测本场景：线性残差 1.5e-1、
    6 步预测误差 79%；改仿射后残差降到机器精度级，多步预测随之可用。

    返回 {A (r×(r+1)，最后一列即 b), r, rms, rel_err}
    """
    S = np.asarray(psi_seq, dtype=np.float64)
    if S.ndim != 2 or S.shape[0] < 3:
        return None
    T, r = S.shape
    P = np.hstack([S[:-1], np.ones((T - 1, 1))])      # (T-1, r+1)
    Q = S[1:]                                          # (T-1, r)
    sol, *_ = np.linalg.lstsq(P, Q, rcond=None)        # (r+1, r)
    A = sol.T                                          # (r, r+1)
    resid = float(((P @ A.T - Q) ** 2).sum())
    scale = float((S[1:] ** 2).sum())
    return {
        "A": A,
        "r": int(r),
        "affine": True,
        "rms": float(np.sqrt(resid / max(T - 1, 1))),
        "rel_err": float(np.sqrt(resid / scale)) if scale > 0 else 0.0,
    }


def predict_affine(A: np.ndarray, psi0: Sequence[float], steps: int) -> List[np.ndarray]:
    """用仿射模型做多步预测：返回 [ψ_t, ψ_{t+1}, ..., ψ_{t+steps}]。"""
    A = np.asarray(A, dtype=np.float64)
    cur = np.asarray(psi0, dtype=np.float64).reshape(-1)
    r = cur.size
    seq = [cur.copy()]
    for _ in range(int(steps)):
        cur = A[:, :r] @ cur + A[:, r]
        seq.append(cur.copy())
    return seq


def fit_affine2(psi_seq: Sequence[Sequence[float]]) -> Optional[Dict]:
    """
    二阶（AR(2)）边界动力学：ψ_{t+1} = A·ψ_t + B·ψ_{t−1} + c

    ⚠️ 为什么必须有：**波动方程是二阶系统**。用一阶仿射 ψ_{t+1}=Aψ_t+b 去拟合它，
    是把二阶动力学塞进一阶模型——实测声波场景 6 步样本外预测误差 **7.5e+1（7532%）**，
    不是精度不够，是模型类用错。热传导/对流是一阶系统，用 fit_affine 即可。

    返回 {"A": M (r, 2r+1)，列序 [ψ_t (r列) | ψ_{t−1} (r列) | 常数 (1列)], r, order, rms, rel_err}
    """
    S = np.asarray(psi_seq, dtype=np.float64)
    if S.ndim != 2 or S.shape[0] < 5:
        return None
    T, r = S.shape
    # 设计矩阵 P_t = [ψ_t | ψ_{t−1} | 1]，t = 1 .. T-2，目标 ψ_{t+1}
    P = np.hstack([S[1:-1], S[:-2], np.ones((T - 2, 1))])
    Q = S[2:]
    sol, *_ = np.linalg.lstsq(P, Q, rcond=None)         # (2r+1, r)
    A = sol.T                                            # (r, 2r+1)
    resid = float(((P @ A.T - Q) ** 2).sum())
    scale = float((S[1:] ** 2).sum())
    return {
        "A": A,
        "r": int(r),
        "order": 2,
        "rms": float(np.sqrt(resid / max(T - 2, 1))),
        "rel_err": float(np.sqrt(resid / scale)) if scale > 0 else 0.0,
    }


def predict_affine2(M: np.ndarray, psi0: Sequence[float],
                    psi_prev: Sequence[float], steps: int) -> List[np.ndarray]:
    """用二阶模型做多步预测：从 (psi_prev, psi0) 递推 steps 次。"""
    M = np.asarray(M, dtype=np.float64)
    cur = np.asarray(psi0, dtype=np.float64).reshape(-1)
    prev = np.asarray(psi_prev, dtype=np.float64).reshape(-1)
    r = cur.size
    seq = [cur.copy()]
    for _ in range(int(steps)):
        nxt = M[:, :r] @ cur + M[:, r:2 * r] @ prev + M[:, 2 * r]
        seq.append(nxt.copy())
        prev, cur = cur, nxt
    return seq


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
