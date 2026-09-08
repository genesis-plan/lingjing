#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
效果验证：用已知运动学真值，量 RTS 速度/加速度估计准不准。
合成一条干净正弦位置 p(t)=A*sin(2*pi*f*t)，其真值 v=A*2*pi*f*cos、a=-A*(2*pi*f)^2*sin。
加 σ=1e-3 噪声（与 lerobot_bridge 默认 SIGMA 一致），跑同款 rts1，逐样本比 RTS 估计与真值。
同时复现"每步"与"每秒"两种单位，判断 characterize 报的单位对不对。
"""
import math
import numpy as np
from lerobot_bridge import rts1

def run(A, f_hz, H, SA, SIGMA, seed=1):
    N = 300
    ts = np.arange(N) * H
    p_true = A * np.sin(2 * math.pi * f_hz * ts)
    v_true_persec = A * 2 * math.pi * f_hz * np.cos(2 * math.pi * f_hz * ts)   # 单位/秒
    v_true_perstep = v_true_persec * H                                        # 单位/步
    rng = np.random.default_rng(seed)
    z = p_true + rng.normal(0, SIGMA, N)
    xsf = rts1(list(z), SIGMA, H, SA)
    v_est = np.array([x[1] for x in xsf])          # rts1 返回的单位/步
    a_est = np.array([x[2] for x in xsf])
    # 跳过前 5 帧暂态
    v_err = np.max(np.abs(v_est[5:] - v_true_perstep[5:]))
    v_ratio = np.max(np.abs(v_est[5:])) / max(np.max(np.abs(v_true_perstep[5:])), 1e-12)
    print(f'  A={A} f={f_hz}Hz H={H}: 真值峰值速度(步)={np.max(np.abs(v_true_perstep)):.4f} '
          f'(秒)={np.max(np.abs(v_true_persec)):.4f}')
    print(f'    RTS 峰值速度(步)={np.max(np.abs(v_est)):.4f}  最大绝对误差(步)={v_err:.4f}  '
          f'峰值比 RTS/真值={v_ratio:.2f}x')
    return v_ratio

if __name__ == '__main__':
    print('=== 效果验证：RTS 速度估计 vs 已知真值（lerobot_bridge 默认 SIGMA=1e-3, SA=40）===')
    H = 1.0 / 30.0
    print('\n[场景1] 与合成 parquet 同量级（A=0.8, f=0.25Hz）：')
    run(0.8, 0.25, H, 40.0, 1e-3)
    print('\n[场景2] 更大运动（A=1.1, f=0.35Hz）：')
    run(1.1, 0.35, H, 40.0, 1e-3)
    print('\n[场景3] 对照：verify_dynamic 量级（位置米、v0~5m/s、H=0.02）：')
    run(5.0, 0.5, 0.02, 40.0, 1e-3)
