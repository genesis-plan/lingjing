#!/usr/bin/env node
/**
 * 灵境 · RealWorld3D MCP 服务端（lingjing-mcp）
 * ============================================================================
 * 灵境是给机器（AI Agent）用的，不是给人看的。本文件把 rom.js 里已验证的真实
 * 世界物理引擎（RealWorld3D，速度 Verlet）包成 **MCP stdio 服务**：AI Agent 通过
 * 五个确定性工具直接"使用"虚拟世界——
 *
 *   world_sim          观察/驱动：建世界（可指定中心律：硬写 GM 或学出的经验律
 *                      [c0..c3] = [1/r²,1/r,1,1/r³] 系数）、加物体、步进、返回
 *                      轨迹与守恒漂移读数；
 *   law_learn          学律：从轨迹反推中心力律（SINDy/STLSQ + split-half 统计
 *                      区间 μ±δ），返回 nObs（轨迹点数，作证据权重）；
 *   law_eval           验律：虚拟律 vs 真实律 = 力场径向残差 + 同初值多圈轨道
 *                      分离，自动判"经验律贴合 / 硬写设计律偏离"；
 *   experience_get     读经验：跨会话持久 —— 上次会话 absorb 的还在不在；
 *   experience_absorb  吸收经验：把 law_learn 的 (μ,δ) 以 nObs 加权融合进持久
 *                      经验并落盘；与新经验冲突 → δ 放大（承认"我可能错了"）。
 *
 * 经验持久化：启动加 `--experience <path.json>`。不带 = 无持久（experience_*
 * 工具 fail-closed 拒绝，不静默丢弃）。机器人每次会话被拉起、退出即失忆 ——
 * 经验文件就是它跨交互的记忆（adapt_loop v2 的机器化）。
 *
 * 传输：JSON-RPC 2.0 + Content-Length 分帧（stdio）。零外部依赖，无需 npm install。
 * 诚实边界：全部确定性数值；singularity fail-closed；能学≠真理（受候选基限制）；
 * 学出的律只在本训练区段可信、长程相位累积漂移 → 经验需持续被真实数据校正；
 * 经验 μ±δ 的 δ 只含统计性不确定，不含基可辨识性的系统偏差。
 *
 * 运行/自检：  node lingjing-mcp.js --selftest
 * Agent 接入（MCP 配置）：
 *   { "mcpServers": { "lingjing": { "command": "node",
 *       "args": ["/绝对路径/lingjing-mcp.js", "--experience", "/绝对路径/experience.json"] } } }
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ROM = require('./rom.js');
const RW = ROM.RealWorld3D;
const lstsq = ROM.lstsq;
const ExperienceStore = require('./experience.js');

/* ------------------------------------------------ 经验存储（--experience） */
const _expArg = process.argv.indexOf('--experience');
const expPath = _expArg !== -1 ? process.argv[_expArg + 1] : null;
let store = null;
if (expPath) {
  try { store = new ExperienceStore(expPath); }
  catch (e) {
    console.error('[lingjing-mcp] 经验文件加载失败（fail-closed 拒启）: ' + e.message);
    process.exit(1);
  }
}

/* ---------------------------------------------------------------- 核心工具 */
const B_LABELS = ['1/r²', '1/r', '1', '1/r³'];

function basisLaw(r) { return [1 / (r * r), 1 / r, 1, 1 / (r * r * r)]; }

function norm3(v) { return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); }

/** SINDy/STLSQ：从轨迹 (N×dim) 反推中心力律系数（与 verify_experience.js 同构）。 */
function learnLaw(pos, vel, dt) {
  const N = pos.length, dim = vel[0].length;
  const aEst = new Array(N);
  for (let t = 0; t < N; t++) {
    aEst[t] = (t === 0 || t === N - 1)
      ? vel[t].slice()
      : vel[t].map((x, k) => (x - vel[t - 1][k]) / (2 * dt));
  }
  aEst[0] = aEst[1].slice(); aEst[N - 1] = aEst[N - 2].slice();
  const B = [], ar = [];
  for (let t = 0; t < N; t++) {
    const r = norm3(pos[t]) || 1e-12;
    B.push(basisLaw(r));
    ar.push((aEst[t][0] * pos[t][0] + aEst[t][1] * pos[t][1] + aEst[t][2] * pos[t][2]) / r);
  }
  let c = lstsq(B, ar);
  for (let it = 0; it < 10; it++) {
    const mx = Math.max.apply(null, c.map(Math.abs));
    const active = c.map(x => Math.abs(x) > 0.02 * mx);
    if (active.filter(Boolean).length <= 1) break;
    const Bact = B.map(row => row.filter((_, j) => active[j]));
    const ca = lstsq(Bact, ar);
    const cn = c.map(() => 0);
    let j = 0;
    for (let k = 0; k < c.length; k++) if (active[k]) cn[k] = ca[j++];
    const close = c.every((x, k) => Math.abs(x - cn[k]) < 1e-12);
    c = cn;
    if (close) break;
  }
  const pred = B.map((row, t) => row.reduce((s, b, k) => s + b * c[k], 0));
  const na = Math.sqrt(ar.reduce((s, x) => s + x * x, 0)) || 1;
  const resid = Math.sqrt(ar.reduce((s, x, t) => s + (pred[t] - x) * (pred[t] - x), 0)) / na;
  return { c, resid };
}

/** split-half：μ = 均值系数，δ = 统计半宽。 */
function learnLawInterval(pos, vel, dt) {
  const h = Math.floor(pos.length / 2);
  const l1 = learnLaw(pos.slice(0, h), vel.slice(0, h), dt);
  const l2 = learnLaw(pos.slice(h), vel.slice(h), dt);
  return {
    mu: l1.c.map((x, i) => (x + l2.c[i]) / 2),
    delta: l1.c.map((x, i) => Math.abs(x - l2.c[i]) / 2),
    resid: Math.max(l1.resid, l2.resid)
  };
}

function checkLaw(law) {
  if (!law) return null;
  if (!Array.isArray(law) || law.length !== 4 || law.some(x => typeof x !== 'number' || !isFinite(x))) {
    throw new Error('law 必须是 4 个有限数的数组 [c0,c1,c2,c3]（基 1/r²,1/r,1,1/r³）');
  }
  return law;
}

function checkMuDelta(p) {
  const mu = checkLaw(p.mu);
  const delta = checkLaw(p.delta);
  if (!mu || !delta) throw new Error('experience_absorb 需要 mu 与 delta（law_learn 的 law.mu / law.delta）');
  if (delta.some(v => v < 0)) throw new Error('delta 需为非负数');
  return { mu, delta };
}

/* ------------------------------------------------------------ experience */
function experienceGet() {
  if (!store) {
    return {
      ok: true,
      persisted: false,
      note: '本服务未配置经验持久化（启动缺 --experience <path.json>）。' +
        'experience_absorb 已被拒绝（fail-closed，不静默丢经验）。要跨会话记忆请加参数重启。'
    };
  }
  const s = store.state();
  return { ok: true, persisted: true, expPath, state: s };
}

function experienceAbsorb(p) {
  if (!store) {
    throw new Error('未配置经验持久化（启动缺 --experience <path.json>）—— 拒绝吸收，经验不静默丢弃');
  }
  const { mu, delta } = checkMuDelta(p);
  const n = p.nObs;
  if (!Number.isInteger(n) || n < 1) throw new Error('nObs 需为正整数（= law_learn 返回的 nObs，该次拟合轨迹点数）');
  store.absorb(mu, delta, n);
  store.save();
  return { ok: true, persisted: true, expPath, state: store.state() };
}

/* ------------------------------------------------------------ world_sim */
function worldSim(p) {
  const steps = Math.floor(p.steps);
  const dt = +p.dt || 0.01;
  if (!steps || steps < 1 || steps > 500000) throw new Error('steps 需为 1..500000 的整数');
  if (!(dt > 0)) throw new Error('dt 需为正数');
  if (!Array.isArray(p.bodies) || p.bodies.length === 0) throw new Error('bodies 需至少一个物体');
  const law = checkLaw(p.law);
  const w = new RW({
    centralLaw: law, mutual: !!p.mutual, collide: !!p.collide, rMin: p.rMin != null ? +p.rMin : 0.5,
    constraint: p.constraint && p.constraint.type === 'sphere'
      ? { type: 'sphere', R: +p.constraint.R || 10 } : null
  });
  for (const b of p.bodies) {
    if (!b.pos || !b.vel) throw new Error('每个物体需 pos 与 vel');
    w.addBody(b.pos, b.vel, b.mass != null ? +b.mass : 1.0, b.radius != null ? +b.radius : 0.2);
  }
  const reportEvery = Math.max(1, Math.ceil(steps / 4000));   // 单物体轨迹采样 ≤4000 点
  const nB = w.bodies.length;
  const posS = [], velS = [];
  for (let i = 0; i < nB; i++) { posS.push([]); velS.push([]); }
  const e0 = w.energy();
  const L0 = norm3(w.angularMomentum());
  let first = true;
  for (let s = 0; s < steps; s++) {
    try { w.step(dt); } catch (e) { return { ok: false, error: String(e.message || e) }; }
    if (first || s % reportEvery === 0 || s === steps - 1) {
      for (let i = 0; i < nB; i++) {
        posS[i].push(w.bodies[i].pos.slice());
        velS[i].push(w.bodies[i].vel.slice());
      }
      first = false;
    }
  }
  const e1 = w.energy(), L1 = norm3(w.angularMomentum());
  return {
    ok: true,
    centralLaw: law ? { basis: B_LABELS, coeffs: law } : { default: '硬写 −GM/r²（G=1,M=1000）' },
    steps, dt, tFinal: +(steps * dt).toFixed(6), bodies: nB,
    sampledEvery: reportEvery,
    trajectory: {
      pos: posS, vel: velS,
      shape: 'bodies[i].pos / .vel = N 个 [x,y,z]，共 ' + posS[0].length + ' 个采样点'
    },
    invariants: {
      energyDriftPct: Math.abs(e1 - e0) / Math.abs(e0 || 1) * 100,
      angMomDriftPct: Math.abs(L1 - L0) / (L0 || 1) * 100,
      note: p.constraint ? '球面约束开启：能量/角动量漂移仅为投影残差，无物理意义（约束非力）' : '由时间平移/旋转对称（诺特）推出的守恒量漂移'
    }
  };
}

/* ------------------------------------------------------------ law_learn */
function lawLearn(p) {
  const pos = p.pos, vel = p.vel, dt = +p.dt || 0.01;
  if (!Array.isArray(pos) || !Array.isArray(vel) || pos.length < 200 || pos.length !== vel.length) {
    throw new Error('需要轨迹 pos/vel（≥200 点等长数组），即 world_sim 返回的 trajectory');
  }
  const split = p.splitHalf !== false;
  const r = split ? learnLawInterval(pos, vel, dt) : learnLaw(pos, vel, dt);
  const mu = split ? r.mu : r.c;
  const delta = split ? r.delta : [0, 0, 0, 0];
  const dom = B_LABELS[mu.map(Math.abs).indexOf(Math.max.apply(null, mu.map(Math.abs)))];
  return {
    ok: true,
    law: { basis: B_LABELS, mu, delta },
    dominant: dom,
    nObs: pos.length,   // 本次拟合的证据量（experience_absorb 的权重）
    fitResidual: +(split ? r.resid : r.resid).toFixed(6),
    note: 'mu=经验律均值，delta=split-half 统计半宽（只含噪声性不确定，不含基可辨识性系统偏差）；' +
      '能学什么由候选基（数学先验）决定；该律只在训练区段可信。'
  };
}

/* ------------------------------------------------------------ law_eval */
function fieldResidual(aLaw, bLaw, rLo, rHi) {
  let num = 0, den = 0;
  for (let i = 0; i <= 200; i++) {
    const r = rLo + (rHi - rLo) * i / 200;
    const b = basisLaw(r);
    const am = aLaw.reduce((s, c, k) => s + c * b[k], 0);
    const at = bLaw.reduce((s, c, k) => s + c * b[k], 0);
    num += (am - at) * (am - at); den += at * at;
  }
  return Math.sqrt(num / (den || 1)) * 100;
}

function lawEval(p) {
  const truth = checkLaw(p.truthLaw);
  const model = checkLaw(p.modelLaw);
  const T = +p.time || 60, dt = +p.dt || 0.01;
  const pos0 = p.initPos || [10, 0, 0], vel0 = p.initVel || [0, 8, 0];
  const steps = Math.max(100, Math.round(T / dt));
  const orbPeriod = +p.orbitPeriod || 3.96;      // 该初值下纯反平方轨道周期 ≈3.96
  const simOne = function (law) {
    const w = new RW({ centralLaw: law, rMin: 0.5 });
    w.addBody(pos0, vel0, 1.0);
    const P = [pos0.slice()];
    for (let s = 0; s < steps; s++) { w.step(dt); P.push(w.bodies[0].pos.slice()); }
    return P;
  };
  let Pt = null, Pm = null;
  try { Pt = simOne(truth); Pm = simOne(model); } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
  const fR = fieldResidual(model, truth, 5, 15);
  function sepAt(i) {
    const d = Math.hypot(Pt[i][0] - Pm[i][0], Pt[i][1] - Pm[i][1], Pt[i][2] - Pm[i][2]);
    const r = norm3(Pt[i]) || 1e-12;
    return d / r * 100;
  }
  const i1 = Math.min(steps, Math.max(1, Math.round(orbPeriod / dt)));   // ~1 圈
  const iEnd = steps;
  let maxPct = 0;
  for (let i = 0; i <= steps; i += 5) { const s = sepAt(i); if (s > maxPct) maxPct = s; }
  const s1 = sepAt(i1), sEnd = sepAt(iEnd);
  return {
    ok: true,
    fieldResidualPct: fR,
    orbit: {
      sep1OrbitPct: s1, sepEndPct: sEnd, maxPct, orbitsRun: +(steps * dt / orbPeriod).toFixed(1)
    },
    verdict: fR < 0.5 && sEnd < 5
      ? '经验律贴合：力场残差小，轨道长程保持贴合'
      : '模型律偏离真实律：硬写设计律漏掉真实结构（如 1/r³ 修正）时，随圈数明显甩开'
  };
}

/* ------------------------------------------------- MCP stdio（字节级分帧） */
let buf = Buffer.alloc(0);
process.stdin.on('data', c => { buf = Buffer.concat([buf, c]); pump(); });
process.stdin.on('end', () => {});   // 不 process.exit：等 stdout flush 后自然退出

function pump() {
  const SEP = Buffer.from('\r\n\r\n');
  let i;
  while ((i = buf.indexOf(SEP)) !== -1) {
    const header = buf.slice(0, i).toString('utf8');
    const m = /Content-Length:\s*(\d+)/i.exec(header);
    if (!m) { buf = buf.slice(i + 4); continue; }
    const len = +m[1], start = i + 4;
    if (buf.length < start + len) return;          // 字节数，勿用字符串 length
    const msg = JSON.parse(buf.slice(start, start + len).toString('utf8'));
    buf = buf.slice(start + len);
    if (msg && msg.jsonrpc === '2.0' && msg.id !== undefined) handle(msg);
  }
}

function send(obj) {
  const body = Buffer.from(JSON.stringify(obj));
  process.stdout.write(Buffer.concat([Buffer.from('Content-Length: ' + body.length + '\r\n\r\n'), body]));
}

function toolResult(text) {
  return { content: [{ type: 'text', text }] };
}

const TOOLS = [
  {
    name: 'world_sim',
    description: '灵境·观察/驱动真实世界：建 RealWorld3D（默认中心律 −GM/r²；可传 law=[c0..c3]=[1/r²,1/r,1,1/r³] 上的经验律系数），加若干物体（pos/vel/mass/radius），以速度 Verlet 步进 steps·dt，返回逐物体轨迹采样与守恒漂移读数（能量/角动量）。奇异点(<rMin)拒绝(fail-closed)。',
    inputSchema: {
      type: 'object',
      properties: {
        bodies: { type: 'array', items: {
          type: 'object',
          properties: {
            pos: { type: 'array', items: { type: 'number' }, description: '[x,y,z]' },
            vel: { type: 'array', items: { type: 'number' }, description: '[vx,vy,vz]' },
            mass: { type: 'number' }, radius: { type: 'number' }
          }, required: ['pos', 'vel']
        }, description: '至少一个物体' },
        steps: { type: 'integer', description: '步数 1..500000（默认 6000）' },
        dt: { type: 'number', description: '时间步长（默认 0.01）' },
        law: { type: 'array', items: { type: 'number' }, description: '可选 [c0,c1,c2,c3]（基 1/r²,1/r,1,1/r³）经验律；缺省=硬写 −GM/r²' },
        mutual: { type: 'boolean', description: '物体间互引力 N 体' },
        collide: { type: 'boolean', description: '弹性碰撞' },
        constraint: { type: 'object', description: '可选 {type:"sphere",R} 球面几何约束(数学层)' }
      },
      required: ['bodies']
    }
  },
  {
    name: 'law_learn',
    description: '灵境·从真实世界轨迹学中心力律（SINDy/STLSQ + split-half）：输入 world_sim 返回的 trajectory（pos/vel 采样点），输出经验律 μ±δ（基 [1/r²,1/r,1,1/r³]）与拟合残差、nObs（证据量=轨迹点数，供 experience_absorb 作权重）。能学什么由候选基(数学先验)决定；μ 只在本训练区段可信。',
    inputSchema: {
      type: 'object',
      properties: {
        pos: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: '轨迹位置采样 [[x,y,z],...]' },
        vel: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: '轨迹速度采样 [[vx,vy,vz],...]' },
        dt: { type: 'number', description: '采样时间步长（与 world_sim.dt 一致）' },
        splitHalf: { type: 'boolean', description: '是否给统计区间（默认 true）' }
      },
      required: ['pos', 'vel']
    }
  },
  {
    name: 'law_eval',
    description: '灵境·验律：比较两个中心律（truthLaw=真实/现实，modelLaw=虚拟世界的律）。返回力场径向残差(%)与同初值多圈轨道分离(1 圈/末圈/最大)，并给结论：残差小且末圈贴合→经验律；否则=模型偏离真实（如硬写设计律漏掉 1/r³ 修正）。',
    inputSchema: {
      type: 'object',
      properties: {
        truthLaw: { type: 'array', items: { type: 'number' }, description: '真实律 [c0..c3]' },
        modelLaw: { type: 'array', items: { type: 'number' }, description: '虚拟世界用的律（学出的 μ 或硬写 GM）' },
        time: { type: 'number', description: '轨道总时长（默认 60≈15 圈）' },
        dt: { type: 'number', description: '步长（默认 0.01）' },
        initPos: { type: 'array', items: { type: 'number' } },
        initVel: { type: 'array', items: { type: 'number' } }
      },
      required: ['truthLaw', 'modelLaw']
    }
  },
  {
    name: 'experience_get',
    description: '灵境·读经验（跨会话持久记忆）：返回机器人当前持有的经验律 state={nObs, mu, delta, band}。上次会话 experience_absorb 过、这次还能 get 到。nObs=0 → delta/band=null（诚实：还没学过）。未配置 --experience → persisted:false。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'experience_absorb',
    description: '灵境·吸收经验：把一次 law_learn 的 (law.mu, law.delta) 以证据量 nObs（=law_learn 返回的 nObs，该次拟合轨迹点数；n 大=可信）精度加权融合进持久经验并落盘。新经验与旧经验冲突 → δ 放大=承认不确定（"我可能错了"，adapt_loop 语义）。需要服务端启动带 --experience <path.json>，否则 fail-closed 拒绝。融合后可 world_sim({law: state.mu}) 用经验驱动虚拟世界。',
    inputSchema: {
      type: 'object',
      properties: {
        mu: { type: 'array', items: { type: 'number' }, description: 'law_learn 返回的 law.mu [c0..c3]' },
        delta: { type: 'array', items: { type: 'number' }, description: 'law_learn 返回的 law.delta（可全 0）' },
        nObs: { type: 'integer', description: 'law_learn 返回的 nObs（轨迹点数，证据权重）' }
      },
      required: ['mu', 'delta', 'nObs']
    }
  }
];

function callTool(name, p) {
  switch (name) {
    case 'world_sim': return JSON.stringify(worldSim(p), null, 1);
    case 'law_learn': return JSON.stringify(lawLearn(p), null, 1);
    case 'law_eval': return JSON.stringify(lawEval(p), null, 1);
    case 'experience_get': return JSON.stringify(experienceGet(), null, 1);
    case 'experience_absorb': return JSON.stringify(experienceAbsorb(p), null, 1);
    default: throw new Error('未知工具: ' + name);
  }
}

function handle(msg) {
  try {
    if (msg.method === 'initialize') {
      send({ jsonrpc: '2.0', id: msg.id, result: {
        protocolVersion: '2024-11-05', capabilities: { tools: {} },
        serverInfo: { name: 'lingjing-mcp', version: '1.1.0' }
      } });
    } else if (msg.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
    } else if (msg.method === 'tools/call') {
      const name = msg.params && msg.params.name;
      const p = (msg.params && msg.params.arguments) || {};
      const text = callTool(name, p);
      send({ jsonrpc: '2.0', id: msg.id, result: toolResult(text) });
    } else if (msg.method === 'notifications/initialized') {
      /* 通知无响应 */
    } else {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: '未知方法: ' + msg.method } });
    }
  } catch (e) {
    try { send({ jsonrpc: '2.0', id: msg.id, result: toolResult(JSON.stringify({ ok: false, error: String(e.message || e) })) }); }
    catch (e2) { /* ignore */ }
  }
}

/* ------------------------------------------------------------ 自检 */
if (process.argv.includes('--selftest')) {
  const A = (s, ok, msg) => { console.log((ok ? '  ✅ ' : '  ❌ ') + s + (ok ? '' : '  ← ' + msg)); if (!ok) process.exitCode = 1; };
  console.log('=== lingjing-mcp --selftest ===');
  // 1) world_sim：近圆轨道 5 圈，能量/角动量守恒，采样形状正确
  const sim = worldSim({ bodies: [{ pos: [10, 0, 0], vel: [0, 10, 0] }], steps: 2000, dt: 0.01 });
  A('world_sim 跑通', sim.ok && sim.trajectory.pos[0].length > 100, 'traj=' + (sim.ok && sim.trajectory.pos[0].length));
  A('world_sim 能量漂移 ~1e-6', sim.invariants.energyDriftPct < 1e-3, 'E=' + sim.invariants.energyDriftPct);
  A('world_sim |L| 漂移 ~1e-12', sim.invariants.angMomDriftPct < 1e-8, 'L=' + sim.invariants.angMomDriftPct);
  // 2) law_learn：从纯反平方轨迹学回 −1000，误差 <0.2%
  const t2 = worldSim({ bodies: [{ pos: [10, 0, 0], vel: [0, 8, 0] }], steps: 6000, dt: 0.01 });
  const lr = lawLearn({ pos: t2.trajectory.pos[0], vel: t2.trajectory.vel[0], dt: 0.01 });
  const err0 = Math.abs(lr.law.mu[0] + 1000) / 1000 * 100;
  A('law_learn 学回 1/r²=−1000', err0 < 0.2, 'mu0=' + lr.law.mu[0].toFixed(3) + ' 误差' + err0.toFixed(3) + '%');
  // 3) law_eval：真实=+600/r³ 修正；经验律应贴合，硬写 GM 应偏离（轨道分离 经验 < 设计）
  const evalExp = lawEval({ truthLaw: [-1000, 0, 0, 600], modelLaw: [-1000.36, 0, 0, 603.06] });
  const evalDes = lawEval({ truthLaw: [-1000, 0, 0, 600], modelLaw: [-1000, 0, 0, 0] });
  A('law_eval 经验律末端分离 <5%', evalExp.ok && evalExp.orbit.sepEndPct < 5, 'sep=' + evalExp.orbit.sepEndPct.toFixed(3) + '%');
  A('law_eval 设计律偏离 >> 经验律', evalDes.orbit.maxPct > evalExp.orbit.maxPct * 10,
    '设计max=' + evalDes.orbit.maxPct.toFixed(2) + '% vs 经验max=' + evalExp.orbit.maxPct.toFixed(3) + '%');
  // 4) fail-closed：r < rMin 拒启
  const fc = worldSim({ bodies: [{ pos: [0.1, 0, 0], vel: [0, 0, 0] }], steps: 10 });
  A('world_sim 奇点 fail-closed', fc.ok === false && /奇点/.test(fc.error || ''), String(fc.error));
  // 5) 经验持久化：空 → 首次吸收(采纳) → 跨实例读回(=模拟重启) → 冲突放大 δ
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingjing-exp-'));
  const tmpFile = path.join(tmpDir, 'experience.json');
  try {
    const e1 = new ExperienceStore(tmpFile);
    const st0 = e1.state();
    A('experience 空态 nObs=0 / band=null', st0.nObs === 0 && st0.delta === null && st0.band === null, JSON.stringify(st0));
    e1.absorb([-1001, 0, 0, 600], [10, 0, 0, 50], 6000);
    e1.save();
    const ok1 = e1.state().nObs === 6000 && e1.state().mu[0] === -1001 && e1.state().delta[0] === 10 && e1.state().band.lo[0] === -1011;
    A('experience 首次吸收=直接采纳', ok1, JSON.stringify(e1.state()));
    const e2 = new ExperienceStore(tmpFile);            // 新实例读同一文件 = 模拟"重启后跨会话"
    const st2 = e2.state();
    const ok2 = st2.nObs === 6000 && st2.mu[0] === -1001 && st2.delta[3] === 50;
    A('experience 跨实例/跨会话读回一致', ok2, 'nObs=' + st2.nObs + ' mu0=' + st2.mu[0] + ' delta3=' + st2.delta[3]);
    e2.absorb([-800, 0, 0, 400], [10, 0, 0, 50], 6000);   // 冲突：μ0 从 −1001 挪到 −900.5
    const st3 = e2.state();
    const expMu0 = (-1001 * 6000 + -800 * 6000) / 12000;
    const expD0 = Math.max(Math.sqrt((6000 * 100 + 6000 * 100) / 12000), Math.abs(expMu0 - (-800))); // max(pooled=10, conflict=100.5)
    A('experience 冲突放大 δ（承认不确定）', Math.abs(st3.mu[0] - expMu0) < 1e-9 && Math.abs(st3.delta[0] - expD0) < 1e-9,
      'mu0=' + st3.mu[0].toFixed(4) + '(期望' + expMu0.toFixed(4) + ') δ0=' + st3.delta[0].toFixed(4) + '(期望' + expD0.toFixed(4) + ')');
    e2.save();
    const e3 = new ExperienceStore(tmpFile);            // 再"重启"：融合后的经验仍在
    const st4 = e3.state();
    A('experience 融合后持久化读回', st4.nObs === 12000 && Math.abs(st4.mu[0] - expMu0) < 1e-9, 'nObs=' + st4.nObs);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 忽略清理失败 */ }
  }
  console.log(process.exitCode ? '\nSELFTEST FAILED' : '\nSELFTEST PASSED');
}
