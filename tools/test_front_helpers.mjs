// 前端纯函数单测 —— 从 public/classroom3d.html 里抽出纯函数真跑，不引任何依赖。
// 为什么这样做：3D 页面的渲染逻辑（《课堂纪要》Markdown 渲染 / LLM 诚实文案）藏在模块脚本里，
// 一旦改坏，只有人打开浏览器才发现。这里把不依赖 DOM 与 THREE 的函数抽出来直接跑断言。
// 用法：node tools/test_front_helpers.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(__dirname, '..', 'public', 'classroom3d.html');
const src = fs.readFileSync(HTML, 'utf-8');
const m = src.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) { console.error('❌ 在 classroom3d.html 里找不到 <script type="module">'); process.exit(1); }
const code = m[1];

// 按大括号配对抽出一个顶层 function 声明（不依赖 AST，够用且不引依赖）
function cutFn(name) {
  const i = code.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('找不到函数 ' + name);
  let d = 0;
  for (let j = i; j < code.length; j++) {
    if (code[j] === '{') d++;
    else if (code[j] === '}') { d--; if (d === 0) return code.slice(i, j + 1); }
  }
  throw new Error('函数 ' + name + ' 大括号不配对');
}

const NAMES = ['escapeHtml', 'mdToHtml', 'llmLine'];
const exported = NAMES.map(cutFn).join('\n');

let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ✅ ' : '  ❌ ') + msg); if (!c) fails++; };

// 在隔离作用域里只注入被抽出的纯函数（不碰 DOM / THREE）
const factory = new Function(exported + '\nreturn { ' + NAMES.join(', ') + ' };');
const { mdToHtml, llmLine } = factory();

console.log('【mdToHtml】《课堂纪要》的 Markdown 渲染');
const md = [
  '# 《光合作用》课堂纪要',
  '',
  '## 一、先生讲了什么',
  '- 阳光只是**能量来源**',
  '- 叶子发黄多半是缺水',
  '',
  '## 四、还没弄明白的',
  '- 小明：为什么不能反着来',
  '',
  '> 本纪要由五名学生整理',
].join('\n');
const h = mdToHtml(md);
ok(h.includes('<h3>《光合作用》课堂纪要</h3>'), '一级标题 → h3');
ok(h.includes('<h3>一、先生讲了什么</h3>'), '二级标题 → h3');
ok((h.match(/<ul>/g) || []).length === 2, '两组列表各自开标签');
ok((h.match(/<\/ul>/g) || []).length === 2, '</ul> 数量匹配（不嵌套错乱）');
ok(h.includes('<li>阳光只是<b>能量来源</b></li>'), '列表项 + 粗体');
ok(h.includes('<blockquote>本纪要由五名学生整理</blockquote>'), '引用块');
ok(mdToHtml('<img src=x onerror=alert(1)>').includes('&lt;img'), 'HTML 实体转义（不注入裸标签）');
ok(mdToHtml('').trim() === '', '空字符串安全');
ok(mdToHtml(null).trim() === '', 'null 安全');
ok(mdToHtml(undefined).trim() === '', 'undefined 安全');

console.log('\n【llmLine】LLM 状态诚实文案（不许谎称"真 LLM 学生在场"）');
ok(llmLine({ state: 'verified', model: 'X' }).includes('真 LLM 学生在场'), 'verified → 才敢说"真 LLM 学生在场"');
ok(llmLine({ state: 'unverified' }).includes('首次调用前不保证可用'), 'unverified → 不宣称已就绪');
ok(llmLine({ state: 'no-key' }).includes('未配置'), 'no-key → 明说没配密钥');
ok(llmLine({ state: 'circuit-open', reason: '额度用尽' }).includes('额度用尽'), 'circuit-open → 带上真实原因');
ok(llmLine(null).length > 0, 'null 不抛错');
ok(llmLine(undefined).length > 0, 'undefined 不抛错');

console.log('\n' + (fails ? fails + ' 项未通过 ❌' : '全部通过 ✅'));
process.exit(fails ? 1 : 0);
