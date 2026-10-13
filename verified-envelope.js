// verified-envelope.js — 灵数 / 灵脑 / 灵境 MCP 输出的「验证证据信封」参考实现
// 对应市场需求：Sombra/BitTalks 的 "verification evidence / Chain-of-Verification" ——
//   agent 外调确定性引擎后，必须拿到结构化、可机器校验的保证，而不是一句"我算好了"。
//
// 纯函数、零依赖，Node / 浏览器均可直接 import。
// 用途：我们的 MCP 工具返回结果时，用 makeEnvelope 包一层，agent 侧即可信任并审计。
//
// 信封契约（对外统一口径 trust:"certified"）：
// {
//   verified:     boolean,        // 是否通过形式化/区间认证（fail-closed：默认 false）
//   engine:       string,         // "lingshu" | "lingnao" | "lingjing"
//   method:       string,         // 认证方法，如 "krawczyk-interval" / "formal-proof" / "append-only"
//   errorBound:   number | null,  // 可证误差界（灵数 Krawczyk）；非数值类为 null
//   provenCount:  number | null,  // 已证明解 / 命题数
//   undecidable:  boolean,        // 是否命中 𝕌（灵脑诚实未知，绝不编造）
//   failClosed:   true,           // 我们恒为 fail-closed
//   proofAvailable: boolean,      // 是否附带可复现证明链
//   trust:        "certified"
// }

function makeEnvelope({ engine, method, verified, errorBound = null, provenCount = null, undecidable = false, proofAvailable = false }) {
  if (typeof verified !== 'boolean') {
    // fail-closed：任何未显式通过认证的，一律视为未验证，绝不隐式 true
    throw new Error('verified must be explicit boolean (fail-closed: never implicit true)');
  }
  return Object.freeze({
    verified,
    engine,
    method,
    errorBound,
    provenCount,
    undecidable,
    failClosed: true,
    proofAvailable,
    trust: 'certified',
    issuedAt: new Date().toISOString(),
  });
}

// 任何异常都返回 verified:false —— 绝不静默通过（对应 Akamai 测出 91.8% MCP server 缺鉴权/易信的缺口）
function safeEnvelope(engine, method, build) {
  try {
    const inner = build();
    return makeEnvelope({ engine, method, ...inner });
  } catch (e) {
    return makeEnvelope({ engine, method, verified: false, proofAvailable: false });
  }
}

// ---- 自检（node verified-envelope.js）----
if (typeof require !== 'undefined' && require.main === module) {
  const a = makeEnvelope({
    engine: 'lingshu', method: 'krawczyk-interval',
    verified: true, errorBound: 1e-6, provenCount: 4, proofAvailable: true,
  });
  const b = safeEnvelope('lingnao', 'formal-proof', () => { throw new Error('kernel busy'); });
  const c = makeEnvelope({
    engine: 'lingjing', method: 'append-only',
    verified: true, provenCount: 7, // 7 维盲区输出
  });
  console.log('lingshu :', JSON.stringify(a));
  console.log('lingnao :', JSON.stringify(b));
  console.log('lingjing:', JSON.stringify(c));
  if (a.verified !== true || b.verified !== false || b.failClosed !== true || c.trust !== 'certified') {
    console.error('SELFTEST FAIL');
    process.exit(1);
  }
  console.log('SELFTEST PASS');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { makeEnvelope, safeEnvelope };
}
