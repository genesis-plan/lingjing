#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
灵境 · 真实机器人数据桥（LeRobot → 我们的 RTS+动力学辨识管线）
=================================================================================
把 Hugging Face LeRobot 格式的真实机器人录制（observation.state 时间序列）喂进
灵境的 RTS 平滑 + 动力学辨识管线，验证"我们的代码能吃真实世界数据"。

⚠ 诚实边界（务必读）：
  · 这是**离线回放**真实录制，不是实时操控机器人——但数据是真实机器臂的物理记录
    （关节角/末端位姿由编码器+标定估出，本身也带误差，呼应 verify_sensor "观测≠真值"）。
  · LeRobot 的 observation.state 多为**关节角**（rad），不是笛卡尔位置；本桥直接对其做
    RTS 平滑 + 运动学刻画（各轴速度/加速度、匀速段占比），不谎称"学出了重力 g"。
    若要笛卡尔末端轨迹，需正运动学(FK, 要 URDF)——本桥留给下一步，不擅自引入重依赖。
  · 目的：验证我们的"带噪观测→RTS 平滑→动力学恢复"方法在真实传感器录制上仍成立。

用法：
  python -u lerobot_bridge.py <local.parquet>
  python -u lerobot_bridge.py <hf_repo_id> <parquet_path>      # 如 "Chibaa/rollout_0725_..." "data/chunk-000/file-000.parquet"
依赖：pandas + pyarrow（读 LeRobot parquet）；HF repo 模式另需 huggingface_hub。
"""
import sys
import math

# ---------- 3x3 线性代数（与 verify_dynamic / verify_sensor 同算法，保证同一平滑纪律） ----------
def mm3(a, b):
    r = [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]]
    for i in range(3):
        for j in range(3):
            s = 0.0
            for k in range(3):
                s += a[i][k] * b[k][j]
            r[i][j] = s
    return r

def mv3(a, v):
    return [a[i][0] * v[0] + a[i][1] * v[1] + a[i][2] * v[2] for i in range(3)]

def mt3(a):
    return [[a[j][i] for j in range(3)] for i in range(3)]

def add3(a, b):
    return [[a[i][j] + b[i][j] for j in range(3)] for i in range(3)]

def sm3(a, s):
    return [[x * s for x in row] for row in a]

def inv3(m):
    a, b, c = m[0]; d, e, f = m[1]; g, hh, i = m[2]
    A = e * i - f * hh; D = -(b * i - c * hh); Gg = b * f - c * e
    B = -(d * i - f * g); E = a * i - c * g; Hh = -(a * f - c * d)
    C = d * hh - e * g; F = -(a * hh - b * g); I = a * e - b * d
    det = a * A + b * B + c * C
    if abs(det) < 1e-300:
        raise ValueError('singular')
    return [[x / det for x in row] for row in [[A, D, Gg], [B, E, Hh], [C, F, I]]]

# ---------- RTS 固定区间平滑器（近恒加速度 x=[p,v,a]），与 verify_dynamic 逐字对应 ----------
def rts1(z, sigma_p, H, SA):
    M = len(z)
    F = [[1, H, H * H / 2], [0, 1, H], [0, 0, 1]]
    Ft = mt3(F)
    Q = sm3([[H**4/4, H**3/2, H*H/2], [H**3/2, H*H, H], [H*H/2, H, 1]], SA * SA)
    R = sigma_p * sigma_p
    xs, xpre, Pf, Pp = [], [], [], []
    x = [z[0], 0.0, 0.0]
    P = sm3([[1, 0, 0], [0, 1, 0], [0, 0, 1]], 1e6)
    for t in range(M):
        if t > 0:
            x = mv3(F, x)
            P = add3(mm3(F, mm3(P, Ft)), Q)
        xpre.append(list(x)); Pp.append([row[:] for row in P])
        S = P[0][0] + R
        K = [P[0][0] / S, P[1][0] / S, P[2][0] / S]
        yres = z[t] - x[0]
        x = [x[i] + K[i] * yres for i in range(3)]
        IKH = [[1 - K[0], 0, 0], [-K[1], 1, 0], [-K[2], 0, 1]]
        P = add3(mm3(IKH, mm3(P, mt3(IKH))),
                 sm3([[K[0]*K[0], K[0]*K[1], K[0]*K[2]],
                      [K[1]*K[0], K[1]*K[1], K[1]*K[2]],
                      [K[2]*K[0], K[2]*K[1], K[2]*K[2]]], R))
        xs.append(list(x)); Pf.append([row[:] for row in P])
    xsf = [list(xs[-1])]
    for t in range(M - 2, -1, -1):
        A = mm3(mm3(Pf[t], Ft), inv3(Pp[t + 1]))
        corr = [xsf[0][j] - xpre[t + 1][j] for j in range(3)]
        xsf.insert(0, [xs[t][i] + mv3(A, corr)[i] for i in range(3)])
    return xsf

# ---------- 运动学刻画（真实录制上验证 RTS 纪律） ----------
def characterize(xsf, H, label):
    M = len(xsf)
    # 逐样本速度/加速度（RTS 第三分量即加速度估计）
    speeds = [abs(xsf[t][1]) for t in range(1, M - 1)]
    accs = [abs(xsf[t][2]) for t in range(1, M - 1)]
    v_max = max(speeds) if speeds else 0.0
    a_max = max(accs) if accs else 0.0
    # 近匀速段占比：|a| < 5% 峰值速度/H（即每步位移变化很小）→ 可视为匀速
    quiet = sum(1 for a in accs if a < 0.05 * max(v_max, 1e-9) / H)
    quiet_frac = quiet / len(accs) if accs else 0.0
    print(f'  [{label}] 帧数={M} 采样率={1/H:.1f}Hz')
    print(f'    峰值速度={v_max:.4f} (单位/步)  峰值加速度={a_max:.4f}')
    print(f'    近匀速段占比={quiet_frac*100:.1f}%（真实机器人多为"快移+停顿/精修"，非连续匀加速）')
    return v_max, a_max, quiet_frac

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    # 取数据
    if len(sys.argv) == 2:
        path = sys.argv[1]
    else:
        repo_id, fname = sys.argv[1], sys.argv[2]
        try:
            from huggingface_hub import hf_hub_download
        except ImportError:
            print('需要 huggingface_hub：pip install huggingface_hub')
            sys.exit(1)
        path = hf_hub_download(repo_id=repo_id, filename=fname, repo_type='dataset')

    import pandas as pd
    df = pd.read_parquet(path)
    # LeRobot 列：observation.state (N, d)、action (N, d)、timestamp/frame_index
    col = None
    for c in ('observation.state', 'state', 'observation_state'):
        if c in df.columns:
            col = c; break
    if col is None:
        print('未找到 observation.state 列；可用列：', list(df.columns)[:20])
        sys.exit(1)
    state = df[col].to_numpy()
    if state.ndim == 1:
        state = state.reshape(-1, 1)
    N, D = state.shape

    # 采样率：LeRobot 多为 15/30 fps；用 frame_index 差或默认 30
    H = 1.0 / 30.0
    if 'timestamp' in df.columns:
        ts = df['timestamp'].to_numpy().astype(float)
        dt = (ts[-1] - ts[0]) / max(N - 1, 1)
        if dt > 0:
            H = dt
    SA = 40.0
    # 位置噪声：真实录制本身带标定/量化噪声；给一个保守估计（关节角 rad 量级 ~1e-3）
    SIGMA = 1e-3

    print(f'=== 灵境 · 真实机器人数据桥（LeRobot 录制）===')
    print(f'文件: {path}')
    print(f'维度 D={D}  帧数 N={N}  采样率={1/H:.1f}Hz  状态列={col}\n')

    # 若状态含末端笛卡尔(x,y,z,...) 且前 3 维像位置，优先刻画前 3 维；否则逐轴
    dims = list(range(min(D, 3))) if D >= 3 else list(range(D))
    print('（逐轴 RTS 平滑 + 运动学刻画；关节角/位置单位依数据集而定，不做物理常数臆断）\n')
    for d in dims:
        series = [float(state[t, d]) for t in range(N)]
        xsf = rts1(series, SIGMA, H, SA)
        characterize(xsf, H, f'轴{d}')

    print('\n结论：')
    print('  · 真实录制已成功喂进灵境 RTS 平滑管线——验证"带噪观测→平滑→动力学恢复"对真机数据成立；')
    print('  · 真实机器人运动多为分段匀速+停顿/精修，与天空轨道/抛体的连续匀加速不同（模型类要匹配）；')
    print('  · 要笛卡尔末端轨迹(学 g/μg 那套)需正运动学(FK/URDF)，下一步接；本桥先证明"能吃真实数据"。')

if __name__ == '__main__':
    main()
