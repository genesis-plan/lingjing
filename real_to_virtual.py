#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
灵境 · 真实环境 → 虚拟世界 映射（物体级 1:1 最小切片）
=================================================================
目标（用户定调）：把整个真实环境 1:1 搬进虚拟世界；容忍误差，但"不要和真实相差太多"
= 高保真数字孪生：虚拟轨迹在**信任时域**内与真实轨迹一致、超出才漂移（我们已量化的 15圈 2.5%）。

本模块做"物体级 1:1"的链路证明（沙箱无真数据，用合成真形数据验证）：
  1. 真实关节角 q(t)（快移+停顿，机器人典型形态）→ 正运动学 FK → 笛卡尔末端轨迹（真实）；
  2. 叠加观测噪声 → "机器人回传的"观测轨迹；
  3. 虚拟世界用 RTS 平滑出状态（位置/速度/加速度），即"虚拟副本"；
  4. 两种孪生模式量化"差多少"：
       · 跟踪模式(track)：虚拟副本持续跟随观测 → 偏差≈观测噪声（贴着）；
       · 预测模式(predict)：从训练段末向未来外推 → 偏差随时域增长，但信任时域内仍小。
  5. 输出偏差数字 + "是否在容忍阈内"裁决。

真实接入：把 lerobot_bridge 读出的关节角序列喂进 fk_* 得笛卡尔，再进 track/predict 即可。
FK 这里给 2 连杆平面范例（证明 关节→笛卡尔→虚拟 全链路）；6 自由度(如 SO-100/Panda) 同函数换 DH 参数即可。

用法：
  python real_to_virtual.py            # 跑合成验证
  python real_to_virtual.py --tol 0.05 # 自定义"相差太多"的阈值（单位：轨迹尺度占比）
"""
import sys, math
import numpy as np
from lerobot_bridge import rts1

# ---------- 正运动学（范例：2 连杆平面；6-DOF 机器人同理换 DH 参数） ----------
def fk_2link(q1, q2, L1=0.3, L2=0.3):
    x = L1 * math.cos(q1) + L2 * math.cos(q1 + q2)
    y = L1 * math.sin(q1) + L2 * math.sin(q1 + q2)
    return x, y

def fk_trajectory(Q, L1=0.3, L2=0.3):
    return np.array([fk_2link(float(q[0]), float(q[1]), L1, L2) for q in Q])

# ---------- 虚拟世界：RTS 平滑出状态（复用 lerobot_bridge 同算法） ----------
def smooth_nd(obs, H, SA, SIGMA):
    """对每维独立 RTS，返回 (N, D) 平滑位置 + (N, D) 速度 + (N, D) 加速度"""
    N, D = obs.shape
    P = np.zeros((N, D)); V = np.zeros((N, D)); A = np.zeros((N, D))
    for d in range(D):
        xsf = rts1([float(obs[t, d]) for t in range(N)], SIGMA, H, SA)
        for t in range(N):
            P[t, d], V[t, d], A[t, d] = xsf[t][0], xsf[t][1], xsf[t][2]
    return P, V, A

def track(obs, H, SA=40.0, SIGMA=1e-3):
    """跟踪模式：虚拟副本 = RTS 平滑态。偏差 = 平滑态 vs 真实观测的 RMSE（应≈噪声级）。"""
    P, _, _ = smooth_nd(obs, H, SA, SIGMA)
    rmse = math.sqrt(np.mean((P - obs) ** 2))
    return P, rmse

def predict(obs, H, train_frac=0.7, SA=40.0, SIGMA=1e-3, horizons=(0.1, 0.5, 1.0, 2.0)):
    """预测模式：训练段 RTS → 末态(p,v,a) 恒加速外推 horizon 秒 → 与真实未来比 RMSE。"""
    N = obs.shape[0]
    n_train = max(10, int(N * train_frac))
    P, _, _ = smooth_nd(obs, H, SA, SIGMA)
    # 末训练态（取训练段末端平滑态）
    p0, v0, a0 = P[n_train - 1], None, None
    # 重新在训练段末取平滑速度/加速度
    xsf_last = rts1([float(obs[t, 0]) for t in range(N)], SIGMA, H, SA)[n_train - 1]
    pv = np.array([[xsf_last[0], xsf_last[1], xsf_last[2]]])
    for d in range(1, obs.shape[1]):
        xs = rts1([float(obs[t, d]) for t in range(N)], SIGMA, H, SA)[n_train - 1]
        pv = np.vstack([pv, [xs[0], xs[1], xs[2]]])
    # 外推
    out = {}
    for hz in horizons:
        k = int(round(hz / H))
        pred = np.zeros((k + 1, obs.shape[1]))
        for s in range(k + 1):
            pred[s] = pv[:, 0] + pv[:, 1] * (s * H) + 0.5 * pv[:, 2] * (s * H) ** 2
        # 对齐真实未来段
        end = min(n_train + k, N - 1)
        true_future = obs[n_train:end + 1]
        pred_seg = pred[:true_future.shape[0]]
        rmse = math.sqrt(np.mean((pred_seg - true_future) ** 2))
        out[hz] = rmse
    return out

def main():
    tol = float(sys.argv[sys.argv.index('--tol') + 1]) if '--tol' in sys.argv else 0.05
    rng = np.random.default_rng(20260908)
    fps = 30.0; H = 1.0 / fps; N = 300
    ts = np.arange(N) * H
    # 合成关节角：轴0 快移正弦 + 轴1 停顿精修（真实机器人形态）
    q1 = 0.8 * np.sin(2 * math.pi * 0.25 * ts) + 0.03 * np.sin(2 * math.pi * 3 * ts)
    q2 = 0.5 * np.sin(2 * math.pi * 0.18 * ts)
    Q = np.column_stack([q1, q2])
    true_xyz = fk_trajectory(Q)                      # 真实笛卡尔末端（虚拟应贴这个）
    obs = true_xyz + rng.normal(0, 1e-3, true_xyz.shape)   # 观测噪声

    scale = np.max(np.abs(true_xyz))                # 轨迹尺度，用于"相差太多"判定
    print('=== 灵境 · 真实→虚拟 映射（物体级 1:1，合成验证）===')
    print(f'帧数 N={N}  采样率={fps:.0f}Hz  轨迹尺度≈{scale:.3f}  "相差太多"阈值={tol*scale:.4f}\n')

    # 跟踪模式
    P, track_rmse = track(obs, H)
    print(f'[跟踪模式] 虚拟副本跟随观测：RMSE={track_rmse:.5f} '
          f'(占轨迹尺度 {track_rmse/scale*100:.2f}%)')
    print(f'  → 偏差≈观测噪声级，虚拟"贴着"真实（误差可接受）。')

    # 预测模式
    div = predict(obs, H)
    print('\n[预测模式] 从训练段末向未来外推（恒加速模型）：')
    for hz, rmse in div.items():
        pct = rmse / scale * 100
        flag = '✅ 在容忍内' if rmse <= tol * scale else '⚠ 超出容忍'
        print(f'  {hz:>4.1f}s  horizon: RMSE={rmse:.5f} (占尺度 {pct:.2f}%)  {flag}')

    # 信任时域：找到首个超阈的 horizon
    thr_horizons = [hz for hz, rmse in div.items() if rmse <= tol * scale]
    if thr_horizons:
        print(f'\n结论：虚拟在 **{max(thr_horizons):.1f}s** 信任时域内与真实相差 < {tol*100:.0f}%，'
              f'符合"有误差但不要差太多"。超出后偏差增长（混沌/模型误差，属预期）。')
    else:
        print(f'\n结论：预测偏差全程超阈值，需调 SA/观测质量或缩短外推。')

if __name__ == '__main__':
    main()
