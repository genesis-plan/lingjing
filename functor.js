// functor.js — 函子 / 自然变换的产品化（镜子自检 / 可审计性）
// ============================================================================
// 数学来源：范畴论。函子 F: C→D 保结构（F(g∘f)=Fg∘Ff）。
//   自然变换 η: F⇒G 的交换图：对任意态射 f: X→Y，有 η_Y∘F(f)=G(f)∘η_X。
//   一句话：当“底层输入变了”（f），“上层反映的变化”必须和它一致走，不能各走各的。
//
// 本产品的创造性应用（镜子自检）：把“镜子”建模为函子 F：学生话语范畴 → 镜面反映范畴。
//   自然变换 η 的交换图 = “学生没改口（f 是恒等），镜面反映却翻了牌（η 不交换）”。
//   ⇒ 本算子审计：对学生反复讲到的同一概念（同一 stance），镜子给的“是否归为被命名卡点”
//     这一结构判断是否前后一致。一致 ⇒ 自然性成立（函子保结构，可审计）；
//     不一致 ⇒ 镜面自相矛盾，报警（这是镜子该修的 bug，不是人的问题）。
//
// ⚠️ 红线（守 A2）：本算子只审计“镜子自身是否自洽”，绝不产出“你理解度”量。
//   目前接入的是镜子的确定性结构透镜（Λ 慢性卡点判定）；未来若接入 LLM 逐概念判词，
//   同一函数可捕获其自相矛盾，无需改接口。
// ============================================================================

'use strict';

/**
 * 自然性审计：同一 stance（学生没改口）跨轮次，镜面结构判定是否一致。
 * @param {Array<{round:number, stance:string,
 *            mirrored:boolean}>} rounds
 *        stance = 这轮讲了什么概念的组合签名（学生输入侧）；
 *        mirrored = 镜子是否把这轮的某一概念归到了“被命名卡点”（镜面反映侧）。
 * @returns {{ok:boolean, commutative:boolean,
 *            flips:Array<{stance:string, rounds:number[], from:string, to:string}>,
 *            line:string, note:string}}
 */
function checkNaturality(rounds) {
  const rs = (rounds || []).filter((r) => r && typeof r.stance === 'string');
  if (rs.length < 2) {
    return {
      ok: false,
      commutative: true,
      flips: [],
      note: '轮数不足，自然性审计无从谈起（诚实：不编结论）。',
      line: '话还不够多，看不出镜面在你没改口时是否前后一致。',
    };
  }
  // 按 stance 分组：同一 stance（你没改口）应在不同轮次得到相同的 mirrored 判定
  const byStance = new Map();
  for (const r of rs) {
    if (!byStance.has(r.stance)) byStance.set(r.stance, []);
    byStance.get(r.stance).push(r);
  }
  const flips = [];
  for (const [stance, group] of byStance) {
    if (group.length < 2) continue;            // 只出现一次，无从比对
    const mirs = group.map((g) => !!g.mirrored);
    if (mirs.some((m) => m !== mirs[0])) {
      flips.push({
        stance,
        rounds: group.map((g) => g.round),
        from: mirs[0] ? '归为卡点' : '未归为卡点',
        to: mirs[0] ? '未归为卡点' : '归为卡点',
      });
    }
  }
  const commutative = flips.length === 0;
  let line, note;
  if (commutative) {
    line = '这面镜子是**函子**：你讲法的结构怎么变，镜面反映的结构就怎么变，不乱套。'
      + '尤其在你没改口的那些概念上，镜子前后判定一致（自然变换的交换图闭合）——可审计。';
    note = '同一 stance 跨轮次的 mirrored 判定一致 ⇒ 自然变换交换图闭合 ⇒ 函子自然性成立。';
  } else {
    line = '镜面**自己前后不一致**：你在下面这些概念上没改口，镜子却翻了牌——'
      + flips.map((f) => `第 ${f.rounds.join('、')} 轮关于「${f.stance}」从「${f.from}」变到「${f.to}」`).join('；')
      + '。这是镜子该修的自相矛盾，不是你的问题。';
    note = '存在 stance 跨轮 mirrored 判定翻转 ⇒ 自然变换交换图不闭合 ⇒ 函子自然性失效（报修）。';
  }
  return { ok: true, commutative, flips, note, line };
}

module.exports = { checkNaturality };
