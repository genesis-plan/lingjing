/**
 * 灵脑风格 · 可审计决策核（灵境 MVP 用）
 * ----------------------------------------------------------------------------
 * 诚实边界标注：
 *   本文件是【对齐灵脑 verifyLedger / FIREWALL 概念的最小真实实现】，
 *   不是完整灵脑内核。完整灵脑（八元组 BrainTuple、M1–M4 证明模块、
 *   SHA-256 哈希链 + HMAC 单写者、human-in-the-loop）见 灵脑.html。
 *   此处保留灵脑的三条灵魂不变量：
 *     1. verifyLedger —— 不可篡改审计账本（哈希链）
 *     2. FIREWALL     —— 信任防火墙（不满足约束即拒，零释放）
 *     3. fail-closed  —— 缺证据 / 不满足即拒绝，绝不默认放行
 *   哈希用 cyrb53（同步、确定性），演示链不可篡改性质；
 *   完整内核用 SHA-256+HMAC，安全性更高但 API 同构。
 *
 * 浏览器：挂 window.LingNaoDecision ；Node：module.exports。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.LingNaoDecision = api;
  if (typeof globalThis !== 'undefined') globalThis.LingNaoDecision = api;
})(this, function () {
  'use strict';

  // 同步确定性哈希（cyrb53），用于哈希链不可篡改演示
  function _hash(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
  }

  /**
   * 审计账本：哈希链。append 返回带 prevHash/hash 的不可篡改条目。
   */
  class VerifyLedger {
    constructor() {
      this.chain = [];
      this.genesis = _hash('GENESIS-灵境', 1);
      this._head = this.genesis;
    }
    append(entry) {
      const prev = this._head;
      // 修（2026-09-04）：旧版把 Date.now() 算进 hash 却【不存时间戳】，
      // 导致 verify() 无法重算，只能比对 prevHash 链连续性 —— 改掉某条 entry
      // 内容后 verify() 仍返回 true（假绿）。现把 ts 存入记录，verify 真正重算。
      const ts = Date.now();
      const body = JSON.stringify({ prev, ts, e: entry });
      const h = _hash(body);
      const rec = { seq: this.chain.length + 1, ts, prevHash: prev, hash: h, entry };
      this.chain.push(rec);
      this._head = h;
      return rec;
    }
    // 校验整链完整性：重算每条 hash + 校验 prevHash 链连续。
    // 任一处被篡改（内容改动 / 断链 / 重排）即返回 false。
    verify() {
      let head = this.genesis;
      for (const rec of this.chain) {
        if (rec.prevHash !== head) return false;                       // 断链 / 重排
        const body = JSON.stringify({ prev: rec.prevHash, ts: rec.ts, e: rec.entry });
        if (_hash(body) !== rec.hash) return false;                    // 内容篡改
        head = rec.hash;
      }
      return head === this._head;
    }
    get length() { return this.chain.length; }
  }

  /**
   * FIREWALL 信任防火墙 + fail-closed 决策门。
   * 输入调度提案 task + 上下文 ctx（机器人状态等）。
   * 返回 { approved, reason, gate }；任一约束不满足 → approved:false（零释放）。
   */
  function decide(task, ctx) {
    const gates = [];
    // G1 电量门：剩余电量须高于安全阈值（fail-closed：未知即拒）
    const okPower = typeof ctx.power === 'number' && ctx.power >= (ctx.powerFloor || 0.2);
    gates.push({ name: 'G1-power', pass: okPower, detail: `power=${ctx.power == null ? '未知' : ctx.power.toFixed(2)} floor=${(ctx.powerFloor || 0.2)}` });
    // G2 容量门：负载不超过额定
    const okCap = typeof ctx.load === 'number' && ctx.load <= (ctx.cap || 1);
    gates.push({ name: 'G2-capacity', pass: okCap, detail: `load=${ctx.load == null ? '未知' : ctx.load} cap=${ctx.cap || 1}` });
    // G3 路径门：目标不与已占用点冲突（无冲突即安全）
    const okPath = !ctx.conflict;
    gates.push({ name: 'G3-path', pass: okPath, detail: ctx.conflict ? '路径冲突' : '无冲突' });
    // G4 证据门：必须带来源可追溯 ID（可审计）
    const okEv = !!task && !!task.from;
    gates.push({ name: 'G4-evidence', pass: okEv, detail: okEv ? `from=${task.from}` : '无来源' });
    // G5 热安全门（灵境物理安全）：仅在声明温度上限时启用；超温即拒（fail-closed）
    if (ctx.tempLimit != null) {
      const okTemp = typeof ctx.tempMax === 'number' && ctx.tempMax <= ctx.tempLimit;
      gates.push({
        name: 'G5-thermal', pass: okTemp,
        detail: `tempMax=${ctx.tempMax == null ? '未知' : ctx.tempMax.toFixed(3)} limit=${ctx.tempLimit}`
      });
    }

    const blocked = gates.filter(g => !g.pass);
    if (blocked.length > 0) {
      return {
        approved: false,
        reason: 'FIREWALL-DENY: ' + blocked.map(g => g.name + '(' + g.detail + ')').join('; '),
        gate: 'deny',
        blocked
      };
    }
    return {
      approved: true,
      reason: 'FIREWALL-ALLOW: 全部约束通过',
      gate: 'allow',
      blocked: []
    };
  }

  return { _hash, VerifyLedger, decide };
});
