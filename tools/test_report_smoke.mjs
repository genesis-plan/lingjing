// tools/test_report_smoke.mjs — 教师报告【端到端】冒烟（钉住 createSession 那条长函数的真实执行路径）
// 为什么要有这个测试：2026-09-25 踩过一个真 bug——块级 const 被跨块引用，
// 单元测试只测模块、从不跑 finalize/createSession，于是 ReferenceError 一直潜伏。
// 本测试跑真实 runClassroom（无 key → 确定性兜底，不发网络），专门守这条路径不再炸。
import { runClassroom } from '../teacher.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let passed = 0, failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
};

let r = null;
let threw = null;
try {
  r = await runClassroom(
    {
      title: '函数与映射',
      content: '函数是一种映射，映射是一种对应关系。单射是一种映射，满射是一种映射。'
        + '双射既是单射也是满射。函数的定义域和值域都是数集。',
    },
    { maxRounds: 4, onLog: () => {} }
  );
} catch (e) {
  threw = e;
}

check('① 端到端：runClassroom 不抛异常（守块级作用域 ReferenceError 那类潜伏 bug）', threw === null);
if (threw) console.log('    抛出的错误：' + threw.message);

if (r) {
  check('② 端到端：产出 teacherReportMd', typeof r.teacherReportMd === 'string' && r.teacherReportMd.length > 0);
  const md = r.teacherReportMd || '';
  check('③ 报告不含未渲染的 undefined / [object Object]',
    !md.includes('undefined') && !md.includes('[object Object]'));
  // 新接的两段是条件渲染（要有映射网才有），故只做"若出现则形态正确"的断言，不硬要求必现
  if (md.includes('米田引理')) {
    check('④ 米田段：出现时带依据注记', /〔[^〕]*指纹重合[^〕]*〕/.test(md));
  } else {
    console.log('  · 米田段未触发（本例未抽出足够映射网）——条件渲染，非失败');
  }
  if (md.includes('Knaster')) {
    check('⑤ Tarski 段：出现时给的是上界或诚实说明',
      md.includes('剩余上界') || md.includes('上界无从给出'));
  } else {
    console.log('  · Tarski 段未触发（本例链不单调或轮次不足）——条件渲染，非失败');
  }
  // 红线判的是"有没有产出掌握度"，而报告里有「概念覆盖（信息论，非掌握度）」
  // 这种【否定用法】是在声明自己不是掌握度——先把否定式剥掉再判，别冤枉自己。
  // 红线判的是"有没有真的产出分数"，而报告里满是「非掌握度」「不评分」这类
  // 【否定式声明】——那是在声明自己不评分，恰恰是守红线的证据。故先剥否定式，
  // 只判【肯定式】出现。真要是产出了分数，必然是肯定式表述，跑不掉。
  const stripped = md.replace(/(不|非|无|未|没有|拒绝)(掌握度|得分|评分|正确率|熟练度)/g, '');
  const hit = ['掌握度', '得分', '评分', '正确率', '熟练度'].find((w) => stripped.includes(w));
  check('⑥ 红线：整份报告不产出掌握度/得分/评分', !hit);
  if (hit) {                                    // 失败时把上下文打出来，别让人猜
    const i = stripped.indexOf(hit);
    console.log('    命中「' + hit + '」：…' + stripped.slice(Math.max(0, i - 30), i + 12) + '…');
  }
}

// ── ⑦ 接线契约：照 teacher.js 里那两段的【真实调用形状】跑一遍 ──
//   报告里这两段是条件渲染（无 key 时教师发言走兜底语料，抽不出映射网就不出现），
//   所以端到端未必触发；但"调用形状对不对"必须钉住——否则 teacher.js 里的接线
//   可能是哑的（参数/返回结构不匹配），而没人会发现。
{
  const mbridge = (await import('../mapbridge.js')).default;
  const yon = (await import('../yoneda.js')).default;
  const tsk = (await import('../tarski.js')).default;
  const taught = '函数是一种映射，映射是一种对应关系。单射是一种映射，满射是一种映射。双射既是单射也是满射。';
  const concepts = ['函数', '映射', '关系', '单射', '满射', '双射'];
  const mb = await mbridge.buildModelFromTeaching(taught, { concepts, deadline: 8000 });
  check('⑦ 接线：mapbridge 抽出映射', mb.maps.length > 0);
  check('⑦ 接线：mb.model 具备 teacher.js 用到的形状',
    typeof mb.model.concepts === 'function' && typeof mb.model.blindSpots === 'function');

  const yind = yon.indistinguishable(mb.model);
  check('⑦ 接线：米田段调用不抛、返回 groups 数组', Array.isArray(yind.groups));
  const fp = tsk.reachFixpoint(mb.model, mb.blindSpots.orphans.length ? mb.blindSpots.orphans : mb.model.concepts().slice(0, 1));
  check('⑦ 接线：Tarski 段调用不抛、ok=true', fp.ok === true);
  check('⑦ 接线：不动点迭代不超上界', fp.iterations <= fp.bound);
  console.log(`    · 实况：抽出 ${mb.maps.length} 条映射，米田同形组 ${yind.groups.length} 组` +
    `${yind.groups.length ? '（' + yind.groups.map((g) => g.join('/')).join('，') + '）' : ''}，` +
    `不动点 ${fp.iterations} 步 / 上界 ${fp.bound} 步，闭包 ${fp.closure.length} 个概念`);
}

// 清理落盘的会话文件（验证产物，不留垃圾）
try {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sessions');
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) if (f.includes('函数与映射')) fs.unlinkSync(path.join(dir, f));
  }
} catch {}

console.log(`\n  report smoke: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
