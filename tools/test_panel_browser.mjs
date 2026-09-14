// 真机验证：3D 课室跑完一堂课后，「技能卡片组 + 知识已传入AI + 心流 + 最后一课总结」是否真的渲染出来。
// CDP 驱动 Edge（--headless=old，SwiftShader 提供软件 WebGL），零依赖。
// 前置：node server.js 已在跑（默认 127.0.0.1:8080）。本测试不需要 LINGJING_OR_KEY（走兜底，快且不烧额度）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const URL_ = process.env.LJ_URL || 'http://127.0.0.1:8080/classroom3d.html';
const OUT = process.env.LJ_OUT || path.join(os.tmpdir(), 'lj-panel');
const PORT = Number(process.env.LJ_CDP_PORT) || 9224;
const CAND = [
  process.env.LJ_EDGE,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const EDGE = CAND.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!EDGE) { console.log('❌ 找不到 Edge，可用 LJ_EDGE=<path> 指定'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const profile = path.join(os.tmpdir(), 'lj-panel-profile-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  ✅ ' : '  ❌ ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };

let ws, nextId = 1; const pending = new Map();
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('CDP 超时: ' + method)); } }, 30000);
  });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval 异常');
  return r.result && r.result.value;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(OUT, name + '.png');
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log('  📷 ' + p);
}

const edge = spawn(EDGE, [
  '--headless=old', '--disable-gpu', '--no-sandbox', '--disable-extensions',
  '--remote-debugging-port=' + PORT, '--window-size=1440,900',
  '--user-data-dir=' + profile, 'about:blank',
], { stdio: 'ignore' });

try {
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(300);
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = list.find((t) => t.type === 'page'); } catch {}
  }
  if (!target) throw new Error('Edge CDP 起不来');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: URL_ });
  await sleep(3500);

  const url = URL_.replace(/^https?:\/\//, '');
  console.log('【0】页面加载  ' + url);
  const loaderr = await evaluate('getComputedStyle(document.getElementById("loaderr")).display');
  ok(loaderr === 'none', '3D 引擎加载成功（未显示 loaderr 兜底）', 'display=' + loaderr);
  ok(await evaluate('!!document.querySelector("canvas")'), 'WebGL canvas 已创建');
  ok((await evaluate('(window.__ERR&&window.__ERR.length)||0')) === 0, '加载期无 JS 错误');

  console.log('\n【1】课前：生产性失败探索（先自己猜两次）→ 开课');
  await evaluate('document.querySelector("#chips a[data-demo]").click()');
  await sleep(900);
  ok(await evaluate('document.getElementById("probe").classList.contains("on")'),
    '探针卡出现在讲台条上方（不是全屏挡板）');
  ok(!(await evaluate('!!document.getElementById("setup")')), '没有全屏挡板（守住"一打开就是教室"）');
  const q1 = await evaluate('document.getElementById("pQ").textContent');
  ok(String(q1).length > 8, '第一个探针是一句可回答的问题', String(q1).slice(0, 26) + '…');
  // 两次**不同角度**的真实尝试（Kapur 的硬条件）
  await evaluate('document.getElementById("replyText").value = "我觉得阳光对植物来说是能量的来源，不是养分。因为植物要靠光能制造糖，没有阳光就没能量，所以长不大。"');
  await evaluate('document.getElementById("replySend").click()');
  await sleep(600);
  const step1 = await evaluate('document.getElementById("pStep").textContent');
  ok(/第 2 次/.test(String(step1)), '第一次提交后要求换个角度再来', String(step1));
  await evaluate('document.getElementById("replyText").value = "我猜叶子发黄是缺水，水少了就造不出糖，叶子就黄了。也可能是光照不够，因为叶子要用光做这件事。"');
  await evaluate('document.getElementById("replySend").click()');
  await sleep(600);
  const step2 = await evaluate('document.getElementById("pStep").textContent');
  ok(/够了|去讲/.test(String(step2)), '两次不同角度的尝试 → 放行', String(step2));
  const btnTxt = await evaluate('document.getElementById("replySend").textContent');
  ok(/开始上课/.test(String(btnTxt)), '按钮切换为「开始上课」', String(btnTxt));

  console.log('\n【2】正式开课 → 每轮点"跳过"推进 → 跑满 4 轮 → 下课');
  await evaluate('document.getElementById("replyText").value = "光合作用::阳光不是植物的「饭」，它只是能量的来源；植物真正吃的是自己用光和水造出来的糖。叶子发黄多半不是缺肥，而是缺光或水太多。"');
  await evaluate('document.getElementById("replySend").click()');
  await sleep(6000);
  const started = await evaluate('document.getElementById("status").textContent');
  console.log('    开课后状态条: ' + started);
  ok(!/还没|课前/.test(String(started)) || /轮|学生|问/.test(String(started)), '课堂已开始（状态条已更新）', String(started).slice(0, 40));

  // 3D 课室是交互式的：每轮结束会停下等老师回话 —— 测试里用"跳过"推进（等价于教师不额外补充）
  let done = false, t = 0, skips = 0;
  while (!done && t < 150) {
    await sleep(2000); t += 2;
    const canSkip = await evaluate('(()=>{const b=document.getElementById("replySkip"); if(!b) return false; return b.offsetParent!==null && getComputedStyle(b).display!=="none";})()');
    if (canSkip) { await evaluate('document.getElementById("replySkip").click()'); skips++; }
    done = await evaluate('document.getElementById("work").classList.contains("on")');
  }
  ok(done, '课堂跑完，作品面板已弹出（#work.on）', '耗时约 ' + t + 's · 跳过 ' + skips + ' 次');
  await sleep(1200);

  // ===== 用户反馈：课后"界面变成文字，不是课室"。这条得用数字守住 =====
  // 判据：默认展开的内容 ≤ 1.5 屏；首屏第一眼有图（峰曲线）；资料性章节默认收起；课室在背后仍可见。
  console.log('\n【1b】课后首屏不许是一堵字（用户反馈回归）');
  await evaluate('document.getElementById("work").querySelector(".scroll").scrollTop = 0');
  await sleep(500);
  await shot('panel-0-课后默认首屏');
  const firstScreen = await evaluate(`(()=>{
    const work=document.getElementById('work'), box=work.querySelector('.scroll');
    const closed=[...box.querySelectorAll('details.sec')].filter(d=>!d.open).length;
    const all=box.querySelectorAll('details.sec').length;
    const svg=box.querySelector('#peakChart svg');
    const r=svg?svg.getBoundingClientRect():null;
    return {
      screens:+(box.scrollHeight/work.clientHeight).toFixed(2),
      words:(box.innerText||'').length,
      chart:!!svg,
      chartWhole:!!r && r.top>=0 && r.bottom<=innerHeight,
      closed, all,
      canvasVisible: (()=>{const c=document.querySelector('canvas'); return !!c && getComputedStyle(c).display!=='none';})(),
      bgAlpha: getComputedStyle(work).backgroundImage.includes('gradient')
    };
  })()`);
  ok(firstScreen.chart, '课后首屏第一眼是「峰」曲线（图），不是一段文字');
  ok(firstScreen.chartWhole, '一打开就能完整看见曲线（不用滚动、不被裁）');
  // 改造前实测：2646px 内容 / 761px 视口 = 3.48 屏纯文字、3103 字。这里守住"不再回退成文字墙"。
  ok(firstScreen.screens <= 2.0, '默认展开的内容 ≤ 2 屏（改造前是 3.48 屏的文字墙）',
    firstScreen.screens + ' 屏 · ' + firstScreen.words + ' 字');
  ok(firstScreen.closed >= 3, '资料性章节默认收起（纪要/理论总结/卡片/知识库）',
    '收起 ' + firstScreen.closed + '/' + firstScreen.all + ' 节');
  ok(firstScreen.canvasVisible, '3D 课室画布在课后仍然存在（没有把课室拆掉）');
  ok(firstScreen.bgAlpha, '课后遮罩是压暗而不是盖死（课室在背后透得出来）');

  // 回到课室：课后也得有一条路走回那间教室（原来只能"再上一课"＝刷新重来）
  await evaluate('document.getElementById("closeWork").click()');
  await sleep(600);
  const back = await evaluate(`(()=>({
    workOff: !document.getElementById('work').classList.contains('on'),
    reopen: getComputedStyle(document.getElementById('reopen')).display !== 'none'
  }))()`);
  ok(back.workOff, '「回到课室」能收起课后回顾（课室重新成为主场景）');
  ok(back.reopen, '收起后留了「看课后回顾」入口（不让人找不着）');
  await shot('panel-0b-回到课室');
  await evaluate('document.getElementById("reopen").click()');
  await sleep(600);
  ok(await evaluate('document.getElementById("work").classList.contains("on")'),
    '再点能回到课后回顾（课室 ↔ 回顾双向都通）');

  // 后面要验证折叠里的内容 → 全部展开
  await evaluate('document.querySelectorAll("#work details.sec").forEach(d=>d.open=true)');
  await sleep(600);
  await evaluate('document.getElementById("deck").scrollIntoView({block:"center"})');
  await sleep(700);
  await shot('panel-1-下课面板-技能卡片');

  console.log('\n【2】技能卡片组 + 传授度量 + 心流');
  const cards = await evaluate('document.querySelectorAll("#deck .card").length');
  ok(cards >= 1, '技能卡片已渲染', cards + ' 张');
  const kVal = await evaluate('document.getElementById("kVal").textContent');
  ok(/^\d/.test(String(kVal)), '「知识已传入 AI」有数值', 'K=' + kVal);
  const fb = await evaluate('document.getElementById("flowBadge").textContent');
  ok(fb && fb !== '–', '心流徽章有态', fb);
  const deckNote = await evaluate('document.getElementById("deckNote").textContent');
  ok(!/失败/.test(deckNote), '卡片生成无异常', deckNote.slice(0, 30));

  console.log('\n【3】最后一课总结（给人类的"理论感"）');
  const senses = await evaluate('document.querySelectorAll("#senses .sense").length');
  ok(senses === 4, '四感卡片 = 4（体验/游戏/实践/理论）', senses + ' 个');
  const senseTxt = await evaluate('Array.from(document.querySelectorAll("#senses .sense")).map(e=>e.textContent).join(" | ")');
  console.log('    ' + senseTxt);
  ok(/体验感/.test(senseTxt) && /理论感/.test(senseTxt), '四感含"体验感/理论感"');
  const rows = await evaluate('document.querySelectorAll("#sumTheory tbody tr").length');
  ok(rows >= 8, '数学地图覆盖分支 ≥8', rows + ' 行');
  const rowsTxt = await evaluate('Array.from(document.querySelectorAll("#sumTheory td:first-child")).map(e=>e.textContent).join(" / ")');
  console.log('    数学分支: ' + rowsTxt);
  const next = await evaluate('document.getElementById("sumNext").textContent');
  ok(/枢纽|步骤|复习/.test(next), '给出了"下一步"（把实践变理论）');
  const sumNote = await evaluate('document.getElementById("sumNote").textContent');
  ok(!/失败/.test(sumNote), '总结生成无异常', sumNote.slice(0, 26));

  console.log('\n【3b】新增三块：课前对照 / 顿悟峰 / 跨课知识库');
  const preDisp = await evaluate('getComputedStyle(document.getElementById("preWrap")).display');
  const preTxt = await evaluate('document.getElementById("preBox").textContent');
  ok(preDisp !== 'none' && /尝试/.test(String(preTxt)),
    '课前两次尝试被拿出来与讲解对照（Kapur：不对接就等于白失败）', String(preTxt).slice(0, 28) + '…');
  const peakTxt = await evaluate('document.getElementById("peakBox").textContent');
  const peakCls = await evaluate('document.getElementById("peakBox").className');
  // ⚠️ 断言**不许扫文案关键词**：正常的产物叙事里就含"这不是失败"这类词，
  //    黑名单式的 /失败/ 会把正常输出判成异常（这条坑已复发过一次，见 memory）。
  //    改用结构判据：class 落到 peakbox[none] + 有长度 + 没有 undefined/NaN。
  ok(/peakbox/.test(String(peakCls)) && String(peakTxt).length > 10 && !/undefined|NaN/.test(String(peakTxt)),
    '「峰」给出了明确结论（有峰说峰 / 没峰如实说没有）', String(peakTxt).slice(0, 32) + '…');
  const jGrow = await evaluate('document.getElementById("jGrowth").textContent');
  ok(/个概念|还没有积累/.test(String(jGrow)), '知识库给出成长叙事', String(jGrow).slice(0, 30) + '…');
  const jStats = await evaluate('document.getElementById("jStats").textContent');
  ok(/概念/.test(String(jStats)) && /课题/.test(String(jStats)), '知识库统计量齐全', String(jStats));
  ok(/FSRS|简化骨架/.test(await evaluate('document.getElementById("jNote").textContent')),
    '知识库注明了排期模型 + 诚实边界');
  const jLen = await evaluate('(()=>{try{const j=JSON.parse(localStorage.getItem("lingjing.journal.v1")||"{}");return (j.cards||[]).length;}catch(e){return -1;}})()');
  ok(jLen >= 1, '知识库真的落盘到本机浏览器（localStorage）', 'cards=' + jLen);
  // 第一课刚上完，一张卡都没到期 —— 时间轴必须仍然画出来（退而显示"接下来该复习的"），
  // 否则这张图在第一课永远看不见，界面只剩一句"今天没有到期的卡"。
  const tlRows = await evaluate('document.querySelectorAll("#jQueue .tl-row").length');
  const tlTxt = await evaluate('document.getElementById("jQueue").textContent');
  ok(tlRows >= 1, '复习时间轴在第一课就画得出来（不是一句"没有到期的卡"）', tlRows + ' 条');
  ok(/对数刻度/.test(String(tlTxt)), '时间轴注明了刻度口径');
  // 刻度必须锚绝对天数（1 天…1 年），不是按本组最大值归一化：
  // 归一化时"三张卡都是 3 天后"会全画成 100%，长度就不携带任何量级信息。
  const tlWidths = await evaluate(`Array.from(document.querySelectorAll('#jQueue .tl-track > i')).map(e=>parseInt(e.style.width)||0)`);
  ok(tlWidths.length >= 1 && tlWidths.every((w) => w > 0 && w < 100),
    '条长是绝对刻度（没有归一化到 100%，也没退化成 0）', JSON.stringify(tlWidths));
  const ruler = await evaluate('document.querySelectorAll("#jQueue .tl-axis .ruler i").length');
  ok(ruler === 5, '带刻度尺（1天/7天/30天/90天/1年），条长能翻译成天数', ruler + ' 个刻度');
  // 刻度尺必须和条轨道**对齐** —— 否则刻度读出来是错的（比没有刻度更糟）。
  // 不靠肉眼看截图，直接量两条边。
  const align = await evaluate(`(()=>{
    const t=document.querySelector('#jQueue .tl-track').getBoundingClientRect();
    const r=document.querySelector('#jQueue .tl-axis .ruler').getBoundingClientRect();
    return { dl:+(t.left-r.left).toFixed(1), dw:+(t.width-r.width).toFixed(1) };
  })()`);
  ok(Math.abs(align.dl) <= 1.5 && Math.abs(align.dw) <= 1.5,
    '刻度尺与条轨道左右边对齐（刻度读数才可信）',
    '左偏 ' + align.dl + 'px · 宽差 ' + align.dw + 'px');
  // 卡片上显示的复习时间，必须与知识库的 DSR 排期一致 —— 不许两套时间在界面里打架
  const consistent = await evaluate(`(()=>{
    const j = JSON.parse(localStorage.getItem("lingjing.journal.v1")||"{}");
    const cards = j.cards||[];
    let checked = 0, bad = 0;
    document.querySelectorAll('#deck .card').forEach(el=>{
      const key = el.getAttribute('data-key');
      const c = cards.find(x=>x.key===key);
      const meta = el.querySelector('.cmeta');
      if(!c || !meta) return;
      const m = meta.textContent.match(/复习 (\\d+) 天后/);
      if(!m) return;
      checked++;
      const want = Math.max(1, Math.round((c.dueAt - Date.now())/86400000));
      if (Number(m[1]) !== want) bad++;
    });
    return {checked, bad};
  })()`);
  ok(consistent.checked > 0 && consistent.bad === 0,
    '卡片复习时间与知识库 DSR 排期一致（界面里没有两套时间）', JSON.stringify(consistent));
  await evaluate('document.getElementById("preWrap").scrollIntoView({block:"start"})');
  await sleep(700);
  await shot('panel-3-课前对照与顿悟峰');
  await evaluate('document.getElementById("jGrowth").scrollIntoView({block:"center"})');
  await sleep(700);
  await shot('panel-4-跨课知识库');

  console.log('\n【4】人类体验层：课上不摊内部指标 + 人话副标题 + 无 JS 错误');
  const metricsHidden = await evaluate('getComputedStyle(document.getElementById("metrics")).display');
  ok(metricsHidden === 'none', '课堂现场不摊内部指标（#metrics 已隐藏）', 'display=' + metricsHidden);
  const wkSub = await evaluate('document.getElementById("wkSub").textContent');
  ok(!/R̄|σ²|兜底语料|走真 LLM|token/i.test(String(wkSub)), '纪要副标题是人话（无内部指标/技术状态）', wkSub);
  const errs = await evaluate('JSON.stringify(window.__ERR||[])');
  ok(errs === '[]', '无运行期错误', errs);
  await evaluate('(document.querySelector(".sumwrap")||document.getElementById("sumTheory")).scrollIntoView({block:"start"})');
  await sleep(700);
  await shot('panel-2-课后总结');

  console.log(fails ? `\n❌ ${fails} 项失败` : '\n✅ 全部通过');
} catch (e) {
  console.log('\n❌ 测试异常：' + (e && e.message || e)); fails++;
} finally {
  try { edge.kill(); } catch {}
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(fails ? 1 : 0);
}
