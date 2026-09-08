#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
灵境 · LeRobot 桥自测数据生成器
=================================================================
本沙箱无法访问 Hugging Face（出网被代理拦：502 / 直连超时），故无法在此拉真实录制。
此脚本生成一份**形状与 LeRobot 一致**的合成 parquet（observation.state 时间序列 +
timestamp），用于验证 lerobot_bridge.py 的 *真实读取路径*（pandas.read_parquet →
rts1 → characterize）能正确消费该格式。

合成轨迹故意写成真实机器臂的典型形态：快移段 + 停顿/精修段（印证 characterize 里
"近匀速段占比"的判读），并叠加轻量观测噪声。各轴运动学已知，便于核对输出量级合理。

仅作自测/演示，不构成真实机器人数据，不进入任何合规数据集。

用法：python make_synthetic_lerobot.py <out.parquet>
"""
import sys, math
try:
    import pandas as pd
    import numpy as np
    import pyarrow as pa
    import pyarrow.parquet as pq
except ImportError:
    print('需要 pandas + pyarrow + numpy：pip install pandas pyarrow numpy')
    sys.exit(1)

def main():
    out = sys.argv[1] if len(sys.argv) > 1 else 'synthetic_lerobot.parquet'
    rng = np.random.default_rng(20260908)
    fps = 30.0
    N = 300                       # 10 秒 @30Hz
    ts = np.arange(N) / fps
    D = 6                         # SO-100 型 6 关节
    state = np.zeros((N, D))
    for d in range(D):
        # 各轴：快移（正弦扫）+ 停顿精修（小幅抖动），模拟真实抓取动作
        amp = 0.8 + 0.15 * d
        freq = 0.25 + 0.05 * d
        sweep = amp * np.sin(2 * math.pi * freq * ts)
        # 前 60% 为"快移"，后 40% 为"停顿精修"（幅度小、近匀速）
        fine = np.where(np.arange(N) < 0.6 * N,
                        0.0,
                        0.03 * np.sin(2 * math.pi * 3.0 * ts))
        noise = rng.normal(0, 1e-3, N)   # 标定/量化噪声量级
        state[:, d] = sweep + fine + noise
    df = pd.DataFrame({'observation.state': list(state), 'timestamp': ts})
    # 存成与 LeRobot 一致的 arrow 表（observation.state 为 list-of-vector 列）
    arr = pa.array([list(row) for row in state], type=pa.list_(pa.float64()))
    table = pa.table({'observation.state': arr, 'timestamp': pa.array(ts, type=pa.float64())})
    pq.write_table(table, out)
    print(f'已生成合成 LeRobot 形 parquet：{out}')
    print(f'  帧数 N={N}  关节维度 D={D}  采样率={fps:.0f}Hz')
    print(f'  说明：这是合成自测数据（沙箱无法访问 HF 真实录制），仅验证读取路径。')

if __name__ == '__main__':
    main()
