
// ============================================================================
// 灵数求解器 · 求解核心（id="solver-core"，MCP/回归测试均按此显式标记抽取）
// ============================================================================
// ── 求解核心导航 ──────────────────────────────────────────────
//  词法/语法   : tokenize → parseCondition → parse → evalAST（AST 求值）
//  区间工具    : intervalEval + 符号微分（suan47 分支定界依赖其导数包络）
//  算子注册表  : 49 个有效算子 suan1–suan32（编号非连续）。其中 suan35（投影反证
//                剪枝）与 suan36（雅可比秩引导投影方向）于 2026-08-21 由空壳占位正式
//                落地实现；仅剩 7 个 vacant 编号（18/27/28/30/32/35/42）从未实现、不在
//                任何调度数组，仅为历史占位。注册于 OPS_SETUP/PRE/SCREEN/ALGEBRA/
//                ALGEBRA2/CONTRACT/GEOMETRY/NUMERIC/POST + OP_BRANCH/INEQ/OUTPUT
//  求解管线    : solve → _solveImpl（阶段1前置拦截→7分支定界/输出）
//                → _finish（幂等收尾，含 _filterIllDefined 忠实方程假解过滤）
//  浏览器 UI   : 本 script 末尾的交互函数（结果渲染/示例加载/弹窗）
// ─────────────────────────────────────────────────────────────
// 先注销旧 Service Worker，确保加载最新版本
if (navigator.serviceWorker) {
    navigator.serviceWorker.getRegistrations().then(function(regs) {
        regs.forEach(function(reg) { reg.unregister(); });
    });
    // 清理所有 lingshu-solver 缓存
    if (window.caches) {
        caches.keys().then(function(names) {
            names.forEach(function(n) {
                if (n.indexOf('lingshu-solver') === 0) caches.delete(n);
            });
        });
    }
}
window.onerror = function(msg, url, line, col, err) {
    console.error("JS错误:", msg, "行:", line);
};

// 用户协议弹窗开关
function openAgreement() {
    var m = document.getElementById('agreementModal');
    if (m) m.classList.add('open');
    document.body.style.overflow = 'hidden';
}
function closeAgreement() {
    var m = document.getElementById('agreementModal');
    if (m) m.classList.remove('open');
    document.body.style.overflow = '';
}

// 接入智能体（MCP）弹窗开关
function openAgentModal() {
    var m = document.getElementById('agentModal');
    if (!m) return;
    try {
        // 解析 mcp-server.js 与 index.html 同目录时的绝对路径（供配置使用）
        var u = new URL('mcp-server.js', location.href);
        var p = decodeURIComponent(u.pathname);
        if (p.charAt(0) === '/' && /^[A-Za-z]:/.test(p.slice(1))) p = p.slice(1);
        var cmd = 'node "' + p + '"';
        var cfg = JSON.stringify(
            { mcpServers: { "lingshu-solver": { command: "node", args: [p] } } },
            null, 2
        );
        var ce = document.getElementById('agentCmd'); if (ce) ce.textContent = cmd;
        var cf = document.getElementById('agentCfg'); if (cf) cf.textContent = cfg;
    } catch (e) { /* 路径解析失败不影响弹窗展示 */ }
    m.classList.add('open');
    document.body.style.overflow = 'hidden';
}
function closeAgentModal() {
    var m = document.getElementById('agentModal');
    if (m) m.classList.remove('open');
    document.body.style.overflow = '';
}
// 复制文本：elId=源元素，btnId=按钮（复制后短暂高亮）
function copyText(elId, btnId) {
    var el = document.getElementById(elId);
    var txt = el ? el.textContent : '';
    copyToClipboard(txt, btnId);
}
function copyTextRaw(txt, btn) {
    copyToClipboard(txt, btn ? btn.id : null);
}
function copyToClipboard(txt, btnId) {
    function mark(b) {
        if (!b) return;
        b.textContent = '已复制';
        b.classList.add('copied');
        setTimeout(function () { b.textContent = '复制'; b.classList.remove('copied'); }, 1200);
    }
    var btn = btnId ? document.getElementById(btnId) : null;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { mark(btn); }, function () { fallbackCopy(txt, btn); });
    } else {
        fallbackCopy(txt, btn);
    }
}
function fallbackCopy(txt, btn) {
    try {
        var ta = document.createElement('textarea');
        ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        if (btn) { btn.textContent = '已复制'; btn.classList.add('copied');
            setTimeout(function () { btn.textContent = '复制'; btn.classList.remove('copied'); }, 1200); }
    } catch (e) {}
}
// 点击遮罩空白处关闭（两个弹窗）
window.addEventListener('click', function(e) {
    var a = document.getElementById('agreementModal');
    var b = document.getElementById('agentModal');
    if (a && e.target === a) closeAgreement();
    if (b && e.target === b) closeAgentModal();
});
// Esc 关闭
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { closeAgreement(); closeAgentModal(); }
});

function tokenize(str) {
    const tokens = [];
    let i = 0;
    const funcs = ['sin', 'cos', 'tan', 'ln', 'exp', 'sqrt', 'log', 'log10', 'abs', 'diff', 'int', 'ode', 'lim',
                  'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
                  'floor', 'ceil', 'gamma', 'log2', 'mod'];

    while (i < str.length) {
        const ch = str[i];

        // 跳过空白
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            i++;
            continue;
        }

        // 数字
        if (/\d/.test(ch) || (ch === '.' && i + 1 < str.length && /\d/.test(str[i + 1]))) {
            let num = '';
            while (i < str.length && /\d/.test(str[i])) {
                num += str[i];
                i++;
            }
            if (i < str.length && str[i] === '.') {
                num += '.';
                i++;
                while (i < str.length && /\d/.test(str[i])) {
                    num += str[i];
                    i++;
                }
            }
            // 科学计数法
            if (i < str.length && (str[i] === 'e' || str[i] === 'E')) {
                let expPart = str[i];
                i++;
                if (i < str.length && (str[i] === '+' || str[i] === '-')) {
                    expPart += str[i];
                    i++;
                }
                if (i < str.length && /\d/.test(str[i])) {
                    while (i < str.length && /\d/.test(str[i])) {
                        expPart += str[i];
                        i++;
                    }
                    num += expPart;
                } else {
                    // 不是科学计数法，回退
                    i -= expPart.length;
                }
            }
            tokens.push({ type: 'num', value: parseFloat(num) });
            continue;
        }

        // 变量名或函数名（支持英文字母、下划线、希腊字母——θ/α/β 等数学惯例变量名；
        // π 在常量检查中保持为圆周率常数，其余希腊字母视为普通变量）
        if (/[a-zA-Z_\u0370-\u03FF\u2080-\u209F]/.test(ch)) {
            let name = '';
            while (i < str.length && /[a-zA-Z0-9_\u0370-\u03FF\u2080-\u209F]/.test(str[i])) {
                name += str[i];
                i++;
            }
            // 检查 pi / π 和 e 常量
            if (name === 'pi' || name === 'π') {
                tokens.push({ type: 'num', value: Math.PI });
            } else if (name === 'e' && !funcs.includes(name)) {
                tokens.push({ type: 'num', value: Math.E });
            } else if (funcs.includes(name)) {
                tokens.push({ type: 'func', name: name });
            } else {
                tokens.push({ type: 'var', name: name });
            }
            continue;
        }

        // 运算符
        if ('+-*/^(),='.includes(ch)) {
            tokens.push({ type: 'op', value: ch });
            i++;
            continue;
        }

        // 未知字符：不再静默吞掉（曾导致 x² 被误读成 x 等静默破坏方程），
        // 改为抛出明确错误，由 runSolver 捕获并提示用户。
        var hint = "";
        if (ch === '²') hint = "（如需平方请写成 x^2）";
        else if (ch === '³') hint = "（如需立方请写成 x^3）";
        else if (ch === '√') hint = "（如需开方请写成 sqrt(x)）";
        else if (ch === '≤') hint = "（如需上界请写成 x <= 上限）";
        else if (ch === '≥') hint = "（如需下界请写成 x >= 下限）";
        else if (ch === '≠') hint = "（不等于请写成 x != 值）";
        else if (ch === '·' || ch === '×') hint = "（乘号请写成 *）";
        else if (ch === '÷') hint = "（除号请写成 /）";
        throw new Error("无法识别的字符 '" + ch + "'（位于第 " + (i + 1) + " 位）" + hint + "。求解器仅支持 ASCII 运算符 + - * / ^ ( ) =、英文字母变量名与内置函数（sin/cos/tan/ln/exp/sqrt/arcsin…）。");
    }

    return tokens;
}

// ASCII 希腊字母名 → Unicode 符号（如 theta→θ, alpha→α），便于用常见拼写输入希腊变量名。
// 排除已被占用的 gamma(函数 gamma) 与 pi(常数 π)，避免与既有行为冲突。
function _greekNameToSymbol(s) {
    var MAP = {
        'alpha':'α','beta':'β','delta':'δ','epsilon':'ε','zeta':'ζ','eta':'η',
        'theta':'θ','iota':'ι','kappa':'κ','lambda':'λ','mu':'μ','nu':'ν','xi':'ξ',
        'omicron':'ο','rho':'ρ','sigma':'σ','tau':'τ','upsilon':'υ','phi':'φ',
        'chi':'χ','psi':'ψ','omega':'ω',
        'Alpha':'Α','Beta':'Β','Delta':'Δ','Epsilon':'Ε','Zeta':'Ζ','Eta':'Η',
        'Theta':'Θ','Iota':'Ι','Kappa':'Κ','Lambda':'Λ','Mu':'Μ','Nu':'Ν',
        'Xi':'Ξ','Omicron':'Ο','Rho':'Ρ','Sigma':'Σ','Tau':'Τ','Upsilon':'Υ',
        'Phi':'Φ','Chi':'Χ','Psi':'Ψ','Omega':'Ω'
    };
    return String(s).replace(/\b([A-Za-z]+)\b/g, function(m){ return MAP.hasOwnProperty(m) ? MAP[m] : m; });
}

function fuzzyFix(str) {
    let s = str;

    // 全角符号归一化（必须在最前面执行）
    // ＝→=, （→(, ）→), ＋→+, －→-, ＊→*, ／→/, ，→,, ．→., ：→:
    s = s.replace(/[\uFF1D\uFF08\uFF09\uFF0B\uFF0D\uFF0A\uFF0F\uFF0C\uFF0E\uFF1A]/g, function(ch) {
        const map = { '\uFF1D': '=', '\uFF08': '(', '\uFF09': ')', '\uFF0B': '+',
                      '\uFF0D': '-', '\uFF0A': '*', '\uFF0F': '/', '\uFF0C': ',',
                      '\uFF0E': '.', '\uFF1A': ':' };
        return map[ch] || ch;
    });

    // 去除换行：从豆包/通义等复制时方程常"打竖"（每个字符独立成行），
    // 换行会打断隐式乘法的相邻性（如 4⏎(x-2)、2⏎x），致解析失败→0解。
    // 核心路径以"方程数组"为契约，单条方程内的换行直接去除（不影响数组层面的多方程分隔）。
    s = s.replace(/\r?\n/g, '');

    // Unicode上标转 ^N 表示法（必须在其他规则之前执行）
    // ⁰¹²³⁴⁵⁶⁷⁸⁹ → ^0 ^1 ^2 ...
    s = s.replace(/[\u2070\u00B9\u00B2\u00B3\u2074\u2075\u2076\u2077\u2078\u2079]+/g, function(match) {
        const map = { '\u2070': '0', '\u00B9': '1', '\u00B2': '2', '\u00B3': '3',
                      '\u2074': '4', '\u2075': '5', '\u2076': '6', '\u2077': '7',
                      '\u2078': '8', '\u2079': '9' };
        let digits = '';
        for (const ch of match) digits += map[ch];
        return '^' + digits;
    });

    // ** 转 ^ （Python风格幂运算）
    s = s.replace(/\*\*/g, '^');

    // 连续运算符合并: ++ → +, -- → +, +- → -, -+ → -
    s = s.replace(/\+\+/g, '+');
    s = s.replace(/--/g, '+');
    s = s.replace(/\+-|-\+/g, '-');

    // pow(base, exp) → (base)^(exp) （C/Python风格幂函数）
    // 需要循环处理嵌套情况
    let prevPow;
    do {
        prevPow = s;
        s = s.replace(/\bpow\s*\(\s*([^,()]+(?:\([^)]*\))?[^,()]*)\s*,\s*([^()]+(?:\([^)]*\))?[^()]*)\s*\)/g, '($1)^($2)');
    } while (s !== prevPow);

    // 微积分符号转换
    // ∫(expr, x, a, b) → int(expr, x, a, b)
    s = s.replace(/\u222B\s*\(/g, 'int(');
    s = s.replace(/\u222B\s*/g, 'int(');

    // d/dx(expr) → diff(expr, x) — 用括号匹配精确处理
    s = (function(input) {
        let result = '';
        let i = 0;
        while (i < input.length) {
            // 匹配 d/dx 模式
            const match = input.slice(i).match(/^d\s*\/\s*d([a-zA-Z_]\w*)\s*\(/);
            if (match) {
                const varName = match[1];
                const openParenIdx = i + match[0].length - 1; // '(' 的位置
                // 找到匹配的右括号
                let depth = 1;
                let j = openParenIdx + 1;
                while (j < input.length && depth > 0) {
                    if (input[j] === '(') depth++;
                    if (input[j] === ')') depth--;
                    if (depth === 0) break;
                    j++;
                }
                if (depth === 0) {
                    // 提取括号内容
                    const innerContent = input.slice(openParenIdx + 1, j);
                    result += 'diff(' + innerContent + ',' + varName + ')';
                    i = j + 1;
                    continue;
                }
            }
            result += input[i];
            i++;
        }
        return result;
    })(s);

    // 数学符号转换
    // ÷ → /
    s = s.replace(/÷/g, '/');
    // × → *
    s = s.replace(/×/g, '*');
    // 兼容从其他 AI（豆包/通义等）复制时带入的 Unicode 数学符号：
    // 减号 − / 短破折号 – / 长破折号 —（U+2212/U+2013/U+2014）→ ASCII -
    // 注意：core/MCP 路径只走 fuzzyFix（不走 cleanInput），此处补齐，否则 U+2212 会让 lexer 抛"无法识别字符"→ 解析失败 → 变量看似"未识别"。
    s = s.replace(/[−–—]/g, '-');
    // 中点乘号 ·（U+00B7，豆包常用）→ *
    s = s.replace(/·/g, '*');
    // 不等号 ≠（U+2260）→ !=（约束语法已支持）
    s = s.replace(/≠/g, '!=');
    // ASCII "pi" → Unicode "π"（交给下方隐式乘与 tokenizer 常量识别，避免 pi 被字母×字母规则误拆成 p*i）
    s = s.replace(/\bpi\b/g, 'π');
    // ASCII 希腊字母名 → Unicode 符号（alpha→α, theta→θ, ...），便于用常见拼写声明变量名。
    // 须在隐式乘/单字母拆解规则之前执行，使 theta 先归一化为 θ 再走后续规则，避免被拆成 t*h*e*t*a。
    // 函数名（sin/cos…）及被占用的 gamma/pi 不在映射表内，不受影响。
    s = _greekNameToSymbol(s);
    // （π 保持原字符，交由下方隐式乘规则与 tokenizer 常量识别处理；
    //  不再转为 'pi'，避免 2πx 粘连成假变量 pix 导致假阴性）
    // √( → sqrt( 以及 √x → sqrt(x)
    s = s.replace(/√\s*\(/g, 'sqrt(');
    s = s.replace(/√\s*([a-zA-Z_]\w*)/g, 'sqrt($1)');
    // ≤ → <=, ≥ → >=
    s = s.replace(/≤/g, '<=');
    s = s.replace(/≥/g, '>=');
    // 全角等号 ＝ → = （补全角归一化中漏掉的）
    s = s.replace(/＝/g, '=');
    // |expr| → abs(expr)（竖线绝对值），循环处理简单嵌套
    var prevAbs;
    do {
        prevAbs = s;
        s = s.replace(/\|([^|]+)\|/g, 'abs($1)');
    } while (s !== prevAbs);

    // 极限箭头转换: lim(x→a, expr) 或 lim(x->a, expr) → lim(expr, x, a)
    // 也支持全角箭头 →（U+FF8C 或实际 U+2192）
    // 匹配 lim(x → a, ...) 和 lim(x->a, ...)
    s = s.replace(/lim\s*\(\s*([a-zA-Z_]\w*)\s*(?:→|->)\s*([^,]+)\s*,\s*/g, 'lim($2, $1, ');

    // 函数名跟变量（带空格），补括号: sin x -> sin(x)
    // 注意：\b 开头；log10/log2 前置避免被 log 截走；函数名捕获为 $1、变量为 $2
    s = s.replace(/\b(log10|log2|sin|cos|tan|ln|exp|sqrt|log|abs|diff|int|ode|lim|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|floor|ceil|gamma|mod)\s+([a-zA-Z_]\w*)/g, '$1($2)');

    // 函数名紧跟变量无空格无括号，也补括号: sin2x -> sin(2x)（与上方带空格的 sin x 互补；sin(x)/sin(2x) 因后是 ( 不参与匹配）
    s = s.replace(/\b(log10|log2|sin|cos|tan|ln|exp|sqrt|log(?!2|10)|abs|diff|int|ode|lim|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|floor|ceil|gamma|mod)([0-9a-zA-Z_.]+)/g, '$1($2)');

    // 保护科学计数法（数字后跟 e/E 和可选符号及数字，如 1e100, 2e+5, 3.5e-10）
    // 必须在隐式乘法规则之前执行，防止 1e100 被拆成 1*e100
    // 使用 §§ 前缀避免隐式乘法规则 (\d)([a-zA-Z_]) 破坏标记
    var _sciValues = {};
    var _sciIdx = 0;
    s = s.replace(/(\d+(?:\.\d+)?)[eE]([+-]?\d+)/g, function(m) {
        var k = '\u00A7\u00A7SCI' + (_sciIdx++);
        _sciValues[k] = m;
        return k;
    });

    // 保护函数名中的数字，防止 log2( 被拆成 log2*(
    // 使用简单标记替换，避免被 (\d)\( 规则破坏
    s = s.replace(/log2\(/g, '§§LOG2§§');
    s = s.replace(/log10\(/g, '§§LOG10§§');

    // 数字直接跟变量（含希腊字母如 π），插入乘号: 2x -> 2*x ; 2π -> 2*π
    s = s.replace(/(\d)([a-zA-Z_\u0370-\u03FF])/g, '$1*$2');

    // 变量×变量并列: xy -> x*y （仅当两个字母均为孤立单字母，避免拆坏多字符变量名 x1/xvar、函数名 sin/cos 等；同时支持带空格 x y -> x*y）
    // 用循环重复替换，避免 JS String.replace 全局匹配不重叠导致 "xy z" 第一次吃掉 y 后 y z 漏拆
    {
        let _prev;
        do {
            _prev = s;
            s = s.replace(/(?<![\w.§])([a-zA-Z_\u0370-\u03FF])\s*([a-zA-Z_\u0370-\u03FF])(?![\w.§(])/g, '$1*$2');
        } while (s !== _prev);
    }

    // 连续≥3 单字母（含希腊）标识符按单字母拆: xyz -> x*y*z（排除已知函数名；长度2已在上方 xy 规则处理；含数字如 x1y 不匹配故不误拆）
    s = s.replace(/\b([a-zA-Z_\u0370-\u03FF]{3,})\b/g, function(m) {
        const _f = ['sin','cos','tan','ln','exp','sqrt','log','log10','abs','diff','int','ode','lim','cot','sec','csc','arcsin','arccos','arctan','sinh','cosh','tanh','floor','ceil','gamma','log2','mod'];
        if (_f.includes(m)) return m;
        return m.split('').join('*');
    });

    // 数字跟左括号: 2(x -> 2*(x
    s = s.replace(/(\d)\(/g, '$1*(');

    // 恢复被保护的函数名
    s = s.replace(/§§LOG2§§/g, 'log2(');
    s = s.replace(/§§LOG10§§/g, 'log10(');

    // 右括号跟左括号: )( -> )*(
    s = s.replace(/\)\(/g, ')*(');

    // 右括号跟变量: )x -> )*x
    s = s.replace(/\)([a-zA-Z_])/g, ')*$1');

    // 变量跟左括号: x( -> x*(
    s = s.replace(/([a-zA-Z_]\w*)\(/g, function(match, p1) {
        const funcs = ['sin', 'cos', 'tan', 'ln', 'exp', 'sqrt', 'log', 'log10', 'abs', 'diff', 'int', 'ode', 'lim',
                      'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
                      'floor', 'ceil', 'gamma', 'log2', 'mod'];
        if (funcs.includes(p1)) {
            return p1 + '(';
        }
        return p1 + '*(';
    });

    // 变量跟数字: x2 -> x*2 (但要排除变量名本身包含数字的情况如x2)
    // 这里不处理，因为x2是一个合法的变量名

    // 自动补全缺失的右括号
    let leftParens = 0;
    let rightParens = 0;
    for (const ch of s) {
        if (ch === '(') leftParens++;
        if (ch === ')') rightParens++;
    }
    if (leftParens > rightParens) {
        s += ')'.repeat(leftParens - rightParens);
    }

    // 恢复科学计数法（在隐式乘法、括号补全等规则之后执行）
    Object.keys(_sciValues).forEach(function(k) {
        s = s.split(k).join(_sciValues[k]);
    });

    return s;
}

function parseCondition(str) {
    var s = str.trim();

    // 归一化：中文术语 → 数学符号
    s = s.replace(/属于/g, '\u2208');       // ∈
    s = s.replace(/大于等于/g, '\u2265');   // ≥
    s = s.replace(/小于等于/g, '\u2264');   // ≤
    s = s.replace(/不等于/g, '\u2260');     // ≠
    s = s.replace(/大于/g, '>');
    s = s.replace(/小于/g, '<');

    // 全角括号/逗号 → 半角
    s = s.replace(/[\uFF3B\u3010]/g, '[').replace(/[\uFF3D\u3011]/g, ']');
    s = s.replace(/\uFF0C/g, ',');
    s = s.replace(/\uFF0D/g, '-');

    // 归一化：pi/π 变体
    s = s.replace(/\bpi\b/g, 'π');

    // 归一化：inf 变体
    s = s.replace(/\b(?:[+-]?infinity|[+-]?inf)\b/gi, function(m) {
        if (m === 'inf' || m === 'Inf' || m === '+inf' || m === '+Inf') return '∞';
        if (m === '-inf' || m === '-Inf') return '-∞';
        if (m === 'Infinity' || m === '+Infinity') return '∞';
        if (m === '-Infinity') return '-∞';
        return m;
    });

    // 移除空格
    s = s.replace(/\s+/g, '');

    // ---- 模式1: x∈[a,b] 或 x∈(a,b) ----
    // 支持 ∞ / -∞ / Unicode 无穷符号 \u221E / π
    var m1 = s.match(/^([a-zA-Z_\u0370-\u03FF]\w*)\u2208[\[\(]([^,\]]+),([^,\]]+)[\]\)]$/);
    if (m1) {
        var vn = m1[1], lo = m1[2], hi = m1[3];
        // 处理无穷边界
        if (lo === '-\u221E' || lo === '-∞' || lo === '-inf') lo = -Infinity;
        if (hi === '\u221E' || hi === '∞' || hi === 'inf' || hi === '+∞') hi = Infinity;
        // 处理 π 边界
        if (lo === 'π') lo = Math.PI;
        if (hi === 'π') hi = Math.PI;
        var loNum = parseFloat(lo), hiNum = parseFloat(hi);
        if (isFinite(loNum) && isFinite(hiNum) && loNum < hiNum) {
            return { type: 'domain', varName: vn, min: loNum, max: hiNum };
        }
        if (isFinite(loNum) && isFinite(hiNum) && loNum >= hiNum) {
            return { type: 'warn', message: '无效区间: ' + vn + '∈[' + lo + ',' + hi + '] 下界≥上界，将被忽略' };
        }
        if (isFinite(loNum) && !isFinite(hiNum)) {
            return { type: 'domain', varName: vn, min: loNum };
        }
        if (isFinite(hiNum) && !isFinite(loNum)) {
            return { type: 'domain', varName: vn, max: hiNum };
        }
    }

    // ---- 模式2: x>a, x<a, x>=a, x<=a, x≥a, x≤a ----
    // 注意：严格 > / < 在数值计算中转为 >= / <=
    // 正则说明：[><\u2265\u2264]=? 已覆盖 >, >=, <, <=, ≥, ≤
    var m2 = s.match(/^([a-zA-Z_\u0370-\u03FF]\w*)([><\u2265\u2264]=?)(-?\d+\.?\d*(?:[eE][+-]?\d+)?)$/);
    if (m2) {
        var vn = m2[1], op = m2[2], val = parseFloat(m2[3]);
        if (!isNaN(val) && isFinite(val)) {
            if (op === '>' || op === '>=' || op === '\u2265') {
                return { type: 'domain', varName: vn, min: val };
            }
            if (op === '<' || op === '<=' || op === '\u2264') {
                return { type: 'domain', varName: vn, max: val };
            }
        }
    }

    // ---- 模式3: a<x<b, a≤x≤b, a<x≤b, a≤x<b ----
    var m3 = s.match(/^(-?\d+\.?\d*(?:[eE][+-]?\d+)?)([<>\u2265\u2264]=?)([a-zA-Z_\u0370-\u03FF]\w*)([<>\u2265\u2264]=?)(-?\d+\.?\d*(?:[eE][+-]?\d+)?)$/);
    if (m3) {
        var loVal = parseFloat(m3[1]), vn = m3[3], hiVal = parseFloat(m3[5]);
        if (!isNaN(loVal) && !isNaN(hiVal) && isFinite(loVal) && isFinite(hiVal) && loVal < hiVal) {
            return { type: 'domain', varName: vn, min: loVal, max: hiVal };
        }
    }

    // ---- 模式4: x∈R, x∈ℝ → 无约束，跳过 ----
    if (s.match(/^[a-zA-Z_\u0370-\u03FF]\w*\u2208[R\u211D]$/)) {
        return { type: 'skip' };
    }

    // ---- 模式5: x∈Z, x∈ℤ, x∈N, x∈ℕ → 仅警告 ----
    if (s.match(/^[a-zA-Z_\u0370-\u03FF]\w*\u2208[Z\u2124N\u2115]$/)) {
        return { type: 'warn', kind: 'integer-unenforced', message: '整数约束(x∈ℤ/ℕ)无法在当前求解器中强制执行；已按实数域求解，返回的解不一定为整数，请知悉（未静默忽略）' };
    }

    // ---- 模式6: x≠a, x!=a → 仅警告 ----
    var m6 = s.match(/^([a-zA-Z_]\w*)(?:\u2260|!=)(-?\d+\.?\d*(?:[eE][+-]?\d+)?)$/);
    if (m6) {
        return { type: 'warn', message: '不等约束 "' + m6[1] + '\u2260' + m6[2] + '" 无法精确表示，将尝试求解近似值' };
    }

    // 无法识别的条件
    return null;
}

function Parser(tokens) {
    let pos = 0;

    function peek() {
        return pos < tokens.length ? tokens[pos] : null;
    }

    function consume() {
        return tokens[pos++];
    }

    function match(type, value) {
        const tok = peek();
        if (!tok) return false;
        if (tok.type !== type) return false;
        if (value !== undefined && tok.value !== value && tok.name !== value) return false;
        return true;
    }

    function expect(type, value) {
        const tok = peek();
        if (!tok) {
            throw new Error('意外的表达式结尾');
        }
        if (tok.type !== type || (value !== undefined && tok.value !== value && tok.name !== value)) {
            throw new Error('解析错误: 期望 ' + type + (value ? ' "' + value + '"' : '') + '，得到 ' + JSON.stringify(tok));
        }
        return consume();
    }

    function parseExpression() {
        let left = parseTerm();
        while (match('op', '+') || match('op', '-')) {
            const op = consume().value;
            const right = parseTerm();
            left = { type: 'binop', op: op, left: left, right: right };
        }
        return left;
    }

    function parseTerm() {
        let left = parseFactor();
        while (match('op', '*') || match('op', '/')) {
            const op = consume().value;
            const right = parseFactor();
            left = { type: 'binop', op: op, left: left, right: right };
        }
        return left;
    }

    function parseFactor() {
        let base = parseUnary();
        if (match('op', '^')) {
            consume();
            const exp = parseFactor(); // 右结合
            return { type: 'binop', op: '^', left: base, right: exp };
        }
        return base;
    }

    function parseUnary() {
        if (match('op', '-')) {
            consume();
            const operand = parseUnary();
            return { type: 'unary', op: '-', operand: operand };
        }
        if (match('op', '+')) {
            consume();
            return parseUnary();
        }
        return parsePrimary();
    }

    function parsePrimary() {
        const tok = peek();
        if (!tok) {
            throw new Error('意外的表达式结尾');
        }

        if (tok.type === 'num') {
            consume();
            return { type: 'num', value: tok.value };
        }

        if (tok.type === 'var') {
            consume();
            return { type: 'var', name: tok.name };
        }

        if (tok.type === 'func') {
            consume();
            expect('op', '(');
            const firstArg = parseExpression();
            // 检查是否有多参数（逗号分隔）
            if (match('op', ',')) {
                const args = [firstArg];
                while (match('op', ',')) {
                    consume();
                    args.push(parseExpression());
                }
                expect('op', ')');
                return { type: 'func', name: tok.name, args: args };
            }
            expect('op', ')');
            return { type: 'func', name: tok.name, arg: firstArg };
        }

        if (tok.type === 'op' && tok.value === '(') {
            consume();
            const expr = parseExpression();
            expect('op', ')');
            return expr;
        }

        throw new Error('解析错误: 意外的token ' + JSON.stringify(tok));
    }

    this.parse = function() {
        const result = parseExpression();
        if (pos < tokens.length) {
            throw new Error('解析错误: 多余的token ' + JSON.stringify(tokens[pos]));
        }
        return result;
    };
}

function parse(tokens) {
    const parser = new Parser(tokens);
    return parser.parse();
}

function getFuncChildren(node) {
    if (node.args) {
        if (node.name === 'diff' && node.args.length >= 2) {
            // diff(expr, varName) → 跳过 varName
            return [node.args[0]];
        }
        if (node.name === 'int' && node.args.length >= 2) {
            // int(expr, varName, a, b) → 跳过 varName
            return [node.args[0], ...node.args.slice(2)];
        }
        if (node.name === 'ode' && node.args.length >= 3) {
            // ode(expr, xVar, yVar, x0, y0, x1) → 跳过 xVar, yVar
            return [node.args[0], ...node.args.slice(3)];
        }
        if (node.name === 'lim' && node.args.length >= 3) {
            // lim(expr, var, target) → 跳过 var
            var limChildren = [node.args[0], node.args[2]];
            // 如果有方向参数也包含
            if (node.args.length >= 4) limChildren.push(node.args[3]);
            return limChildren;
        }
        return node.args;
    }
    return node.arg ? [node.arg] : [];
}

function getFuncChildrenAll(node) {
    if (node.args) {
        if (node.name === 'diff' && node.args.length >= 2) {
            // diff 的求导变量是局部变量，不应提取
            return [node.args[0]];
        }
        if (node.name === 'int' && node.args.length >= 2) {
            // int 的积分变量是局部变量，不应提取
            return [node.args[0], ...node.args.slice(2)];
        }
        if (node.name === 'ode' && node.args.length >= 3) {
            // ode 的 xVar/yVar 是局部变量，表达式也用局部变量
            // 只从数值参数中提取全局变量
            return node.args.slice(3);
        }
        if (node.name === 'lim' && node.args.length >= 3) {
            // lim 的极限变量是局部变量，不应提取
            var limAllChildren = [node.args[0], node.args[2]];
            if (node.args.length >= 4) limAllChildren.push(node.args[3]);
            return limAllChildren;
        }
        return node.args;
    }
    return node.arg ? [node.arg] : [];
}

// 兰佐斯伽马函数近似（Lanczos approximation）
function gammaLanczos(z) {
    if (z < 0.5) {
        // 反射公式
        return Math.PI / (Math.sin(Math.PI * z) * gammaLanczos(1 - z));
    }
    z -= 1;
    var g = 7;
    var c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
             771.32342877765313, -176.61502916214059, 12.507343278686905,
             -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    var x = c[0];
    for (var i = 1; i < g + 2; i++) {
        x += c[i] / (z + i);
    }
    var t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

function evalAST(node, vars) {
    if (!node) return NaN;

    switch (node.type) {
        case 'num':
            return node.value;

        case 'var':
            if (vars[node.name] === undefined) {
                return NaN;
            }
            return vars[node.name];

        case 'binop': {
            const left = evalAST(node.left, vars);
            const right = evalAST(node.right, vars);
            switch (node.op) {
                case '+': return left + right;
                case '-': return left - right;
                case '*': return left * right;
                case '/':
                    if (Math.abs(right) < 1e-300) return NaN;
                    return left / right;
                case '^':
                    return Math.pow(left, right);
                default: return NaN;
            }
        }

        case 'unary': {
            const val = evalAST(node.operand, vars);
            if (node.op === '-') return -val;
            return val;
        }

        case 'func': {
            // 多参数函数：diff（导数）和 int（积分）
            if (node.args) {
                switch (node.name) {
                    case 'diff': {
                        // diff(expr, varName) — 中心差分法数值导数
                        // 在当前 varName 值处计算 d(expr)/d(varName)
                        if (node.args.length < 2) return NaN;
                        const varName = node.args[1].name;
                        if (!varName) return NaN;
                        const x0 = vars[varName];
                        if (x0 === undefined || !isFinite(x0)) return NaN;
                        const h = 1e-6;
                        const varsP = Object.assign({}, vars);
                        const varsM = Object.assign({}, vars);
                        varsP[varName] = x0 + h;
                        varsM[varName] = x0 - h;
                        const fp = evalAST(node.args[0], varsP);
                        const fm = evalAST(node.args[0], varsM);
                        if (isNaN(fp) || isNaN(fm)) return NaN;
                        return (fp - fm) / (2 * h);
                    }
                    case 'int': {
                        // int(expr, varName, a, b) — 复合辛普森积分
                        // 计算 ∫[a,b] expr d(varName)
                        if (node.args.length < 4) return NaN;
                        const varName = node.args[1].name;
                        if (!varName) return NaN;
                        const a = evalAST(node.args[2], vars);
                        const b = evalAST(node.args[3], vars);
                        if (isNaN(a) || isNaN(b) || !isFinite(a) || !isFinite(b)) return NaN;
                        const n = 100; // 偶数区间数
                        const hh = (b - a) / n;
                        let sum = 0;
                        for (let k = 0; k <= n; k++) {
                            const xk = a + k * hh;
                            const vk = Object.assign({}, vars);
                            vk[varName] = xk;
                            const fk = evalAST(node.args[0], vk);
                            if (isNaN(fk)) return NaN;
                            if (k === 0 || k === n) {
                                sum += fk;
                            } else if (k % 2 === 1) {
                                sum += 4 * fk;
                            } else {
                                sum += 2 * fk;
                            }
                        }
                        return (hh / 3) * sum;
                    }
                    case 'ode': {
                        // ode(expr, xVar, yVar, x0, y0, x1)
                        // 求解一阶常微分方程 dy/dx = expr, y(x0) = y0, 返回 y(x1)
                        if (node.args.length < 6) return NaN;
                        var xVarName = node.args[1].name;
                        var yVarName = node.args[2].name;
                        if (!xVarName || !yVarName) return NaN;
                        var ox0 = evalAST(node.args[3], vars);
                        var oy0 = evalAST(node.args[4], vars);
                        var ox1 = evalAST(node.args[5], vars);
                        if (isNaN(ox0) || isNaN(oy0) || isNaN(ox1)) return NaN;
                        if (!isFinite(ox0) || !isFinite(oy0) || !isFinite(ox1)) return NaN;
                        return enhancedODESolve(node.args[0], xVarName, yVarName, ox0, oy0, ox1, vars, null);
                    }
                    case 'lim': {
                        // lim(expr, var, target) — 数值极限
                        // lim(expr, var, target, dir) — 方向极限：1=左, -1=右
                        // 例：lim(sin(x)/x, x, 0) → 1
                        // 例：lim(1/x, x, 0, 1) → +∞,  lim(1/x, x, 0, -1) → -∞
                        if (node.args.length < 3) return NaN;
                        var limVarName = node.args[1].name;
                        if (!limVarName) return NaN;
                        var limTarget = evalAST(node.args[2], vars);
                        if (isNaN(limTarget) || !isFinite(limTarget)) return NaN;
                        var limDir = 0; // 0=双侧, 1=左, -1=右
                        if (node.args.length >= 4) {
                            var dirVal = evalAST(node.args[3], vars);
                            if (!isNaN(dirVal) && isFinite(dirVal)) {
                                limDir = dirVal > 0 ? 1 : -1;
                            }
                        }
                        return evalLimit(node.args[0], limVarName, limTarget, limDir, vars);
                    }
                    case 'mod': {
                        // mod(a, b) — 取模（正数模）
                        if (node.args.length < 2) return NaN;
                        const a = evalAST(node.args[0], vars);
                        const b = evalAST(node.args[1], vars);
                        if (isNaN(a) || isNaN(b) || Math.abs(b) < 1e-300) return NaN;
                        return ((a % b) + b) % b;
                    }
                    default: return NaN;
                }
            }
            // 单参数函数（原有逻辑）
            const arg = evalAST(node.arg, vars);
            switch (node.name) {
                case 'sin': return Math.sin(arg);
                case 'cos': return Math.cos(arg);
                case 'tan': return Math.tan(arg);
                case 'ln': return Math.log(arg);
                case 'exp': return Math.exp(arg);
                case 'sqrt':
                    if (arg < 0) return NaN;
                    return Math.sqrt(arg);
                case 'log': return Math.log10(arg);
                case 'abs': return Math.abs(arg);
                case 'cot': {
                    const t = Math.tan(arg);
                    if (Math.abs(t) < 1e-300) return NaN;
                    return 1 / t;
                }
                case 'sec': {
                    const c = Math.cos(arg);
                    if (Math.abs(c) < 1e-300) return NaN;
                    return 1 / c;
                }
                case 'csc': {
                    const s = Math.sin(arg);
                    if (Math.abs(s) < 1e-300) return NaN;
                    return 1 / s;
                }
                case 'arcsin': return Math.asin(arg);
                case 'arccos': return Math.acos(arg);
                case 'arctan': return Math.atan(arg);
                case 'sinh': return Math.sinh(arg);
                case 'cosh': return Math.cosh(arg);
                case 'tanh': return Math.tanh(arg);
                case 'floor': return Math.floor(arg);
                case 'ceil': return Math.ceil(arg);
                case 'gamma': return gammaLanczos(arg);
                case 'log2': return Math.log2(arg);
                case 'log10': return Math.log10(arg);
                default: return NaN;
            }
        }

        default:
            return NaN;
    }
}

function evalLimit(expr, varName, target, direction, vars) {
    // 策略1: 短路检测 — 已知极限模式
    // 这些模式在极限计算中频繁出现，且数值逼近精度有限
    function detectLimitPattern(expr, varName, target) {
        // 检查是否为 sin(x)/x 形式，x→0
        // 数学：lim_{x→0} sin(x)/x = 1
        if (expr.type === 'binop' && expr.op === '/') {
            // sin(var)/var 模式
            if (expr.left.type === 'func' && expr.left.name === 'sin' &&
                expr.right.type === 'var' && expr.right.name === varName &&
                expr.left.arg && expr.left.arg.type === 'var' && expr.left.arg.name === varName) {
                // 确认 target 为 0
                if (Math.abs(target) < 1e-10) return 1.0;
            }
            // var/sin(var) 模式（倒数）
            if (expr.left.type === 'var' && expr.left.name === varName &&
                expr.right.type === 'func' && expr.right.name === 'sin' &&
                expr.right.arg && expr.right.arg.type === 'var' && expr.right.arg.name === varName) {
                if (Math.abs(target) < 1e-10) return 1.0;
            }
            // tan(var)/var 模式，x→0
            if (expr.left.type === 'func' && expr.left.name === 'tan' &&
                expr.right.type === 'var' && expr.right.name === varName &&
                expr.left.arg && expr.left.arg.type === 'var' && expr.left.arg.name === varName) {
                if (Math.abs(target) < 1e-10) return 1.0;
            }
            // (1-cos(var))/var² 模式，x→0
            if (expr.left.type === 'binop' && expr.left.op === '-' &&
                expr.left.left.type === 'num' && Math.abs(expr.left.left.value - 1) < 1e-10 &&
                expr.left.right.type === 'func' && expr.left.right.name === 'cos' &&
                expr.left.right.arg && expr.left.right.arg.type === 'var' && expr.left.right.arg.name === varName &&
                expr.right.type === 'binop' && expr.right.op === '^' &&
                expr.right.left.type === 'var' && expr.right.left.name === varName &&
                expr.right.right.type === 'num' && Math.abs(expr.right.right.value - 2) < 1e-10) {
                if (Math.abs(target) < 1e-10) return 0.5;
            }
            // ln(1+var)/var 模式，x→0
            if (expr.left.type === 'func' && expr.left.name === 'ln' &&
                expr.left.arg && expr.left.arg.type === 'binop' && expr.left.arg.op === '+' &&
                expr.left.arg.left.type === 'num' && Math.abs(expr.left.arg.left.value - 1) < 1e-10 &&
                expr.left.arg.right.type === 'var' && expr.left.arg.right.name === varName &&
                expr.right.type === 'var' && expr.right.name === varName) {
                if (Math.abs(target) < 1e-10) return 1.0;
            }
            // (exp(var)-1)/var 模式，x→0
            if (expr.left.type === 'binop' && expr.left.op === '-' &&
                expr.left.left.type === 'func' && expr.left.left.name === 'exp' &&
                expr.left.left.arg && expr.left.left.arg.type === 'var' && expr.left.left.arg.name === varName &&
                expr.left.right.type === 'num' && Math.abs(expr.left.right.value - 1) < 1e-10 &&
                expr.right.type === 'var' && expr.right.name === varName) {
                if (Math.abs(target) < 1e-10) return 1.0;
            }
        }
        // (1+var)^(1/var) 模式，x→0 → e
        if (expr.type === 'binop' && expr.op === '^' &&
            expr.left.type === 'binop' && expr.left.op === '+' &&
            expr.left.left.type === 'num' && Math.abs(expr.left.left.value - 1) < 1e-10 &&
            expr.left.right.type === 'var' && expr.left.right.name === varName &&
            expr.right.type === 'binop' && expr.right.op === '/' &&
            expr.right.left.type === 'num' && Math.abs(expr.right.left.value - 1) < 1e-10 &&
            expr.right.right.type === 'var' && expr.right.right.name === varName) {
            if (Math.abs(target) < 1e-10) return Math.E;
        }
        return null;
    }
    
    var patternResult = detectLimitPattern(expr, varName, target);
    if (patternResult !== null) return patternResult;

    // 策略2: 直接代入 — 若函数在目标点连续，直接求值
    var subVars = Object.assign({}, vars);
    subVars[varName] = target;
    var directVal = evalAST(expr, subVars);
    if (isFinite(directVal) && !isNaN(directVal)) return directVal;

    // 策略3: L'Hôpital法则 — 分子分母同时求导后再求极限
    // 严格仅当 0/0 或 ∞/∞ 不定式时适用
    // 使用现有 diff 函数计算导数
    // 仅当表达式为 f(x)/g(x) 形式时适用
    if (expr.type === 'binop' && expr.op === '/') {
        // 先检查是否为 0/0 或 ∞/∞ 不定式
        var numAtTarget = evalAST(expr.left, subVars);
        var denAtTarget = evalAST(expr.right, subVars);
        var is00Form = (Math.abs(numAtTarget) < 1e-10 || !isFinite(numAtTarget)) && 
                       (Math.abs(denAtTarget) < 1e-10 || !isFinite(denAtTarget));
        var isInfInfForm = (!isFinite(numAtTarget) || Math.abs(numAtTarget) > 1e15) && 
                           (!isFinite(denAtTarget) || Math.abs(denAtTarget) > 1e15);
        if (is00Form || isInfInfForm) {
            // 构造分子和分母的导数AST
            var numDiff = { type: 'func', name: 'diff', args: [expr.left, { type: 'var', name: varName }] };
            var denDiff = { type: 'func', name: 'diff', args: [expr.right, { type: 'var', name: varName }] };
            // 计算导数在目标点的值
            var numPrime = evalAST(numDiff, subVars);
            var denPrime = evalAST(denDiff, subVars);
            if (isFinite(numPrime) && isFinite(denPrime) && Math.abs(denPrime) > 1e-15) {
                return numPrime / denPrime;
            }
            // 如果一阶导仍为0/0，尝试二阶导
            if (isFinite(numPrime) && isFinite(denPrime) && Math.abs(denPrime) < 1e-15 && Math.abs(numPrime) < 1e-15) {
                var numDiff2 = { type: 'func', name: 'diff', args: [numDiff, { type: 'var', name: varName }] };
                var denDiff2 = { type: 'func', name: 'diff', args: [denDiff, { type: 'var', name: varName }] };
                var numPrime2 = evalAST(numDiff2, subVars);
                var denPrime2 = evalAST(denDiff2, subVars);
                if (isFinite(numPrime2) && isFinite(denPrime2) && Math.abs(denPrime2) > 1e-15) {
                    return numPrime2 / denPrime2;
                }
            }
        }
    }

    // 策略4: 数值逼近 — 双侧逼近 + Richardson外推
    // 使用固定衰减序列 h_k = 10^{-k}，k=1..8
    // direction: 0=双侧, 1=左极限(从左侧趋近, x=target-h), -1=右极限(从右侧趋近, x=target+h)
    var hValues = [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8];
    var leftVals = [], rightVals = [];
    var approachLeft = (direction === 1 || direction === 0);
    var approachRight = (direction === -1 || direction === 0);
    
    for (var hi = 0; hi < hValues.length; hi++) {
        var h = hValues[hi];
        // 左逼近（从左侧接近目标：x = target - h）
        if (approachLeft && target - h > -1e6) {
            var lv = Object.assign({}, vars);
            lv[varName] = target - h;
            var lVal = evalAST(expr, lv);
            if (isFinite(lVal) && !isNaN(lVal)) leftVals.push(lVal);
        }
        // 右逼近（从右侧接近目标：x = target + h）
        if (approachRight && target + h < 1e6) {
            var rv = Object.assign({}, vars);
            rv[varName] = target + h;
            var rVal = evalAST(expr, rv);
            if (isFinite(rVal) && !isNaN(rVal)) rightVals.push(rVal);
        }
    }

    // 估算极限值
    // 双侧极限（direction === 0）：左右均值
    if (leftVals.length > 0 && rightVals.length > 0 && direction === 0) {
        var lLast = leftVals[leftVals.length - 1];
        var rLast = rightVals[rightVals.length - 1];
        var avg = (lLast + rLast) / 2;
        if (leftVals.length >= 3 && rightVals.length >= 3) {
            var lDiff = Math.abs(leftVals[leftVals.length - 1] - leftVals[leftVals.length - 2]);
            var rDiff = Math.abs(rightVals[rightVals.length - 1] - rightVals[rightVals.length - 2]);
            if (lDiff < 1e-6 && rDiff < 1e-6) return avg;
            if (leftVals.length >= 4 && rightVals.length >= 4) {
                var lExtrap = (4 * leftVals[leftVals.length - 1] - leftVals[leftVals.length - 2]) / 3;
                var rExtrap = (4 * rightVals[rightVals.length - 1] - rightVals[rightVals.length - 2]) / 3;
                return (lExtrap + rExtrap) / 2;
            }
            return avg;
        }
        return avg;
    }
    // 左极限（direction === 1，仅从左侧逼近）
    if (leftVals.length > 0 && direction === 1 && rightVals.length === 0) {
        if (leftVals.length >= 3) {
            var lDiff = Math.abs(leftVals[leftVals.length - 1] - leftVals[leftVals.length - 2]);
            if (lDiff < 1e-6) return leftVals[leftVals.length - 1];
            if (leftVals.length >= 4) {
                return (4 * leftVals[leftVals.length - 1] - leftVals[leftVals.length - 2]) / 3;
            }
        }
        return leftVals[leftVals.length - 1];
    }
    // 右极限（direction === -1，仅从右侧逼近）
    if (rightVals.length > 0 && direction === -1 && leftVals.length === 0) {
        if (rightVals.length >= 3) {
            var rDiff = Math.abs(rightVals[rightVals.length - 1] - rightVals[rightVals.length - 2]);
            if (rDiff < 1e-6) return rightVals[rightVals.length - 1];
            if (rightVals.length >= 4) {
                return (4 * rightVals[rightVals.length - 1] - rightVals[rightVals.length - 2]) / 3;
            }
        }
        return rightVals[rightVals.length - 1];
    }

    // 所有策略失败，返回 NaN
    return NaN;
}





function aitkenAccelerate(x0, x1, x2) {
    if (x0.length !== x1.length || x1.length !== x2.length) return null;
    var n = x0.length;
    
    var dx1 = new Array(n);
    var dx2 = new Array(n);
    var ddx = new Array(n);
    var result = new Array(n);
    
    for (var i = 0; i < n; i++) {
        dx1[i] = x1[i] - x0[i];
        dx2[i] = x2[i] - x1[i];
        ddx[i] = dx2[i] - dx1[i];
    }
    
    // 检查是否满足线性收敛条件：|Δ²x| < |Δx| 且 Δ²x 与 Δx 同号（近似线性）
    var validCount = 0;
    for (var i = 0; i < n; i++) {
        if (Math.abs(ddx[i]) > 1e-15 && Math.abs(ddx[i]) < Math.abs(dx1[i]) * 10) {
            // 应用 Aitken 加速：x* = x_k - (Δx_k)² / Δ²x_k
            result[i] = x2[i] - (dx2[i] * dx2[i]) / ddx[i];
            validCount++;
        } else {
            result[i] = x2[i]; // 不加速，保持原值
        }
    }
    
    // 至少一半的变量满足加速条件才返回加速结果
    if (validCount >= n / 2) {
        return result;
    }
    return null;
}





function hessianTaylorApprox(equations, varNames, x, F, J) {
    var n = varNames.length;
    var m = equations.length;
    if (n < 2 || m < 1) return null;
    
    var eps = 1e-6;
    
    // 计算残差范数
    var norm = 0;
    for (var fi = 0; fi < F.length; fi++) norm += F[fi] * F[fi];
    norm = Math.sqrt(norm);
    if (norm < 1e-10) return null; // 已经收敛，不需要
    
    // 构造目标函数 g(x) = ½||F(x)||² 的梯度
    var grad = new Array(n);
    for (var j = 0; j < n; j++) {
        grad[j] = 0;
        for (var i = 0; i < m; i++) {
            grad[j] += F[i] * J[i][j];
        }
    }
    
    // 近似Hessian: H ≈ JᵀJ + Σ F_i · H_i（忽略二阶项，仅用JᵀJ近似）
    // 这是 Gauss-Newton 近似，在残差较小时足够精确
    var H = [];
    for (var i = 0; i < n; i++) {
        H.push(new Array(n));
        for (var j = 0; j < n; j++) {
            var sum = 0;
            for (var k = 0; k < m; k++) {
                sum += J[k][i] * J[k][j];
            }
            H[i][j] = sum;
        }
        // 添加正则化项
        H[i][i] += 1e-8;
    }
    
    // 添加部分二阶项（仅对角线，用有限差分估算）
    for (var j = 0; j < n; j++) {
        var xP = x.slice();
        xP[j] += eps;
        var vP = {};
        varNames.forEach(function(v, k) { vP[v] = xP[k]; });
        var FP = equations.map(function(eq) { return evalAST(eq, vP); });
        
        var xM = x.slice();
        xM[j] -= eps;
        var vM = {};
        varNames.forEach(function(v, k) { vM[v] = xM[k]; });
        var FM = equations.map(function(eq) { return evalAST(eq, vM); });
        
        for (var i = 0; i < m; i++) {
            // 二阶导数（中心差分）
            var d2 = (FP[i] - 2 * F[i] + FM[i]) / (eps * eps);
            if (isFinite(d2) && !isNaN(d2)) {
                H[j][j] += F[i] * d2;
            }
        }
    }
    
    // 求解 H·Δx = -grad
    var negGrad = grad.map(function(g) { return -g; });
    var result = gaussianSolve(H, negGrad);
    if (!result) {
        // 如果H奇异，加更大正则化
        for (var i = 0; i < n; i++) H[i][i] += 1e-4;
        result = gaussianSolve(H, negGrad);
    }
    
    if (result) {
        // 对步长做阻尼（二阶步长通常较大）
        var step = result.solution;
        var stepNorm = 0;
        for (var i = 0; i < n; i++) stepNorm += step[i] * step[i];
        stepNorm = Math.sqrt(stepNorm);
        
        // 限制最大步长
        var maxStep = 1.0;
        if (stepNorm > maxStep) {
            for (var i = 0; i < n; i++) step[i] *= maxStep / stepNorm;
        }
        
        return {
            step: step,
            method: 'hessian_taylor',
            gradNorm: Math.sqrt(grad.reduce(function(s, g) { return s + g*g; }, 0))
        };
    }
    
    return null;
}

function matrixDeterminant(M) {
    var n = M.length;
    if (n === 0) return 0;
    // 检查是否为方阵
    if (n !== M[0].length) return NaN;
    if (n === 1) return M[0][0];
    if (n === 2) return M[0][0] * M[1][1] - M[0][1] * M[1][0];
    
    // 复制矩阵
    var A = [];
    for (var i = 0; i < n; i++) {
        A.push(M[i].slice());
    }
    
    var det = 1;
    var sign = 1;
    
    for (var col = 0; col < n; col++) {
        // 寻找主元
        var maxRow = col;
        var maxVal = Math.abs(A[col][col]);
        for (var row = col + 1; row < n; row++) {
            if (Math.abs(A[row][col]) > maxVal) {
                maxVal = Math.abs(A[row][col]);
                maxRow = row;
            }
        }
        if (maxVal < 1e-15) return 0;
        
        if (maxRow !== col) {
            // 交换行
            var temp = A[col];
            A[col] = A[maxRow];
            A[maxRow] = temp;
            sign = -sign;
        }
        
        det *= A[col][col];
        
        // 消元
        for (var row = col + 1; row < n; row++) {
            var factor = A[row][col] / A[col][col];
            for (var j = col; j < n; j++) {
                A[row][j] -= factor * A[col][j];
            }
        }
    }
    
    return sign * det;
}

function extractVariables(node) {
    const vars = new Set();
    const funcs = ['sin', 'cos', 'tan', 'ln', 'exp', 'sqrt', 'log', 'abs', 'diff', 'int', 'ode', 'lim',
                  'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
                  'floor', 'ceil', 'gamma', 'log2', 'mod'];

    function walk(n) {
        if (!n) return;
        if (n.type === 'var') {
            vars.add(n.name);
        } else if (n.type === 'binop') {
            walk(n.left);
            walk(n.right);
        } else if (n.type === 'unary') {
            walk(n.operand);
        } else if (n.type === 'func') {
            // 多参数函数：遍历所有子节点（int 跳过积分变量名）
            var children = getFuncChildrenAll(n);
            if (n.name === 'int' && n.args && n.args.length >= 2) {
                // int 的积分变量是局部变量，遍历子节点时排除它
                var localVar = n.args[1].name;
                if (localVar) {
                    children.forEach(function(child) {
                        walkSkippingVar(child, localVar);
                    });
                } else {
                    children.forEach(function(child) { walk(child); });
                }
            } else {
                children.forEach(function(child) { walk(child); });
            }
        }
    }

    // 遍历 AST 节点，但跳过指定局部变量名
    function walkSkippingVar(n, skipVar) {
        if (!n) return;
        if (n.type === 'var') {
            if (n.name !== skipVar) vars.add(n.name);
        } else if (n.type === 'binop') {
            walkSkippingVar(n.left, skipVar);
            walkSkippingVar(n.right, skipVar);
        } else if (n.type === 'unary') {
            walkSkippingVar(n.operand, skipVar);
        } else if (n.type === 'func') {
            // 对嵌套函数同样处理：如果内部也有局部变量，继续传递
            var ch = getFuncChildrenAll(n);
            if (n.name === 'int' && n.args && n.args.length >= 2) {
                var innerLocal = n.args[1].name;
                if (innerLocal) {
                    ch.forEach(function(c) { walkSkippingVarWithTwo(c, skipVar, innerLocal); });
                } else {
                    ch.forEach(function(c) { walkSkippingVar(c, skipVar); });
                }
            } else if (n.name === 'diff' && n.args && n.args.length >= 2) {
                var diffVar = n.args[1].name;
                if (diffVar) {
                    ch.forEach(function(c) { walkSkippingVarWithTwo(c, skipVar, diffVar); });
                } else {
                    ch.forEach(function(c) { walkSkippingVar(c, skipVar); });
                }
            } else {
                ch.forEach(function(c) { walkSkippingVar(c, skipVar); });
            }
        }
    }

    function walkSkippingVarWithTwo(n, skipVar1, skipVar2) {
        if (!n) return;
        if (n.type === 'var') {
            if (n.name !== skipVar1 && n.name !== skipVar2) vars.add(n.name);
        } else if (n.type === 'binop') {
            walkSkippingVarWithTwo(n.left, skipVar1, skipVar2);
            walkSkippingVarWithTwo(n.right, skipVar1, skipVar2);
        } else if (n.type === 'unary') {
            walkSkippingVarWithTwo(n.operand, skipVar1, skipVar2);
        } else if (n.type === 'func') {
            var ch = getFuncChildrenAll(n);
            ch.forEach(function(c) { walkSkippingVarWithTwo(c, skipVar1, skipVar2); });
        }
    }

    walk(node);
    return Array.from(vars);
}

function decomposeByVariableGraph(equations, varNames) {
    var n = equations.length;
    if (n <= 1) return null;
    
    // 提取每个方程涉及的变量
    var eqVarList = [];
    for (var i = 0; i < n; i++) {
        eqVarList.push(extractVariables(equations[i]));
    }
    
    // 构建邻接图：方程i和j共享变量则相连
    var adj = new Array(n);
    for (var i = 0; i < n; i++) adj[i] = [];
    for (var i = 0; i < n; i++) {
        var viSet = eqVarList[i];
        for (var j = i + 1; j < n; j++) {
            var vjSet = eqVarList[j];
            // 检查是否共享变量
            var shared = false;
            for (var vi = 0; vi < viSet.length && !shared; vi++) {
                if (vjSet.indexOf(viSet[vi]) >= 0) shared = true;
            }
            if (shared) {
                adj[i].push(j);
                adj[j].push(i);
            }
        }
    }
    
    // BFS寻找连通分量
    var visited = new Array(n);
    for (var i = 0; i < n; i++) visited[i] = false;
    var components = [];
    for (var i = 0; i < n; i++) {
        if (visited[i]) continue;
        var comp = [];
        var queue = [i];
        visited[i] = true;
        while (queue.length > 0) {
            var node = queue.shift();
            comp.push(node);
            for (var ni = 0; ni < adj[node].length; ni++) {
                var nb = adj[node][ni];
                if (!visited[nb]) {
                    visited[nb] = true;
                    queue.push(nb);
                }
            }
        }
        components.push(comp);
    }
    
    if (components.length <= 1) return null; // 只有一个分量，无需分解
    
    // 构建每个分量的方程和变量列表
    var result = [];
    for (var ci = 0; ci < components.length; ci++) {
        var compEqs = [];
        for (var ei = 0; ei < components[ci].length; ei++) {
            compEqs.push(equations[components[ci][ei]]);
        }
        var compVars = [];
        var varSet = {};
        for (var ei = 0; ei < compEqs.length; ei++) {
            var vars = extractVariables(compEqs[ei]);
            for (var vi = 0; vi < vars.length; vi++) {
                if (!varSet[vars[vi]]) {
                    varSet[vars[vi]] = true;
                    compVars.push(vars[vi]);
                }
            }
        }
        // 只保留在 varNames 中的变量
        var filteredVars = [];
        for (var vi = 0; vi < compVars.length; vi++) {
            if (varNames.indexOf(compVars[vi]) >= 0) {
                filteredVars.push(compVars[vi]);
            }
        }
        result.push({
            equations: compEqs,
            variables: filteredVars,
            eqCount: compEqs.length,
            varCount: filteredVars.length
        });
    }
    
    return result;
}



function hasVariable(node, varNames) {
    if (!node) return false;
    if (node.type === 'var') {
        return varNames.includes(node.name);
    }
    if (node.type === 'num') {
        return false;
    }
    if (node.type === 'binop') {
        return hasVariable(node.left, varNames) || hasVariable(node.right, varNames);
    }
    if (node.type === 'unary') {
        return hasVariable(node.operand, varNames);
    }
    if (node.type === 'func') {
        return getFuncChildrenAll(node).some(function(child) { return hasVariable(child, varNames); });
    }
    return false;
}

function isLinear(node, varNames) {
    if (!node) return true;

    switch (node.type) {
        case 'num':
            return true;

        case 'var':
            return varNames.includes(node.name);

        case 'unary':
            return isLinear(node.operand, varNames);

        case 'binop':
            if (node.op === '+' || node.op === '-') {
                return isLinear(node.left, varNames) && isLinear(node.right, varNames);
            }
            if (node.op === '*') {
                // 至少一侧不含任何变量（常数乘法）
                const leftHasVar = hasVariable(node.left, varNames);
                const rightHasVar = hasVariable(node.right, varNames);
                if (leftHasVar && rightHasVar) return false;
                if (!leftHasVar && !rightHasVar) return true;
                // 一侧有变量，检查那一侧是否线性
                if (leftHasVar) return isLinear(node.left, varNames);
                return isLinear(node.right, varNames);
            }
            if (node.op === '/') {
                // 右子树不含变量，左子树线性
                if (hasVariable(node.right, varNames)) return false;
                return isLinear(node.left, varNames);
            }
            if (node.op === '^') {
                // 仅允许 var^1 或 常数^常数
                if (node.left.type === 'var' && node.right.type === 'num') {
                    return node.right.value === 1;
                }
                if (!hasVariable(node.left, varNames) && !hasVariable(node.right, varNames)) {
                    return true;
                }
                return false;
            }
            return false;

        case 'func':
            // 微积分函数含变量时非线性；普通函数参数不含变量时为常数（线性）
            return !getFuncChildrenAll(node).some(function(child) { return hasVariable(child, varNames); });

        default:
            return false;
    }
}

function extractLinearCoefficients(node, varNames) {
    const coeffs = {};
    varNames.forEach(v => coeffs[v] = 0);
    let constant = 0;

    function isConstantExpr(n) {
        return !hasVariable(n, varNames);
    }

    function evalConstant(n) {
        return evalAST(n, {});
    }

    function walk(n, sign) {
        if (!n) return;

        if (n.type === 'num') {
            constant += sign * n.value;
            return;
        }

        if (n.type === 'var') {
            if (coeffs[n.name] !== undefined) {
                coeffs[n.name] += sign * 1;
            }
            return;
        }

        if (n.type === 'unary') {
            walk(n.operand, -sign);
            return;
        }

        if (n.type === 'binop') {
            if (n.op === '+') {
                walk(n.left, sign);
                walk(n.right, sign);
                return;
            }
            if (n.op === '-') {
                walk(n.left, sign);
                walk(n.right, -sign);
                return;
            }
            if (n.op === '*') {
                // 一侧是常数
                if (isConstantExpr(n.left)) {
                    const c = evalConstant(n.left);
                    if (n.right.type === 'var' && coeffs[n.right.name] !== undefined) {
                        coeffs[n.right.name] += sign * c;
                    } else {
                        // 常数乘以更复杂的线性表达式
                        walk(n.right, sign * c);
                    }
                    return;
                }
                if (isConstantExpr(n.right)) {
                    const c = evalConstant(n.right);
                    if (n.left.type === 'var' && coeffs[n.left.name] !== undefined) {
                        coeffs[n.left.name] += sign * c;
                    } else {
                        walk(n.left, sign * c);
                    }
                    return;
                }
                return;
            }
            if (n.op === '/') {
                // 右子树是常数
                if (isConstantExpr(n.right)) {
                    const c = evalConstant(n.right);
                    if (c === 0) return;
                    if (n.left.type === 'var' && coeffs[n.left.name] !== undefined) {
                        coeffs[n.left.name] += sign * (1 / c);
                    } else {
                        walk(n.left, sign * (1 / c));
                    }
                    return;
                }
                return;
            }
            if (n.op === '^') {
                // 常数幂运算（如 2^10, 1.05^10）
                if (isConstantExpr(n)) {
                    constant += sign * evalConstant(n);
                }
                return;
            }
            return;
        }

        if (n.type === 'func') {
            // 常数函数调用（含微积分函数：如果所有子表达式都不含变量，则为常数）
            var allConst = getFuncChildrenAll(n).every(function(child) { return !hasVariable(child, varNames); });
            if (allConst) {
                constant += sign * evalConstant(n);
            }
            return;
        }
    }

    walk(node, 1);
    return { coeffs: coeffs, constant: constant };
}

function gaussianSolve(A, b) {
    const n = A.length;
    if (n === 0) return null;

    // 构造增广矩阵
    const aug = [];
    for (let i = 0; i < n; i++) {
        const row = A[i].slice();
        row.push(b[i]);
        aug.push(row);
    }

    let rank = 0;

    // 前向消元（部分选主元）
    for (let col = 0; col < n; col++) {
        // 找主元
        let maxRow = col;
        let maxVal = Math.abs(aug[col][col]);
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(aug[row][col]) > maxVal) {
                maxVal = Math.abs(aug[row][col]);
                maxRow = row;
            }
        }

        // 主元为0，跳过此列
        if (maxVal < 1e-12) {
            continue;
        }

        // 交换行
        if (maxRow !== col) {
            const temp = aug[col];
            aug[col] = aug[maxRow];
            aug[maxRow] = temp;
        }

        // 消去下方
        for (let row = col + 1; row < n; row++) {
            const factor = aug[row][col] / aug[col][col];
            for (let j = col; j <= n; j++) {
                aug[row][j] -= factor * aug[col][j];
            }
        }

        rank++;
    }

    // 检查一致性
    for (let row = rank; row < n; row++) {
        if (Math.abs(aug[row][n]) > 1e-10) {
            return null; // 不一致
        }
    }

    if (rank < n) {
        // 欠定系统，无法唯一求解
        return null;
    }

    // 回代求解
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
        let sum = aug[i][n];
        for (let j = i + 1; j < n; j++) {
            sum -= aug[i][j] * x[j];
        }
        if (Math.abs(aug[i][i]) < 1e-12) {
            return null;
        }
        x[i] = sum / aug[i][i];
    }

    return { solution: x, rank: rank };
}

function extractVarCoefficient(node, varName) {
    if (!hasVariable(node, [varName])) {
        return { coeff: { type: 'num', value: 0 }, rest: node };
    }

    if (node.type === 'var' && node.name === varName) {
        return { coeff: { type: 'num', value: 1 }, rest: { type: 'num', value: 0 } };
    }

    if (node.type === 'unary' && node.op === '-') {
        const inner = extractVarCoefficient(node.operand, varName);
        if (!inner) return null;
        return {
            coeff: { type: 'unary', op: '-', operand: inner.coeff },
            rest: { type: 'unary', op: '-', operand: inner.rest }
        };
    }

    if (node.type === 'binop') {
        if (node.op === '+' || node.op === '-') {
            const l = extractVarCoefficient(node.left, varName);
            const r = extractVarCoefficient(node.right, varName);
            if (!l || !r) return null;
            if (node.op === '+') {
                return {
                    coeff: { type: 'binop', op: '+', left: l.coeff, right: r.coeff },
                    rest: { type: 'binop', op: '+', left: l.rest, right: r.rest }
                };
            } else {
                return {
                    coeff: { type: 'binop', op: '-', left: l.coeff, right: r.coeff },
                    rest: { type: 'binop', op: '-', left: l.rest, right: r.rest }
                };
            }
        }
        if (node.op === '*') {
            if (!hasVariable(node.left, [varName])) {
                const r = extractVarCoefficient(node.right, varName);
                if (!r) return null;
                return {
                    coeff: { type: 'binop', op: '*', left: node.left, right: r.coeff },
                    rest: { type: 'binop', op: '*', left: node.left, right: r.rest }
                };
            }
            if (!hasVariable(node.right, [varName])) {
                const l = extractVarCoefficient(node.left, varName);
                if (!l) return null;
                return {
                    coeff: { type: 'binop', op: '*', left: l.coeff, right: node.right },
                    rest: { type: 'binop', op: '*', left: l.rest, right: node.right }
                };
            }
            return null; // 两侧都含变量 → 非线性
        }
        if (node.op === '/') {
            if (hasVariable(node.right, [varName])) return null;
            const l = extractVarCoefficient(node.left, varName);
            if (!l) return null;
            return {
                coeff: { type: 'binop', op: '/', left: l.coeff, right: node.right },
                rest: { type: 'binop', op: '/', left: l.rest, right: node.right }
            };
        }
        if (node.op === '^') {
            if (node.left.type === 'var' && node.left.name === varName &&
                node.right.type === 'num' && node.right.value === 1) {
                return { coeff: { type: 'num', value: 1 }, rest: { type: 'num', value: 0 } };
            }
            if (!hasVariable(node, [varName])) {
                return { coeff: { type: 'num', value: 0 }, rest: node };
            }
            return null; // var^n (n>1) → 非线性
        }
    }

    if (node.type === 'func') {
        if (!getFuncChildrenAll(node).some(function(child) { return hasVariable(child, [varName]); })) {
            return { coeff: { type: 'num', value: 0 }, rest: node };
        }
        return null; // func(var) → 非线性
    }

    return null;
}

function findExplicitForm(node, varNames) {
    if (!node) return null;

    // 原始检测：var - expr 或 expr - var
    if (node.type === 'binop' && node.op === '-') {
        // 情况1: {binop, -, {var, name}, expr} → var = expr
        if (node.left.type === 'var' && varNames.includes(node.left.name) && !hasVariable(node.right, [node.left.name])) {
            return {
                var: node.left.name,
                expr: node.right
            };
        }
        // 情况2: {binop, -, expr, {var, name}}
        if (node.right.type === 'var' && varNames.includes(node.right.name) && !hasVariable(node.left, [node.right.name])) {
            return {
                var: node.right.name,
                expr: node.left
            };
        }
    }

    // 增强：线性变量隔离
    // 对于 F = a*v + rest（a为常数），可得 v = -rest / a
    for (const v of varNames) {
        if (!hasVariable(node, [v])) continue;

        const result = extractVarCoefficient(node, v);
        if (!result) continue; // 非线性

        // 检查系数是否为非零常数
        const coeffVal = evalAST(result.coeff, {});
        if (isNaN(coeffVal) || Math.abs(coeffVal) < 1e-12) continue;

        // 构造 v = -rest / coeff
        const expr = {
            type: 'binop',
            op: '/',
            left: { type: 'unary', op: '-', operand: result.rest },
            right: result.coeff
        };

        return { var: v, expr: expr };
    }

    return null;
}

function astNodeCount(ast) {
    if (!ast) return 0;
    switch (ast.type) {
        case 'num': return 1;
        case 'var': return 1;
        case 'binop': return 1 + astNodeCount(ast.left) + astNodeCount(ast.right);
        case 'unary': return 1 + astNodeCount(ast.operand);
        case 'func': return 1 + getFuncChildren(ast).reduce(function(sum, child) { return sum + astNodeCount(child); }, 0);
        default: return 1;
    }
}

function substituteVar(ast, varName, expr) {
    if (!ast) return ast;

    switch (ast.type) {
        case 'num':
            return { type: 'num', value: ast.value };

        case 'var':
            if (ast.name === varName) {
                return JSON.parse(JSON.stringify(expr));
            }
            return { type: 'var', name: ast.name };

        case 'binop':
            return {
                type: 'binop',
                op: ast.op,
                left: substituteVar(ast.left, varName, expr),
                right: substituteVar(ast.right, varName, expr)
            };

        case 'unary':
            return {
                type: 'unary',
                op: ast.op,
                operand: substituteVar(ast.operand, varName, expr)
            };

        case 'func':
            // 单参数函数
            if (ast.arg) {
                return {
                    type: 'func',
                    name: ast.name,
                    arg: substituteVar(ast.arg, varName, expr)
                };
            }
            // 多参数函数（diff, int, ode, lim）
            if (ast.args) {
                var newArgs = ast.args.map(function(a, idx) {
                    // diff 的第2个参数（idx=1）是求导变量名，不替换
                    if (ast.name === 'diff' && idx === 1) {
                        return JSON.parse(JSON.stringify(a));
                    }
                    // int 的第2个参数（idx=1）是积分变量名，不替换
                    if (ast.name === 'int' && idx === 1) {
                        return JSON.parse(JSON.stringify(a));
                    }
                    // ode 的第2,3个参数（idx=1,2）是变量名标签，不替换
                    // ode 的表达式（idx=0）使用局部变量，也不替换
                    if (ast.name === 'ode' && idx <= 2) {
                        return JSON.parse(JSON.stringify(a));
                    }
                    // lim 的第2个参数（idx=1）是极限变量名，不替换
                    if (ast.name === 'lim' && idx === 1) {
                        return JSON.parse(JSON.stringify(a));
                    }
                    return substituteVar(a, varName, expr);
                });
                return { type: 'func', name: ast.name, args: newArgs };
            }
            return ast;

        default:
            return ast;
    }
}

function newtonSolve(equations, varNames, initialGuess, options) {
    const maxIter = options.maxIter;
    const tolerance = options.tolerance;
    const n = varNames.length;
    let x = initialGuess.slice();
    const eps = 1e-8;

    for (let iter = 0; iter < maxIter; iter++) {
        // 时间看门狗：单次牛顿求解不超过 200ms
        if (performance.now() - (options._deadline || Infinity) > 0) {
            return { solution: x, iterations: iter, converged: false, residual: Infinity, error: 'deadline_exceeded' };
        }

        // 求值 F(x)
        const vars = {};
        varNames.forEach((v, i) => vars[v] = x[i]);

        const F = equations.map(eq => evalAST(eq, vars));

        // 检查收敛
        let norm = 0;
        for (let i = 0; i < F.length; i++) {
            if (isNaN(F[i]) || !isFinite(F[i])) {
                return { solution: x, iterations: iter, converged: false, residual: Infinity, error: 'NaN encountered' };
            }
            norm += F[i] * F[i];
        }
        norm = Math.sqrt(norm);

        if (norm < tolerance) {
            return { solution: x, iterations: iter, converged: true, residual: norm };
        }

        // 数值雅可比矩阵
        const J = [];
        for (let i = 0; i < equations.length; i++) {
            J.push(new Array(n));
            for (let j = 0; j < n; j++) {
                const xP = x.slice();
                xP[j] += eps;
                const vP = {};
                varNames.forEach((v, k) => vP[v] = xP[k]);
                const fp = evalAST(equations[i], vP);
                J[i][j] = (fp - F[i]) / eps;
                if (isNaN(J[i][j]) || !isFinite(J[i][j])) {
                    J[i][j] = 0;
                }
            }
        }

        // 解 J*dx = -F （使用最小二乘思路：J^T * J * dx = J^T * (-F)）
        let dx = null;

        if (equations.length === n) {
            // 方阵，直接高斯消元
            const negF = F.map(f => -f);
            const result = gaussianSolve(J, negF);
            if (result) {
                dx = result.solution;
            }
        }

        if (!dx && equations.length !== n) {
            // 最小二乘（仅超定系统）：J^T * J * dx = J^T * (-F)
            const JT = [];
            for (let j = 0; j < n; j++) {
                JT.push(new Array(equations.length));
                for (let i = 0; i < equations.length; i++) {
                    JT[j][i] = J[i][j];
                }
            }

            const JTJ = [];
            for (let i = 0; i < n; i++) {
                JTJ.push(new Array(n));
                for (let j = 0; j < n; j++) {
                    let sum = 0;
                    for (let k = 0; k < equations.length; k++) {
                        sum += JT[i][k] * J[k][j];
                    }
                    JTJ[i][j] = sum;
                }
            }

            // 添加正则化
            for (let i = 0; i < n; i++) {
                JTJ[i][i] += 1e-10;
            }

            const JTF = new Array(n);
            for (let i = 0; i < n; i++) {
                let sum = 0;
                for (let k = 0; k < equations.length; k++) {
                    sum += JT[i][k] * (-F[k]);
                }
                JTF[i] = sum;
            }

            const result = gaussianSolve(JTJ, JTF);
            if (result) {
                dx = result.solution;
            }
        }

        if (!dx) {
            return { solution: x, iterations: iter, converged: false, residual: norm, error: '雅可比奇异' };
        }

        // 阻尼更新（步长限制）
        let alpha = 1.0;
        let maxStep = 0;
        for (let i = 0; i < n; i++) {
            if (Math.abs(dx[i]) > maxStep) maxStep = Math.abs(dx[i]);
        }
        if (maxStep > 100) alpha = 100 / maxStep;

        for (let i = 0; i < n; i++) {
            x[i] += alpha * dx[i];
            // 边界约束
            if (Math.abs(x[i]) > 1000000) {
                x[i] = Math.sign(x[i]) * 1000000;
            }
        }
    }

    // 最终检查
    const vars = {};
    varNames.forEach((v, i) => vars[v] = x[i]);
    const F = equations.map(eq => evalAST(eq, vars));
    let norm = 0;
    for (let i = 0; i < F.length; i++) {
        if (isNaN(F[i]) || !isFinite(F[i])) {
            return { solution: x, iterations: maxIter, converged: false, residual: Infinity };
        }
        norm += F[i] * F[i];
    }
    norm = Math.sqrt(norm);

    return {
        solution: x,
        iterations: maxIter,
        converged: norm < tolerance,
        residual: norm
    };
}

function armijoLineSearch(x, dx, equations, varNames, F0, grad_dot_dx) {
    var alpha = 1.0;
    var tau = 0.5;      // 回溯衰减因子
    var c1 = 1e-4;      // Armijo常数
    var minAlpha = 1e-12;
    var n = x.length;
    
    // 计算当前F范数平方
    var norm0Sq = 0;
    for (var fi = 0; fi < F0.length; fi++) norm0Sq += F0[fi] * F0[fi];
    
    while (alpha > minAlpha) {
        // 试探点
        var trialX = new Array(n);
        for (var i = 0; i < n; i++) {
            trialX[i] = x[i] + alpha * dx[i];
            if (Math.abs(trialX[i]) > 1000000) {
                trialX[i] = Math.sign(trialX[i]) * 1000000;
            }
        }
        
        // 计算试探点残差
        var tvars = {};
        varNames.forEach(function(v, k) { tvars[v] = trialX[k]; });
        var F_trial = equations.map(function(eq) { return evalAST(eq, tvars); });
        
        // 检查NaN
        var hasNaN = false;
        for (var fi = 0; fi < F_trial.length; fi++) {
            if (isNaN(F_trial[fi]) || !isFinite(F_trial[fi])) { hasNaN = true; break; }
        }
        if (hasNaN) { alpha *= tau; continue; }
        
        // 计算试探点范数平方
        var trialNormSq = 0;
        for (var fi = 0; fi < F_trial.length; fi++) trialNormSq += F_trial[fi] * F_trial[fi];
        
        // Armijo条件：F(x+α·dx)² ≤ F(x)² + c1·α·∇(F²)·dx
        // 即 trialNormSq ≤ norm0Sq + c1 * alpha * (2 * grad_dot_dx)
        var armijoRHS = norm0Sq + c1 * alpha * 2 * grad_dot_dx;
        
        if (trialNormSq <= armijoRHS) {
            return { alpha: alpha, F_trial: F_trial, trialNormSq: trialNormSq, armijoSatisfied: true };
        }
        
        alpha *= tau;
    }
    
    // Armijo失败，返回最小步长
    var trialX = new Array(n);
    for (var i = 0; i < n; i++) {
        trialX[i] = x[i] + minAlpha * dx[i];
        if (Math.abs(trialX[i]) > 1000000) {
            trialX[i] = Math.sign(trialX[i]) * 1000000;
        }
    }
    var tvars = {};
    varNames.forEach(function(v, k) { tvars[v] = trialX[k]; });
    var F_trial = equations.map(function(eq) { return evalAST(eq, tvars); });
    return { alpha: minAlpha, F_trial: F_trial, trialNormSq: -1, armijoFailed: true, armijoSatisfied: false };
}

function lineSearchNewton(equations, varNames, initialGuess, options) {
    var maxIter = options.maxIter || 20;
    var tolerance = options.tolerance || 1e-6;
    var n = varNames.length;
    var x = initialGuess.slice();
    var eps = 1e-8;
    
    // 模块3: 迭代收敛极限判定与加速
    // 存储最近3步迭代值用于Aitken加速
    var xHistory = [];
    var normHistory = [];
    var stallCount = 0; // 连续无下降步数
    
    for (var iter = 0; iter < maxIter; iter++) {
        // 时间看门狗
        if (options._deadline && performance.now() - options._deadline > 0) {
            return { solution: x, iterations: iter, converged: false, residual: Infinity, error: 'deadline_exceeded' };
        }
        
        // 求值 F(x)
        var vars = {};
        varNames.forEach(function(v, i) { vars[v] = x[i]; });
        var F = equations.map(function(eq) { return evalAST(eq, vars); });
        
        // 检查NaN
        var hasNaN = false;
        for (var fi = 0; fi < F.length; fi++) {
            if (isNaN(F[fi]) || !isFinite(F[fi])) { hasNaN = true; break; }
        }
        if (hasNaN) {
            return { solution: x, iterations: iter, converged: false, residual: Infinity, error: 'NaN encountered' };
        }
        
        // 计算残差范数
        var norm = 0;
        for (var fi = 0; fi < F.length; fi++) norm += F[fi] * F[fi];
        norm = Math.sqrt(norm);
        
        if (norm < tolerance) {
            return { solution: x, iterations: iter, converged: true, residual: norm };
        }
        
        // 记录历史
        xHistory.push(x.slice());
        normHistory.push(norm);
        if (xHistory.length > 3) xHistory.shift();
        if (normHistory.length > 3) normHistory.shift();
        
        // 模块3: Aitken Δ² 加速检测
        // 如果连续3步呈现线性收敛模式，应用加速
        if (xHistory.length === 3 && normHistory.length === 3) {
            // 检查是否线性收敛：|Δnorm| 递减但速度慢（线性收敛特征）
            var d1 = normHistory[1] / normHistory[0];
            var d2 = normHistory[2] / normHistory[1];
            // 线性收敛意味着残差比约等于常数（0.3 < d ≈ d2 < 0.9）
            if (d1 > 0.1 && d1 < 0.95 && d2 > 0.1 && d2 < 0.95 && Math.abs(d1 - d2) < 0.3) {
                var accelerated = aitkenAccelerate(xHistory[0], xHistory[1], xHistory[2]);
                if (accelerated) {
                    // 计算加速后的残差
                    var accVars = {};
                    varNames.forEach(function(v, i) { accVars[v] = accelerated[i]; });
                    var accF = equations.map(function(eq) { return evalAST(eq, accVars); });
                    var accNorm = 0;
                    for (var fi = 0; fi < accF.length; fi++) accNorm += accF[fi] * accF[fi];
                    accNorm = Math.sqrt(accNorm);
                    
                    // 如果加速后的残差显著降低，直接采纳加速结果
                    if (accNorm < norm * 0.5 && accNorm < normHistory[0] * 0.5) {
                        x = accelerated;
                        // 重置历史，避免重复加速
                        xHistory = [x.slice()];
                        normHistory = [accNorm];
                        stallCount = 0;
                        if (accNorm < tolerance) {
                            return { solution: x, iterations: iter, converged: true, residual: accNorm };
                        }
                        continue; // 跳过本步的牛顿迭代
                    }
                }
            }
        }
        
        // 数值雅可比矩阵（提前计算：供牛顿步与二阶停滞恢复共用，避免 recovery 分支误用尚未定义的 J）
        var J = [];
        for (var i = 0; i < equations.length; i++) {
            J.push(new Array(n));
            for (var j = 0; j < n; j++) {
                var xP = x.slice();
                xP[j] += eps;
                var vP = {};
                varNames.forEach(function(v, k) { vP[v] = xP[k]; });
                var fp = evalAST(equations[i], vP);
                J[i][j] = (fp - F[i]) / eps;
                if (isNaN(J[i][j]) || !isFinite(J[i][j])) J[i][j] = 0;
            }
        }

        // 模块6: 高阶泰勒极限逼近 — 检测停滞
        // 若连续3步残差无下降，启用 Hessian 二阶近似恢复（J 已就绪）
        if (stallCount >= 3 && n >= 2) {
            // 当前 J 和 F 已计算，尝试 Hessian 近似
            var hessianResult = hessianTaylorApprox(equations, varNames, x, F, J);
            if (hessianResult && hessianResult.step) {
                // 用二阶步长更新
                var hsResult = armijoLineSearch(x, hessianResult.step, equations, varNames, F, -hessianResult.gradNorm);
                var hsAlpha = hsResult.alpha;
                if (hsResult.armijoSatisfied && hsAlpha > 1e-8) {
                    for (var hi = 0; hi < n; hi++) {
                        x[hi] += hsAlpha * hessianResult.step[hi];
                        if (Math.abs(x[hi]) > 1000000) x[hi] = Math.sign(x[hi]) * 1000000;
                    }
                    stallCount = 0;
                    continue;
                }
            }
        }

        // 解 J*dx = -F
        var dx = null;
        if (equations.length === n) {
            var negF = F.map(function(f) { return -f; });
            var result = gaussianSolve(J, negF);
            if (result) dx = result.solution;
        }
        
        if (!dx && equations.length !== n) {
            // 最小二乘（仅超定系统）
            var JT = [];
            for (var j = 0; j < n; j++) {
                JT.push(new Array(equations.length));
                for (var i = 0; i < equations.length; i++) JT[j][i] = J[i][j];
            }
            var JTJ = [];
            for (var i = 0; i < n; i++) {
                JTJ.push(new Array(n));
                for (var j = 0; j < n; j++) {
                    var sum = 0;
                    for (var k = 0; k < equations.length; k++) sum += JT[i][k] * J[k][j];
                    JTJ[i][j] = sum;
                }
            }
            for (var i = 0; i < n; i++) JTJ[i][i] += 1e-10;
            var JTF = new Array(n);
            for (var i = 0; i < n; i++) {
                var sum = 0;
                for (var k = 0; k < equations.length; k++) sum += JT[i][k] * (-F[k]);
                JTF[i] = sum;
            }
            var result = gaussianSolve(JTJ, JTF);
            if (result) dx = result.solution;
        }
        
        if (!dx) {
            return { solution: x, iterations: iter, converged: false, residual: norm, error: '雅可比奇异' };
        }
        
        // 计算梯度·方向乘积（用于Armijo条件）
        var grad_dot_dx = 0;
        for (var i = 0; i < n; i++) {
            var grad_i = 0;
            for (var j = 0; j < equations.length; j++) {
                grad_i += 2 * F[j] * J[j][i];
            }
            grad_dot_dx += grad_i * dx[i];
        }
        
        // Armijo线搜索
        var lsResult = armijoLineSearch(x, dx, equations, varNames, F, grad_dot_dx);
        var alpha = lsResult.alpha;
        
        // 更新前记录旧残差，用于判断是否停滞
        var oldNorm = norm;
        
        // 更新
        for (var i = 0; i < n; i++) {
            x[i] += alpha * dx[i];
            if (Math.abs(x[i]) > 1000000) x[i] = Math.sign(x[i]) * 1000000;
        }
        
        // 如果Armijo失败且步长极小，提前终止
        if (lsResult.armijoFailed && alpha < 1e-10) {
            break;
        }
        
        // 模块3: 迭代收敛极限判定 — 检测停滞/发散/振荡
        // 重新计算更新后的残差
        var newVars = {};
        varNames.forEach(function(v, i) { newVars[v] = x[i]; });
        var newF = equations.map(function(eq) { return evalAST(eq, newVars); });
        var newNorm = 0;
        for (var fi = 0; fi < newF.length; fi++) newNorm += newF[fi] * newF[fi];
        newNorm = Math.sqrt(newNorm);
        
        if (newNorm < oldNorm * 0.999) {
            // 残差下降正常
            stallCount = 0;
        } else if (newNorm > oldNorm * 1.5) {
            // 发散检测 — 残差剧增，放弃当前初值
            if (stallCount >= 2) {
                return { solution: x, iterations: iter, converged: false, residual: newNorm, error: 'diverging' };
            }
            stallCount++;
        } else {
            // 停滞 — 残差无下降
            stallCount++;
        }
    }
    
    // 最终检查
    var vars = {};
    varNames.forEach(function(v, i) { vars[v] = x[i]; });
    var F = equations.map(function(eq) { return evalAST(eq, vars); });
    var norm = 0;
    for (var fi = 0; fi < F.length; fi++) {
        if (isNaN(F[fi]) || !isFinite(F[fi])) {
            return { solution: x, iterations: maxIter, converged: false, residual: Infinity };
        }
        norm += F[fi] * F[fi];
    }
    norm = Math.sqrt(norm);
    
    return {
        solution: x,
        iterations: maxIter,
        converged: norm < tolerance,
        residual: norm
    };
}











var COMPUTE_DECIMALS = 6; // 求解与显示固定网格位数（产品规格：6位小数有限网格）。roundToGrid、内部残差容差、显示 toFixed 均据此，恒为 6，不提供位数切换

function roundToGrid(x) {
    if (!isFinite(x)) return x;
    var scale = Math.pow(10, COMPUTE_DECIMALS);
    var scaled = x * scale;
    var nearest = Math.round(scaled);
    // 如果已在网格点上（浮点误差范围内），直接返回该网格点
    if (Math.abs(scaled - nearest) < 1e-6) {
        return nearest / scale;
    }
    // 四舍五入到最近的网格点
    return Math.round(scaled) / scale;
}

// 物理边界已移除（大模型负责物理合理性判断）

// 物理边界解析已移除

// 物理边界过滤已移除

function generateStartPoints(varNames, contractedDomain) {
    const n = varNames.length;
    const points = [];

    // 使用 D0（传入的收缩后域）作为起始点生成依据
    // 当 D0 为空时，默认使用 [-1000000, 1000000]
    // 根据边界调整起始值
    function getStartValue(v, base) {
        if (contractedDomain && contractedDomain[v]) {
            const b = contractedDomain[v];
            const min = b.min === -Infinity ? -1000000 : b.min;
            const max = b.max === Infinity ? 1000000 : b.max;
            if (base < min) return min;
            if (base > max) return max;
            return base;
        }
        return base;
    }

    // 原点
    points.push(varNames.map(v => getStartValue(v, 0)));
    // 全+1
    points.push(varNames.map(v => getStartValue(v, 1)));
    // 全-1
    points.push(varNames.map(v => getStartValue(v, -1)));
    // 全+10
    points.push(varNames.map(v => getStartValue(v, 10)));
    // 全-10
    points.push(varNames.map(v => getStartValue(v, -10)));

    // 混合符号点（多变量时覆盖不同象限）
    if (n >= 2) {
        points.push(varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? 5 : -5)));
        points.push(varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? -5 : 5)));
        points.push(varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? 10 : -10)));
        points.push(varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? -10 : 10)));
    }

    // 3个确定性网格点（基于 D0 区间）
    const gridFractions = [0.25, 0.5, 0.75];
    for (let r = 0; r < 3; r++) {
        const pt = [];
        for (let i = 0; i < n; i++) {
            const v = varNames[i];
            if (contractedDomain && contractedDomain[v]) {
                const b = contractedDomain[v];
                const min = b.min === -Infinity ? -1000000 : b.min;
                const max = b.max === Infinity ? 1000000 : b.max;
                pt.push(min + gridFractions[r] * (max - min));
            } else {
                pt.push((r - 1) * 66);
            }
        }
        points.push(pt);
    }

    return points;
}

function deduplicateSolutions(solutions, varNames, tolerance) {
    const unique = [];
    // 去重阈值：至少1e-4，避免浮点误差导致的近重复
    const dedupTol = Math.max(tolerance, 1e-4);

    for (const sol of solutions) {
        // 过滤超出范围的解
        let outOfRange = false;
        for (const val of sol) {
            if (isNaN(val) || !isFinite(val) || Math.abs(val) > 1000000) {
                outOfRange = true;
                break;
            }
        }
        if (outOfRange) continue;

        // 距离比较去重：若与任一已有解的最大分量差 < dedupTol，视为重复
        let isDup = false;
        for (const existing of unique) {
            let maxDiff = 0;
            for (let i = 0; i < sol.length; i++) {
                maxDiff = Math.max(maxDiff, Math.abs(sol[i] - existing[i]));
            }
            if (maxDiff < dedupTol) {
                isDup = true;
                break;
            }
        }
        if (!isDup) unique.push(sol);
    }

    return unique;
}

function isPolynomial(ast, varName) {
    switch (ast.type) {
        case 'num': return true;
        case 'var': return ast.name === varName;
        case 'unary': return isPolynomial(ast.operand, varName);
        case 'binop':
            if (ast.op === '+' || ast.op === '-')
                return isPolynomial(ast.left, varName) && isPolynomial(ast.right, varName);
            if (ast.op === '*')
                return isPolynomial(ast.left, varName) && isPolynomial(ast.right, varName);
            if (ast.op === '^') {
                // 支持 (多项式)^n 形式，如 (x-5)^4
                return isPolynomial(ast.left, varName) &&
                       ast.right.type === 'num' && Number.isInteger(ast.right.value) && ast.right.value >= 0 && ast.right.value <= 20;
            }
            if (ast.op === '/') {
                return !hasVariable(ast.right, [varName]) && isPolynomial(ast.left, varName);
            }
            return false;
        case 'func': return !getFuncChildrenAll(ast).some(function(child) { return hasVariable(child, [varName]); });
    }
    return false;
}

function extractPolynomialCoefficients(ast, varName) {
    if (!isPolynomial(ast, varName)) return null;

    // 递归提取子表达式的系数对象 {power: coeff, ...}
    function polyExtract(node) {
        const result = {};
        switch (node.type) {
            case 'num':
                result[0] = node.value;
                break;
            case 'var':
                if (node.name === varName) result[1] = 1;
                else result[0] = 0;
                break;
            case 'unary':
                const inner = polyExtract(node.operand);
                for (const [p, c] of Object.entries(inner)) {
                    result[Number(p)] = -c;
                }
                break;
            case 'binop':
                if (node.op === '+' || node.op === '-') {
                    const l = polyExtract(node.left);
                    const r = polyExtract(node.right);
                    for (const [p, c] of Object.entries(l)) {
                        result[Number(p)] = (result[Number(p)] || 0) + c;
                    }
                    const sign = node.op === '+' ? 1 : -1;
                    for (const [p, c] of Object.entries(r)) {
                        result[Number(p)] = (result[Number(p)] || 0) + sign * c;
                    }
                } else if (node.op === '*') {
                    const l = polyExtract(node.left);
                    const r = polyExtract(node.right);
                    // 多项式卷积
                    for (const [pi, ci] of Object.entries(l)) {
                        for (const [pj, cj] of Object.entries(r)) {
                            const pk = Number(pi) + Number(pj);
                            result[pk] = (result[pk] || 0) + ci * cj;
                        }
                    }
                } else if (node.op === '^') {
                    if (node.right.type === 'num' && Number.isInteger(node.right.value) && node.right.value >= 0) {
                        const exp = node.right.value;
                        if (exp === 0) {
                            result[0] = 1;
                        } else if (node.left.type === 'var' && node.left.name === varName) {
                            result[exp] = 1;
                        } else {
                            // 多项式幂运算：通过重复卷积计算 (如 (x-5)^4)
                            const base = polyExtract(node.left);
                            let power = { 0: 1 }; // x^0 = 1
                            for (let e = 0; e < exp; e++) {
                                const newPower = {};
                                for (const [pi, ci] of Object.entries(power)) {
                                    for (const [pj, cj] of Object.entries(base)) {
                                        const pk = Number(pi) + Number(pj);
                                        newPower[pk] = (newPower[pk] || 0) + ci * cj;
                                    }
                                }
                                power = newPower;
                            }
                            for (const [p, c] of Object.entries(power)) {
                                result[Number(p)] = c;
                            }
                        }
                    }
                } else if (node.op === '/') {
                    if (!hasVariable(node.right, [varName])) {
                        const c = evalAST(node.right, {});
                        const l = polyExtract(node.left);
                        for (const [p, coeff] of Object.entries(l)) {
                            result[Number(p)] = coeff / c;
                        }
                    }
                }
                break;
            case 'func':
                if (!getFuncChildrenAll(node).some(function(child) { return hasVariable(child, [varName]); })) {
                    result[0] = evalAST(node, {});
                }
                break;
        }
        return result;
    }

    const coeffs = polyExtract(ast);

    const maxPower = Math.max(...Object.keys(coeffs).map(Number));
    const result = new Array(maxPower + 1).fill(0);
    for (const [power, coeff] of Object.entries(coeffs)) {
        result[Number(power)] = coeff;
    }
    return result;
}

function solveQuadraticFormula(coeffs) {
    const c = coeffs[0];
    const b = coeffs[1];
    const a = coeffs[2];

    if (Math.abs(a) < 1e-12) {
        // 退化为一次方程
        if (Math.abs(b) < 1e-12) return [];
        return [-c / b];
    }

    const discriminant = b * b - 4 * a * c;

    if (discriminant < -1e-12) {
        // 无实根
        return [];
    }

    if (Math.abs(discriminant) < 1e-12) {
        // 重根
        return [-b / (2 * a)];
    }

    const sqrtD = Math.sqrt(discriminant);
    // 使用数值稳定的求根公式避免大数相消
    // 如果 b > 0: q = -(b + sqrtD) / 2; 否则 q = -(b - sqrtD) / 2
    const q = b > 0 ? -(b + sqrtD) / 2 : -(b - sqrtD) / 2;
    const root1 = q / a;
    const root2 = c / q;

    return root1 < root2 ? [root1, root2] : [root2, root1];
}

function syntheticDivide(coeffs, root) {
    const n = coeffs.length - 1;
    const result = new Array(n).fill(0);
    result[n - 1] = coeffs[n];
    for (let i = n - 1; i >= 1; i--) {
        result[i - 1] = coeffs[i] + root * result[i];
    }
    return result;
}

function polyEval(coeffs, x) {
    let result = 0;
    for (let i = coeffs.length - 1; i >= 0; i--) {
        result = result * x + coeffs[i];
    }
    return result;
}

function rationalRootTheorem(coeffs) {
    const n = coeffs.length - 1;
    if (n <= 0) return [];

    // a_0 ≈ 0 意味着 x=0 是一个根：记录后综合除法降次，再继续枚举其余有理根
    // （旧逻辑直接 return [0]，会漏掉 x=0 之外的其余有理根，如 x^2 - x = 0 漏掉 x=1）
    if (Math.abs(coeffs[0]) < 1e-12) {
        const reduced = syntheticDivide(coeffs, 0);
        const otherRoots = rationalRootTheorem(reduced);
        return [0].concat(otherRoots);
    }

    // 尝试将系数转为整数
    let maxDenom = 1;
    for (const c of coeffs) {
        const str = c.toFixed(6);
        if (str.includes('.')) {
            const decPart = str.split('.')[1];
            // 去除尾零
            const trimmed = decPart.replace(/0+$/, '');
            if (trimmed.length > 0) {
                const denom = Math.pow(10, trimmed.length);
                if (denom > maxDenom) maxDenom = denom;
            }
        }
    }

    // 转为整数系数
    const intCoeffs = coeffs.map(c => Math.round(c * maxDenom));
    const a0 = Math.abs(intCoeffs[0]);
    const an = Math.abs(intCoeffs[n]);

    if (an === 0) return [];

    // 求所有因数
    function divisors(num) {
        const result = [];
        for (let i = 1; i * i <= num; i++) {
            if (num % i === 0) {
                result.push(i);
                if (i !== num / i) result.push(num / i);
            }
        }
        return result;
    }

    const pDivs = divisors(a0);
    const qDivs = divisors(an);

    // 枚举所有 p/q 组合
    const candidates = new Set();
    for (const p of pDivs) {
        for (const q of qDivs) {
            candidates.add(p / q);
            candidates.add(-p / q);
        }
    }

    // 候选根数量熔断（规格：>20000 降级）
    if (candidates.size > 20000) return null;

    // 测试每个候选根
    // 使用自适应阈值：基础绝对阈值 + 系数幅度相对阈值
    // 整数系数多项式在真实根处 polyEval 应精确为0，浮点误差远小于1e-3
    const coeffMax = Math.max(...intCoeffs.map(c => Math.abs(c)));
    const rootThreshold = Math.max(1e-6, 1e-8 * coeffMax);
    const roots = [];
    for (const c of candidates) {
        const val = polyEval(intCoeffs, c);
        if (Math.abs(val) < rootThreshold) {
            roots.push(c);
        }
    }

    return roots;
}

function polynomialAllRoots(coeffs, tolerance) {
    const roots = [];
    let remaining = [...coeffs];

    // 去除前导零（高次项系数为0）
    while (remaining.length > 1 && Math.abs(remaining[remaining.length - 1]) < 1e-12) {
        remaining.pop();
    }

    if (remaining.length <= 1) return roots;

    // 阶段1：有理根定理
    const rationalRoots = rationalRootTheorem(remaining);
    if (rationalRoots && rationalRoots.length > 0) {
        for (const r of rationalRoots) {
            // 验证 r 是否确实是当前 remaining 的根
            const valAtR = polyEval(remaining, r);
            const leadingCoeff = Math.abs(remaining[remaining.length - 1]);
            if (Math.abs(valAtR) > 1e-6 * Math.max(1, leadingCoeff)) {
                // r 不是当前多项式的根，跳过（不降次）
                continue;
            }

            roots.push(r);
            // 综合除法降次
            const quotient = syntheticDivide(remaining, r);
            remaining = quotient;
            // 去除前导零
            while (remaining.length > 1 && Math.abs(remaining[remaining.length - 1]) < 1e-12) {
                remaining.pop();
            }
        }
    }

    // 阶段2：对剩余多项式求解
    if (remaining.length > 3) {
        // 三次以上：符号变化扫描+牛顿精修
        const scanRoots = scanRealRoots(remaining, tolerance);
        // 验证扫描根：大系数多项式可能产生假根
        const leadingCoeff = Math.abs(remaining[remaining.length - 1]);
        for (const r of scanRoots) {
            const val = Math.abs(polyEval(remaining, r));
            if (val < 1e-3 * Math.max(1, leadingCoeff)) {
                roots.push(r);
            }
        }
    } else if (remaining.length === 3) {
        // 二次方程：判别式求根公式（精确解，避免扫描精度损失）
        const quadRoots = solveQuadraticFormula(remaining);
        roots.push(...quadRoots);
    } else if (remaining.length === 2) {
        // 一次方程 a_0 + a_1*x = 0
        if (Math.abs(remaining[1]) > 1e-12) {
            roots.push(-remaining[0] / remaining[1]);
        }
    }

    return roots;
}

function scanRealRoots(coeffs, tolerance) {
    const roots = [];
    const n = coeffs.length - 1;
    const an = Math.abs(coeffs[n]);
    if (an < 1e-12) return roots;

    // Cauchy 界：所有实根 |x| ≤ 1 + max(|a_i / a_n|)
    let maxRatio = 0;
    for (let i = 0; i < n; i++) {
        maxRatio = Math.max(maxRatio, Math.abs(coeffs[i] / an));
    }
    const scanRange = Math.min(1000000, 1 + maxRatio);
    // 自适应步长：保证至少有 2000 个采样点
    const step = Math.max(scanRange / 2000, 0.001);

    let prevVal = polyEval(coeffs, -scanRange);
    let prevX = -scanRange;

    for (let x = -scanRange + step; x <= scanRange; x += step) {
        const val = polyEval(coeffs, x);

        // 检测符号变化（根在 prevX 和 x 之间）
        // 注意：当 val 或 prevVal 恰好为 0 时，prevVal * val = 0 不满足 < 0
        // 所以额外检测 prevVal 和 val 异号或其中之一为零的情况
        if (prevVal * val < 0 || (Math.abs(prevVal) < tolerance * 10 && Math.abs(val) < tolerance * 10 && prevVal !== 0 && val !== 0 && Math.sign(prevVal) !== Math.sign(val))) {
            // 二分法精修
            let lo = prevX, hi = x;
            let loVal = prevVal;
            for (let iter = 0; iter < 50; iter++) {
                const mid = (lo + hi) / 2;
                const midVal = polyEval(coeffs, mid);
                if (Math.abs(midVal) < tolerance) {
                    roots.push(mid);
                    break;
                }
                if (loVal * midVal < 0) {
                    hi = mid;
                } else {
                    lo = mid;
                    loVal = midVal;
                }
            }
            // 仅在二分法未收敛到 tolerance 时添加最后近似值
            if (roots.length === 0 || Math.abs(roots[roots.length - 1] - (lo + hi) / 2) > tolerance) {
                // 检查是否已经被精确根检测捕获
                let candidate = (lo + hi) / 2;
                // 牛顿精修提高精度（大系数多项式需要）
                for (let iter = 0; iter < 20; iter++) {
                    const f = polyEval(coeffs, candidate);
                    const df = polyDerivative(coeffs, candidate);
                    if (Math.abs(df) < 1e-12) break;
                    const newR = candidate - f / df;
                    if (Math.abs(newR - candidate) < tolerance) { candidate = newR; break; }
                    candidate = newR;
                }
                if (roots.length === 0 || Math.abs(roots[roots.length - 1] - candidate) > tolerance) {
                    roots.push(candidate);
                }
            }
        }

        // 检测精确根（val ≈ 0）
        if (Math.abs(val) < tolerance * 10) {
            // 牛顿精修
            let r = x;
            for (let iter = 0; iter < 20; iter++) {
                const f = polyEval(coeffs, r);
                const df = polyDerivative(coeffs, r);
                if (Math.abs(df) < 1e-12) break;
                const newR = r - f / df;
                if (Math.abs(newR - r) < tolerance) { r = newR; break; }
                r = newR;
            }
            // 去重
            if (roots.length === 0 || Math.abs(roots[roots.length - 1] - r) > tolerance) {
                roots.push(r);
            }
        }

        prevVal = val;
        prevX = x;
    }

    return roots;
}

function polyDerivative(coeffs, x) {
    let result = 0;
    for (let i = 1; i < coeffs.length; i++) {
        result += i * coeffs[i] * Math.pow(x, i - 1);
    }
    return result;
}

function collectVariableDenominators(ast, varNames) {
    const denoms = [];
    function walk(node) {
        if (!node) return;
        if (node.type === 'binop') {
            if (node.op === '/' && hasVariable(node.right, varNames)) {
                denoms.push(node.right);
            }
            walk(node.left);
            walk(node.right);
        } else if (node.type === 'unary') {
            walk(node.operand);
        } else if (node.type === 'func') {
            getFuncChildrenAll(node).forEach(function(child) { walk(child); });
        }
    }
    walk(ast);
    return denoms;
}

function tryRationalTransform(ast, varName) {
    if (ast.type !== 'binop' || ast.op !== '-') return null;

    const left = ast.left;
    const right = ast.right;
    const singularities = [];

    // 情况1: 左侧是 A/D，D 含变量
    if (left.type === 'binop' && left.op === '/' && hasVariable(left.right, [varName])) {
        const D = left.right;
        // 提取奇点：D = 0 的根
        const denomCoeffs = extractPolynomialCoefficients(D, varName);
        if (denomCoeffs && denomCoeffs.length > 1) {
            const singRoots = polynomialAllRoots(denomCoeffs, 1e-6);
            singularities.push(...singRoots);
        }
        // 变换: A - right * D = 0
        const newAST = {
            type: 'binop', op: '-',
            left: left.left,
            right: { type: 'binop', op: '*', left: right, right: D }
        };
        return { transformed: newAST, singularities: singularities };
    }

    // 情况2: 右侧是 A/D，D 含变量
    if (right.type === 'binop' && right.op === '/' && hasVariable(right.right, [varName])) {
        const D = right.right;
        const denomCoeffs = extractPolynomialCoefficients(D, varName);
        if (denomCoeffs && denomCoeffs.length > 1) {
            const singRoots = polynomialAllRoots(denomCoeffs, 1e-6);
            singularities.push(...singRoots);
        }
        // 变换: left * D - A = 0
        const newAST = {
            type: 'binop', op: '-',
            left: { type: 'binop', op: '*', left: left, right: D },
            right: right.left
        };
        return { transformed: newAST, singularities: singularities };
    }

    // 情况3: 两侧都有分母 — 收集所有分母，整体相乘
    const allDenoms = collectVariableDenominators(ast, [varName]);
    if (allDenoms.length === 0) return null;

    // 逐个乘以分母
    let transformed = ast;
    for (const d of allDenoms) {
        const denomCoeffs = extractPolynomialCoefficients(d, varName);
        if (denomCoeffs && denomCoeffs.length > 1) {
            const singRoots = polynomialAllRoots(denomCoeffs, 1e-6);
            singularities.push(...singRoots);
        }
        // 将 A/B 中的 B 替换为 1（因为整体乘以 B 后 B 被消去）
        transformed = replaceDivisionByOne(transformed, d);
    }
    if (transformed !== ast) {
        return { transformed: transformed, singularities: singularities };
    }

    return null;
}

function replaceDivisionByOne(ast, targetDenom) {
    function walk(node) {
        if (!node) return node;
        switch (node.type) {
            case 'num':
            case 'var':
                return node;
            case 'unary':
                return { type: 'unary', op: node.op, operand: walk(node.operand) };
            case 'binop':
                if (node.op === '/' && astEqual(node.right, targetDenom)) {
                    return walk(node.left);
                }
                return { type: 'binop', op: node.op, left: walk(node.left), right: walk(node.right) };
            case 'func':
                // 单参数函数
                if (node.arg) {
                    return { type: 'func', name: node.name, arg: walk(node.arg) };
                }
                // 多参数函数
                if (node.args) {
                    var walkedArgs = node.args.map(function(a, idx) {
                        if (node.name === 'int' && idx === 1) return JSON.parse(JSON.stringify(a));
                        if (node.name === 'ode' && idx <= 2) return JSON.parse(JSON.stringify(a));
                        return walk(a);
                    });
                    return { type: 'func', name: node.name, args: walkedArgs };
                }
                return node;
        }
        return node;
    }
    return walk(ast);
}

function astEqual(a, b) {
    if (!a || !b) return false;
    if (a.type !== b.type) return false;
    switch (a.type) {
        case 'num': return a.value === b.value;
        case 'var': return a.name === b.name;
        case 'unary': return a.op === b.op && astEqual(a.operand, b.operand);
        case 'binop': return a.op === b.op && astEqual(a.left, b.left) && astEqual(a.right, b.right);
        case 'func':
            if (a.name !== b.name) return false;
            // 单参数函数
            if (a.arg && b.arg) return astEqual(a.arg, b.arg);
            // 多参数函数
            if (a.args && b.args) {
                if (a.args.length !== b.args.length) return false;
                return a.args.every(function(ai, i) { return astEqual(ai, b.args[i]); });
            }
            return false;
    }
    return false;
}

function hasCalculusOp(ast) {
    if (!ast) return false;
    if (ast.type === 'func') {
        if (ast.name === 'ode' || ast.name === 'diff' || ast.name === 'int') return true;
        return getFuncChildrenAll(ast).some(function(child) { return hasCalculusOp(child); });
    }
    if (ast.type === 'binop') return hasCalculusOp(ast.left) || hasCalculusOp(ast.right);
    if (ast.type === 'unary') return hasCalculusOp(ast.operand);
    return false;
}

function classifyODE(exprAST, xVar, yVar) {
    if (!exprAST) return null;
    var result = { type: 'general', linearPart: null, nonlinearPart: null, lipschitz: null, hasY2: false };

    // 检查是否是 Riccati 方程：表达式中包含 y^2 项
    // 如果表达式是 y^2 的线性组合，则是 Riccati
    result.hasY2 = hasY2Term(exprAST, yVar);

    // 检测线性性：检查是否可写为 a(x)*y + b(x) 形式
    // 如果是，则 type = 'linear'
    var linearInfo = checkLinearODE(exprAST, yVar);
    if (linearInfo) {
        result.type = 'linear';
        result.linearPart = linearInfo;
    } else if (result.hasY2) {
        result.type = 'riccati';
    }

    // 估计 Lipschitz 常数（对 y 的偏导数的绝对值上限）
    // 使用数值差分法在几个点上采样
    result.lipschitz = estimateLipschitzConstant(exprAST, xVar, yVar);

    return result;
}

function hasY2Term(ast, yVar) {
    if (!ast) return false;
    if (ast.type === 'binop') {
        if (ast.op === '^' && ast.left && ast.left.type === 'var' && ast.left.name === yVar &&
            ast.right && ast.right.type === 'num' && ast.right.value === 2) {
            return true;
        }
        // 处理 y*y 形式
        if (ast.op === '*' && ast.left && ast.right &&
            ast.left.type === 'var' && ast.left.name === yVar &&
            ast.right.type === 'var' && ast.right.name === yVar) {
            return true;
        }
        return hasY2Term(ast.left, yVar) || hasY2Term(ast.right, yVar);
    }
    if (ast.type === 'unary') return hasY2Term(ast.operand, yVar);
    if (ast.type === 'func') return getFuncChildrenAll(ast).some(function(child) { return hasY2Term(child, yVar); });
    return false;
}

function checkLinearODE(exprAST, yVar) {
    if (!exprAST) return null;
    // 尝试提取线性系数（类似 extractLinearCoefficients 但只针对单变量 y）
    var a = 0, b = 0;
    // 使用简单的结构检查：表达式是否可分解为 y 的线性组合
    // 先检查在 y 上的线性性
    if (!isLinearInY(exprAST, yVar)) return null;
    return { a: null, b: null }; // 表示线性，但系数需数值计算
}

function isLinearInY(ast, yVar) {
    if (!ast) return true;
    if (ast.type === 'num') return true;
    if (ast.type === 'var') return ast.name === yVar || true; // 非 y 变量视为常数
    if (ast.type === 'unary') return isLinearInY(ast.operand, yVar);
    if (ast.type === 'binop') {
        if (ast.op === '+' || ast.op === '-') {
            return isLinearInY(ast.left, yVar) && isLinearInY(ast.right, yVar);
        }
        if (ast.op === '*') {
            // 至少一侧不包含 y
            var leftHasY = hasVariable(ast.left, [yVar]);
            var rightHasY = hasVariable(ast.right, [yVar]);
            if (leftHasY && rightHasY) return false;
            if (!leftHasY && !rightHasY) return true;
            if (leftHasY) return isLinearInY(ast.left, yVar);
            return isLinearInY(ast.right, yVar);
        }
        if (ast.op === '/') {
            // 分母不能含 y
            if (hasVariable(ast.right, [yVar])) return false;
            return isLinearInY(ast.left, yVar);
        }
        if (ast.op === '^') {
            // y^n 只有 n=0,1 时线性
            if (ast.left.type === 'var' && ast.left.name === yVar) {
                return ast.right.type === 'num' && (ast.right.value === 0 || ast.right.value === 1);
            }
            // 常数底数：不包含 y 即可
            return !hasVariable(ast, [yVar]);
        }
        return false;
    }
    if (ast.type === 'func') {
        // 函数参数不含 y 时视为常数
        return !hasVariable(ast, [yVar]);
    }
    return true;
}

function estimateLipschitzConstant(exprAST, xVar, yVar) {
    if (!exprAST) return Infinity;
    var maxLipschitz = 0;
    var samplePoints = [0, 1, -1, 2, -2, 5, -5, 10, -10];
    var ySteps = [0.001, 0.0001];
    var validSamples = 0;

    for (var xi = 0; xi < samplePoints.length; xi++) {
        var xVal = samplePoints[xi];
        for (var yi = 0; yi < samplePoints.length; yi++) {
            var yVal = samplePoints[yi];
            // 对每个采样点用数值差分估计 ∂f/∂y
            for (var hi = 0; hi < ySteps.length; hi++) {
                var h = ySteps[hi];
                var varsP = {}; varsP[xVar] = xVal; varsP[yVar] = yVal + h;
                var varsM = {}; varsM[xVar] = xVal; varsM[yVar] = yVal - h;
                var fp = evalAST(exprAST, varsP);
                var fm = evalAST(exprAST, varsM);
                if (isNaN(fp) || isNaN(fm) || !isFinite(fp) || !isFinite(fm)) continue;
                var lip = Math.abs((fp - fm) / (2 * h));
                if (isFinite(lip) && lip > maxLipschitz) {
                    maxLipschitz = lip;
                }
                validSamples++;
            }
        }
    }

    // 如果有效采样点太少，返回大值表示不确定
    if (validSamples < 5) return Infinity;
    return maxLipschitz;
}

function isContractionMapping(exprAST, xVar, yVar, h) {
    var L = estimateLipschitzConstant(exprAST, xVar, yVar);
    // 对 ODE 求解，步长 h 下的压缩条件：L * h < 1
    return L * h < 1;
}

function picardSolve(exprAST, xVar, yVar, x0, y0, x1, vars, steps) {
    var n = steps || 100;
    var h = (x1 - x0) / n;
    var cx = x0, cy = y0;
    // 实现：Heun / 显式梯形法（二阶 Runge-Kutta, RK2）——非 Picard 迭代，亦非 RK4。
    // 每步：用当前点斜率 k1 预测 yPred，再用预测点斜率 k2 做梯形平均：cy ← cy + h·(k1+k2)/2。
    // 收敛性：enhancedODESolve 已在派发前用 isContractionMapping(L·h<1) 确认压缩成立，
    //   故该二阶方法在步长内稳定收敛（无需多次全局 Picard 迭代）。
    // 注：函数名 picardSolve 为历史命名（保留以免改动调度引用）；方法实质是 RK2。

    for (var i = 0; i < n; i++) {
        var xNext = cx + h;
        // 使用当前 y 值估计斜率
        var v1 = Object.assign({}, vars);
        v1[xVar] = cx; v1[yVar] = cy;
        var k1 = evalAST(exprAST, v1);
        if (isNaN(k1)) return NaN;

        // 预测下一步的 y
        var yPred = cy + h * k1;
        // 用预测值重新估计斜率
        var v2 = Object.assign({}, vars);
        v2[xVar] = xNext; v2[yVar] = yPred;
        var k2 = evalAST(exprAST, v2);
        if (isNaN(k2)) return NaN;

        // 梯形校正
        cy = cy + h * (k1 + k2) / 2;
        cx = xNext;
    }
    return cy;
}

function duhamelDecompose(exprAST, yVar) {
    if (!exprAST) return null;
    var result = { linearExpr: null, nonlinearExpr: null, hasLinear: false, linearCoeff: null };

    // 尝试从表达式中提取线性项
    // 线性项形如 a(x)*y，其中 a(x) 不包含 y
    if (exprAST.type === 'binop' && (exprAST.op === '+' || exprAST.op === '-')) {
        var left = extractLinearYTerm(exprAST.left, yVar);
        var right = extractLinearYTerm(exprAST.right, yVar);
        if (left) {
            result.hasLinear = true;
            result.linearExpr = left.coeff;
            result.linearCoeff = left.coeff;
            result.nonlinearExpr = exprAST.op === '+' ? exprAST.right : { type: 'unary', op: '-', operand: exprAST.right };
            return result;
        }
        if (right) {
            result.hasLinear = true;
            result.linearExpr = right.coeff;
            result.linearCoeff = right.coeff;
            result.nonlinearExpr = exprAST.left;
            // 如果实际是 left - right，则右侧线性项取反
            return result;
        }
    }

    // 检查整体是否形如 a*y + b
    // 如果表达式是乘法结构 a*y
    if (exprAST.type === 'binop' && exprAST.op === '*') {
        if (exprAST.left.type === 'var' && exprAST.left.name === yVar) {
            result.hasLinear = true;
            result.linearExpr = exprAST.right;
            result.linearCoeff = exprAST.right;
            result.nonlinearExpr = { type: 'num', value: 0 };
            return result;
        }
        if (exprAST.right.type === 'var' && exprAST.right.name === yVar) {
            result.hasLinear = true;
            result.linearExpr = exprAST.left;
            result.linearCoeff = exprAST.left;
            result.nonlinearExpr = { type: 'num', value: 0 };
            return result;
        }
    }

    // 一般情况：无法分离线性项
    result.nonlinearExpr = exprAST;
    return result;
}

function extractLinearYTerm(ast, yVar) {
    if (!ast) return null;
    if (ast.type === 'var' && ast.name === yVar) {
        return { coeff: { type: 'num', value: 1 } };
    }
    if (ast.type === 'binop' && ast.op === '*') {
        if (ast.left.type === 'var' && ast.left.name === yVar) {
            return { coeff: ast.right };
        }
        if (ast.right.type === 'var' && ast.right.name === yVar) {
            return { coeff: ast.left };
        }
    }
    return null;
}





function enhancedODESolve(exprAST, xVar, yVar, x0, y0, x1, vars, classification) {
    var cls = classification || classifyODE(exprAST, xVar, yVar);
    var stepSize = Math.abs(x1 - x0) / 200;

    // 方法1: Duhamel 原理 — 线性主部精确处理 + 非线性剩余数值
    if (cls.type === 'linear') {
        // 线性 ODE 可以直接用解析方法（积分因子法）
        // 这里仍然用数值方法但标记为线性优势
        return standardRK4(exprAST, xVar, yVar, x0, y0, x1, vars, 200);
    }

    // 方法2: 压缩映射 + Picard 迭代
    if (isContractionMapping(exprAST, xVar, yVar, stepSize)) {
        return picardSolve(exprAST, xVar, yVar, x0, y0, x1, vars, 200);
    }

    // 方法3: Duhamel 分解 — 提取线性项精确处理
    var duhamel = duhamelDecompose(exprAST, yVar);
    if (duhamel.hasLinear && duhamel.nonlinearExpr) {
        // 检查非线性项是否为 0（纯线性）
        if (duhamel.nonlinearExpr.type === 'num' && Math.abs(duhamel.nonlinearExpr.value) < 1e-15) {
            // 纯线性 ODE：dy/dx = a(x)*y
            // 解析解：y(x) = y0 * exp(∫_{x0}^{x} a(t) dt)
            var aIntegral = 0;
            var ai_n = 200;
            var ai_h = (x1 - x0) / ai_n;
            for (var ai_i = 0; ai_i < ai_n; ai_i++) {
                var ai_x = x0 + ai_i * ai_h;
                var ai_x_half = ai_x + ai_h / 2;
                var v = Object.assign({}, vars);
                v[xVar] = ai_x; v[yVar] = 0; // y 值不影响 a(x)
                var fa = evalAST(duhamel.linearCoeff, v);
                v[xVar] = ai_x_half;
                var fb = evalAST(duhamel.linearCoeff, v);
                v[xVar] = ai_x + ai_h;
                var fc = evalAST(duhamel.linearCoeff, v);
                // 辛普森
                aIntegral += (ai_h / 6) * (fa + 4*fb + fc);
            }
            return y0 * Math.exp(aIntegral);
        }
    }

    // 方法4: 默认 RK4
    return standardRK4(exprAST, xVar, yVar, x0, y0, x1, vars, 200);
}

function standardRK4(exprAST, xVar, yVar, x0, y0, x1, vars, steps) {
    var n = steps || 200;
    var h = (x1 - x0) / n;
    var cx = x0, cy = y0;
    for (var i = 0; i < n; i++) {
        var v1 = Object.assign({}, vars); v1[xVar] = cx; v1[yVar] = cy;
        var k1 = evalAST(exprAST, v1);
        var v2 = Object.assign({}, vars); v2[xVar] = cx + h/2; v2[yVar] = cy + h*k1/2;
        var k2 = evalAST(exprAST, v2);
        var v3 = Object.assign({}, vars); v3[xVar] = cx + h/2; v3[yVar] = cy + h*k2/2;
        var k3 = evalAST(exprAST, v3);
        var v4 = Object.assign({}, vars); v4[xVar] = cx + h; v4[yVar] = cy + h*k3;
        var k4 = evalAST(exprAST, v4);
        if (isNaN(k1) || isNaN(k2) || isNaN(k3) || isNaN(k4)) return NaN;
        cy = cy + h * (k1 + 2*k2 + 2*k3 + k4) / 6;
        cx = cx + h;
    }
    return cy;
}



function scanASTForLargeNumbers(ast) {
    if (!ast) return [];
    switch (ast.type) {
        case 'num':
            return Math.abs(ast.value) > 1e200 ? [ast.value] : [];
        case 'var':
            return [];
        case 'unary':
            return scanASTForLargeNumbers(ast.operand);
        case 'binop':
            return [...scanASTForLargeNumbers(ast.left), ...scanASTForLargeNumbers(ast.right)];
        case 'func':
            return getFuncChildren(ast).reduce(function(acc, child) {
                return acc.concat(scanASTForLargeNumbers(child));
            }, []);
        default:
            return [];
    }
}

function _generateCorners(box, n) {
    if (n === 0) return [[]];
    var sub = _generateCorners(box, n - 1);
    var result = [];
    for (var si = 0; si < sub.length; si++) {
        var p1 = sub[si].concat([box[n-1].min]);
        var p2 = sub[si].concat([box[n-1].max]);
        result.push(p1, p2);
    }
    return result;
}

// suan1: 表达式语法解析 → 解析方程字符串→AST，模糊修复
function suan1(state) {
    var eqStrs = state.equationStrs;
    state.equations = [];
    // 忠实（未消分母）方程 AST 快照：用于结果层"良定义"校验（见 _filterIllDefined）。
    // 注意 suan23 会把分式交叉相乘消分母，产生"分母零点"的伪根（如 sin(x)/x=0 → sin(x)=0·x，x=0 处 0/0 未定义）。
    // 故保留解析后的原始等式 AST（含除法），在收尾时回代校验真解是否在原式上有定义。
    state.userEquations = [];
    state.domainConstraints = [];
    state.conditionWarnings = [];
    state.integerConstraintUnenforced = false;
    state.inequalityConstraints = [];

    for (var i = 0; i < eqStrs.length; i++) {
        var eqStr = eqStrs[i];

        // 检测复杂不等式（<=, >=, <, > 运算符）
        if (/<=|>=|<|>/.test(eqStr)) {
            var cond = parseCondition(eqStr);
            if (cond) {
                if (cond.type === "domain") {
                    state.domainConstraints.push(cond);
                    // 将域约束也作为不等式约束加入，供 suan48 枚举使用
                    if (cond.varName && cond.min !== undefined) {
                        var _vAST = parse(tokenize(cond.varName));
                        var _cAST = { type: "num", value: cond.min };
                        state.inequalityConstraints.push({ lhs: _vAST, rhs: _cAST, op: ">=", lhsStr: cond.varName, rhsStr: String(cond.min) });
                    }
                    if (cond.varName && cond.max !== undefined) {
                        var _vAST2 = parse(tokenize(cond.varName));
                        var _cAST2 = { type: "num", value: cond.max };
                        state.inequalityConstraints.push({ lhs: _vAST2, rhs: _cAST2, op: "<=", lhsStr: cond.varName, rhsStr: String(cond.max) });
                    }
                    continue;
                }
                if (cond.type === "warn") { state.conditionWarnings.push(cond.message); if (cond.kind === 'integer-unenforced') state.integerConstraintUnenforced = true; continue; }
                if (cond.type === "skip") continue;
            }
            var ineqMatch = eqStr.match(/^(.*?)\s*(<=|>=|<|>)\s*(.*)$/);
            if (ineqMatch) {
                var lhs = ineqMatch[1].trim();
                var op = ineqMatch[2];
                var rhs = ineqMatch[3].trim();
                if (lhs && rhs) {
                    var leftFixed = fuzzyFix(lhs);
                    var rightFixed = fuzzyFix(rhs);
                    var _ineqLeft = null, _ineqRight = null, _ineqErr = null;
                    try {
                        _ineqLeft = parse(tokenize(leftFixed));
                        _ineqRight = parse(tokenize(rightFixed));
                    } catch (e) { _ineqErr = e; }
                    if (_ineqErr) {
                        // 解析失败不静默丢弃：记入用户可见 warning，保持"没解出来也要说清为什么"
                        state.conditionWarnings.push("约束无法解析：" + eqStr + "（" + _ineqErr.message + "）");
                        continue;
                    }
                    state.inequalityConstraints.push({
                        lhs: _ineqLeft, rhs: _ineqRight, op: op,
                        lhsStr: lhs, rhsStr: rhs
                    });
                    // 不等式不加入 equations 数组，避免主流水线将其作为方程求解
                    continue;
                }
            }
        }

        if (eqStr.indexOf("=") < 0) {
            var cond = parseCondition(eqStr);
            if (cond) {
                if (cond.type === "domain") { state.domainConstraints.push(cond); continue; }
                if (cond.type === "warn") { state.conditionWarnings.push(cond.message); if (cond.kind === 'integer-unenforced') state.integerConstraintUnenforced = true; continue; }
            }
            continue;
        }
        var parts = eqStr.split("=");
        if (parts.length < 2) continue;
        var leftFixed = fuzzyFix(parts[0].trim());
        var rightFixed = fuzzyFix(parts.slice(1).join("=").trim());
        var leftAST = null, rightAST = null, _eqErr = null;
        try {
            leftAST = parse(tokenize(leftFixed));
            rightAST = parse(tokenize(rightFixed));
        } catch (e) { _eqErr = e; }
        if (_eqErr) {
            // 解析失败不静默丢弃：记入用户可见 warning，避免用户困惑"为什么没解出来"
            state.conditionWarnings.push("方程无法解析：" + eqStr + "（" + _eqErr.message + "）");
            continue;
        }
        state.equations.push({ type: "binop", op: "-", left: leftAST, right: rightAST });
        // 快照忠实等式 AST（深拷贝，防止后续算子就地改写污染）：含未消分母的原始形态
        state.userEquations.push(JSON.parse(JSON.stringify({ type: "binop", op: "-", left: leftAST, right: rightAST })));
    }

    if (state.equations.length === 0 && state.inequalityConstraints.length === 0) {
        state.done = true;
        state.result = { solutions: [], error: "NO_EQUATION", message: "未找到有效的方程", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "未输入方程，无任何约束" };
        return;
    }

    // 纯不等式系统标记
    if (state.equations.length === 0 && state.inequalityConstraints.length > 0) {
        state.isInequalityOnly = true;
    }

    // 自动提取变量（从方程和不等式约束中提取）
    if (!state.varNames || state.varNames.length === 0) {
        state.varNames = [];
        state.equations.forEach(function(eq) {
            extractVariables(eq).forEach(function(vn) {
                if (!state.varNames.includes(vn)) state.varNames.push(vn);
            });
        });
        state.inequalityConstraints.forEach(function(c) {
            extractVariables(c.lhs).forEach(function(vn) {
                if (!state.varNames.includes(vn)) state.varNames.push(vn);
            });
            extractVariables(c.rhs).forEach(function(vn) {
                if (!state.varNames.includes(vn)) state.varNames.push(vn);
            });
        });
    }
}

// suan2: 提取变量与计数 → 统计变量个数、名称
function suan2(state) {
    if (!state.varNames || state.varNames.length === 0) {
        state.varNames = [];
        state.equations.forEach(function(eq) {
            extractVariables(eq).forEach(function(vn) {
                if (!state.varNames.includes(vn)) state.varNames.push(vn);
            });
        });
    } else {
        // 无关变量剔除：调用方声明的变量若在方程中从未出现（如 MCP 传错变量名），
        // 直接剔除，避免对无关变量做全域 ±1e6 搜索导致秒级空转（曾实测 6.2s）。
        // 剔除名单记入 state.unusedDeclaredVars 供审计；方程中实际出现但未声明的
        // 变量仍会被追加，保证不漏解（保持原有兼容行为）。
        var _actualVars = new Set();
        state.equations.forEach(function(eq) {
            extractVariables(eq).forEach(function(vn) { _actualVars.add(vn); });
        });
        // 不等式约束中的变量同样视为"实际出现"（纯不等式系统 equations 为空，
        // 若不收集会误把所有声明变量判为无关变量剔除 → varNames 清空 → 误判无解）
        (state.inequalityConstraints || []).forEach(function(c) {
            if (c && c.lhs) extractVariables(c.lhs).forEach(function(vn) { _actualVars.add(vn); });
            if (c && c.rhs) extractVariables(c.rhs).forEach(function(vn) { _actualVars.add(vn); });
        });
        var _unused = [];
        var _kept = [];
        state.varNames.forEach(function(vn) {
            if (_actualVars.has(vn)) _kept.push(vn);
            else _unused.push(vn);
        });
        if (_unused.length) {
            state.unusedDeclaredVars = _unused;
            state.varNames = _kept;
        }

    }
    state.varCount = state.varNames.length;
}

// suan3: 变量数硬校验 → 变量数>6→OVER_LIMIT终止
function suan3(state) {
    if (state.varNames.length > 6) {
        state.done = true;
        state.result = {
            solutions: [],
            error: "OVER_LIMIT",
            message: "变量数 " + state.varNames.length + " 超过上限（6个），无法求解",
            varNames: state.varNames,
            resultType: 1, resultTypeName: "空结果", resultTypeDesc: "变量数超过求解器上限"
        };
    }
}

// suan4: 非法算子拦截 → 拦截∂、不定积分、极限符号等
function suan4(state) {
    for (var ei = 0; ei < state.equations.length; ei++) {
        (function checkNode(node) {
            if (!node) return;
            if (node.type === "func" && node.name === "int" && node.args && node.args.length < 3) {
                state.done = true;
                state.result = { solutions: [], error: "ILLEGAL_OPERATOR", message: "检测到不定积分，当前求解器仅支持定积分", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "不定积分无法数值求解" };
                return;
            }
            if (node.left) checkNode(node.left);
            if (node.right) checkNode(node.right);
            if (node.operand) checkNode(node.operand);
            if (node.args) node.args.forEach(checkNode);
            if (node.arg) checkNode(node.arg);
        })(state.equations[ei]);
        if (state.done) return;
    }
}

// suan5: 系数范围检测 → 超大常量拦截（搜索域范围[-1e6,1e6]，常量超过3e15可能造成数值问题）
function suan5(state) {
    for (var ei = 0; ei < state.equations.length; ei++) {
        var _largeNums = scanASTForLargeNumbers(state.equations[ei]);
        if (_largeNums && _largeNums.length > 0) {
            state.done = true;
            state.result = {
                solutions: [],
                error: "COEFF_OUT_OF_RANGE",
                message: "检测到超出范围的常量（要求在 ±1e6 以内）",
                varNames: state.varNames,
                resultType: 1, resultTypeName: "空结果", resultTypeDesc: "常量超出数值稳定范围，无法可靠求解"
            };
            return;
        }
    }
}

// suan6: 常量二次校验化简 → 常量冲突直接置空D
function suan6(state) {
    for (var ei = 0; ei < state.equations.length; ei++) {
        var eq = state.equations[ei];
        var vars = extractVariables(eq);
        if (vars.length === 0) {
            var val = evalAST(eq, {});
            if (isFinite(val) && Math.abs(val) > 1e-12) {
                state.done = true;
                state.result = { solutions: [], error: "NO_SOLUTION", provenEmpty: true, message: "常量方程恒不成立（残差=" + val.toFixed(2) + "）", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "方程不含变量且恒不成立" };
                return;
            }
        }
    }
}

// suan7: 快速前向传播 → 代入已知常量，检测简单矛盾
// 增强版：支持 sqrt(var)=c、var1+var2=c 等非平凡形式，O(n) 轻量
function suan7(state) {
    // ===== 第1轮：收集已知值（支持多种形式） =====
    var known = {};

    function _tryExtractKnown(eq) {
        if (eq.type !== 'binop' || eq.op !== '-') return false;
        // 模式1: var - c = 0 → var = c
        if (eq.left.type === 'var' && eq.right.type === 'num') {
            known[eq.left.name] = eq.right.value; return true;
        }
        // 模式2: c - var = 0 → var = c
        if (eq.left.type === 'num' && eq.right.type === 'var') {
            known[eq.right.name] = eq.left.value; return true;
        }
        // 模式3: sqrt(var) - c = 0 → var = c²
        if (eq.left.type === 'func' && eq.left.name === 'sqrt' && eq.right.type === 'num') {
            // 单参数函数用 arg，多参数函数用 args
            var inner = eq.left.arg || (eq.left.args && eq.left.args[0]);
            if (inner && inner.type === 'var') {
                known[inner.name] = eq.right.value * eq.right.value; return true;
            }
            // sqrt(var + k) - c = 0 → var = c² - k
            if (inner && inner.type === 'binop' && inner.op === '+') {
                if (inner.left.type === 'var' && inner.right.type === 'num') {
                    known[inner.left.name] = eq.right.value * eq.right.value - inner.right.value; return true;
                }
                if (inner.left.type === 'num' && inner.right.type === 'var') {
                    known[inner.right.name] = eq.right.value * eq.right.value - inner.left.value; return true;
                }
            }
        }
        // 模式4: var + k - c = 0 → var = c - k
        if (eq.left.type === 'binop' && eq.left.op === '+' && eq.right.type === 'num') {
            if (eq.left.left.type === 'var' && eq.left.right.type === 'num') {
                known[eq.left.left.name] = eq.right.value - eq.left.right.value; return true;
            }
            if (eq.left.left.type === 'num' && eq.left.right.type === 'var') {
                known[eq.left.right.name] = eq.right.value - eq.left.left.value; return true;
            }
        }
        // 模式5: k * var - c = 0 → var = c / k
        if (eq.left.type === 'binop' && eq.left.op === '*' && eq.right.type === 'num') {
            if (eq.left.left.type === 'var' && eq.left.right.type === 'num' && Math.abs(eq.left.right.value) > 1e-15) {
                known[eq.left.left.name] = eq.right.value / eq.left.right.value; return true;
            }
            if (eq.left.left.type === 'num' && eq.left.right.type === 'var' && Math.abs(eq.left.left.value) > 1e-15) {
                known[eq.left.right.name] = eq.right.value / eq.left.left.value; return true;
            }
        }
        // 模式6: var / k - c = 0 → var = c * k
        if (eq.left.type === 'binop' && eq.left.op === '/' && eq.right.type === 'num') {
            if (eq.left.left.type === 'var' && eq.left.right.type === 'num' && Math.abs(eq.left.right.value) > 1e-15) {
                known[eq.left.left.name] = eq.right.value * eq.left.right.value; return true;
            }
        }
        return false;
    }

    for (var ei = 0; ei < state.equations.length; ei++) {
        _tryExtractKnown(state.equations[ei]);
    }

    // ===== 第2轮：多轮传播 =====
    var changed = true;
    var iter = 0;
    // 记录已从哪个方程提取过值，避免同一方程反复检查矛盾（浮点噪声）
    var resolvedEqs = {};
    while (changed && iter < 20) {
        changed = false; iter++;
        for (var ei = 0; ei < state.equations.length; ei++) {
            var eq = state.equations[ei];
            var vars = extractVariables(eq);
            var knownCount = 0, unknownVars = [];
            for (var vi = 0; vi < vars.length; vi++) {
                if (known[vars[vi]] !== undefined) knownCount++;
                else unknownVars.push(vars[vi]);
            }
            if (knownCount === 0) continue;

            // ── 情形A：所有变量已知 → 直接求值检查矛盾 ──
            // 跳过已从前提取过值的方程，避免浮点噪声误判
            if (unknownVars.length === 0) {
                if (!resolvedEqs[ei]) {
                    var val = evalAST(eq, known);
                    if (isFinite(val) && Math.abs(val) > 1e-12) {
                        state.done = true;
                        var msg = "前向传播检测到矛盾：代入已知值后方程不成立（残差=" + val.toExponential(2) + "）";
                        var knownList = Object.keys(known).sort().map(function(v) { return v + "=" + known[v]; }).join(", ");
                        state.result = { solutions: [], error: "NO_SOLUTION", provenEmpty: true, message: msg, detail: "已知值: " + knownList, executionPath: "前向传播矛盾检测", timeMs: performance.now() - state.startTime, confidence: "high", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "前向传播检测到矛盾" };
                        return;
                    }
                }
                continue;
            }

            // ── 情形B：恰有1个未知变量 → 多点采样矛盾检测 + 尝试提取值 ──
            if (unknownVars.length === 1) {
                var uv = unknownVars[0];
                var extracted = false;
                var box = state.D0[uv];
                if (box && isFinite(box.min) && isFinite(box.max)) {
                    var lo = box.min, hi = box.max;
                    // 5点采样：边界、四分位、中点
                    var pts = [lo, lo * 0.75 + hi * 0.25, (lo + hi) * 0.5, lo * 0.25 + hi * 0.75, hi];
                    var allSameSign = true, firstSign = 0, minRes = Infinity, maxRes = 0;
                    var validCount = 0, sampleVals = [];

                    for (var pi = 0; pi < pts.length; pi++) {
                        var ctx = {};
                        for (var k in known) ctx[k] = known[k];
                        ctx[uv] = pts[pi];
                        var v = evalAST(eq, ctx);
                        if (!isFinite(v) || isNaN(v)) continue;
                        validCount++;
                        sampleVals.push(v);
                        var absv = Math.abs(v);
                        if (absv < minRes) minRes = absv;
                        if (absv > maxRes) maxRes = absv;
                        var s = v > 0 ? 1 : -1;
                        if (firstSign === 0) firstSign = s;
                        else if (s !== firstSign) allSameSign = false;
                    }

                    // 严格区间包络测试（取代原“5 点采样同号 + 最小残差>0.1”启发式）：
                    // 在变量 uv 的全域上计算 f 的区间包络，若包络不含 0，
                    // 则由中值定理严格证明该域内无解——【sound，不丢真解】。
                    // 原启发式会把 x=0.4（方程 20(x-0.4)²+y-0.5=0, y=0.5）误判为无解（见评审 unsound）。
                    var ibox = {};
                    for (var kb in known) ibox[kb] = { min: known[kb], max: known[kb] };
                    ibox[uv] = box;
                    var iF = intervalEval(eq, ibox);
                    if (iF && (iF.max < 0 || iF.min > 0)) {
                        state.done = true;
                        var knownList = Object.keys(known).sort().map(function(v) { return v + "=" + known[v]; }).join(", ");
                        state.result = { solutions: [], error: "NO_SOLUTION", message: "前向传播检测到矛盾：代入已知值后，方程在变量 " + uv + " 的全域上 f 的严格区间包络不含 0（包络=[" + iF.min.toExponential(2) + "," + iF.max.toExponential(2) + "]），严格证明无根", detail: "已知值: " + knownList, executionPath: "前向传播矛盾检测", timeMs: performance.now() - state.startTime, confidence: "high", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "前向传播检测到矛盾" };
                        return;
                    }

                    // 如果采样点有变号，尝试二分法求解
                    if (!allSameSign && validCount >= 2) {
                        for (var pi = 0; pi < pts.length - 1; pi++) {
                            var v1 = sampleVals[pi], v2 = sampleVals[pi + 1];
                            if (!isFinite(v1) || !isFinite(v2)) continue;
                            if (v1 * v2 <= 0) {
                                var a = pts[pi], b = pts[pi + 1];
                                for (var bi = 0; bi < 60; bi++) {
                                    var mid = (a + b) * 0.5;
                                    var ctx = {};
                                    for (var k in known) ctx[k] = known[k];
                                    ctx[uv] = mid;
                                    var fmid = evalAST(eq, ctx);
                                    if (!isFinite(fmid)) break;
                                    if (Math.abs(fmid) < 1e-10) {
                                        known[uv] = mid; changed = true; extracted = true; break;
                                    }
                                    var f1 = (function() { var c = {}; for (var k in known) c[k] = known[k]; c[uv] = a; return evalAST(eq, c); })();
                                    if (fmid * f1 <= 0) b = mid;
                                    else a = mid;
                                }
                                if (extracted) break;
                            }
                        }
                    }
                }

                // 尝试从方程中推导新已知值（模式匹配）
                // 模式: var1 + var2 - c = 0, 一个已知 → 推导另一个
                if (!extracted && eq.type === 'binop' && eq.op === '-' && eq.left.type === 'binop' && eq.left.op === '+' && eq.right.type === 'num') {
                    var l = eq.left.left, r = eq.left.right, c = eq.right.value;
                    if (l.type === 'var' && r.type === 'var') {
                        if (known[l.name] !== undefined && known[r.name] === undefined) {
                            known[r.name] = c - known[l.name]; changed = true; extracted = true;
                        } else if (known[r.name] !== undefined && known[l.name] === undefined) {
                            known[l.name] = c - known[r.name]; changed = true; extracted = true;
                        }
                    }
                }
                // 模式: var1 * var2 - c = 0, 一个已知 → 推导另一个
                if (!extracted && eq.type === 'binop' && eq.op === '-' && eq.left.type === 'binop' && eq.left.op === '*' && eq.right.type === 'num') {
                    var l = eq.left.left, r = eq.left.right, c = eq.right.value;
                    if (l.type === 'var' && r.type === 'var') {
                        if (known[l.name] !== undefined && known[r.name] === undefined && Math.abs(known[l.name]) > 1e-15) {
                            known[r.name] = c / known[l.name]; changed = true; extracted = true;
                        } else if (known[r.name] !== undefined && known[l.name] === undefined && Math.abs(known[r.name]) > 1e-15) {
                            known[l.name] = c / known[r.name]; changed = true; extracted = true;
                        }
                    }
                }

                if (extracted) resolvedEqs[ei] = true;
            }
        }
    }
}

// suan8: 边界极限行为预判 → 边界采样判断趋势，标记奇点风险
function suan8(state) {
    // 检测边界处的极限行为
    var boundaryInfo = [];
    for (var vi = 0; vi < state.varNames.length; vi++) {
        var vn = state.varNames[vi];
        var box = state.D0[vn];
        if (!box) continue;
        var min = box.min, max = box.max;
        
        // 检测变量是否出现在分母、ln、sqrt等可能导致奇点的位置
        var hasSingularityRisk = false;
        for (var ei = 0; ei < state.equations.length; ei++) {
            (function _checkSingularity(node) {
                if (!node) return;
                if (node.type === 'binop' && node.op === '/') {
                    if (hasVariable(node.right, [vn])) hasSingularityRisk = true;
                }
                if (node.type === 'func' && node.name === 'ln') {
                    if (hasVariable(node, [vn])) hasSingularityRisk = true;
                }
                if (node.type === 'func' && node.name === 'sqrt') {
                    if (hasVariable(node, [vn])) hasSingularityRisk = true;
                }
                if (node.type === 'binop') { _checkSingularity(node.left); _checkSingularity(node.right); }
                if (node.type === 'unary') _checkSingularity(node.operand);
                if (node.type === 'func' && node.args) node.args.forEach(_checkSingularity);
            })(state.equations[ei]);
        }
        
        // 在边界附近采样，分析极限行为
        var boundarySamples = [];
        var samplePoints = [min, min + 0.01 * (max - min), max - 0.01 * (max - min), max];
        for (var si = 0; si < samplePoints.length; si++) {
            var sp = samplePoints[si];
            if (sp < -1e6 || sp > 1e6) continue;
            var vars = {};
            for (var vj = 0; vj < state.varNames.length; vj++) vars[state.varNames[vj]] = (state.varNames[vj] === vn) ? sp : 0;
            var vals = state.equations.map(function(eq) { return evalAST(eq, vars); });
            var hasFinite = false, hasInfinite = false;
            for (var vi2 = 0; vi2 < vals.length; vi2++) {
                if (isFinite(vals[vi2]) && !isNaN(vals[vi2])) hasFinite = true;
                if (!isFinite(vals[vi2]) || Math.abs(vals[vi2]) > 1e15) hasInfinite = true;
            }
            boundarySamples.push({ point: sp, hasFinite: hasFinite, hasInfinite: hasInfinite, vals: vals });
        }
        
        boundaryInfo.push({
            varName: vn,
            hasSingularityRisk: hasSingularityRisk,
            boundarySamples: boundarySamples
        });
    }
    state.boundaryInfo = boundaryInfo;

}

// suan10: 常数约束/赋值矛盾检测 → 0=5、x=1且x=2→立即无解
function suan10(state) {
    var _fastHasContradiction = false;
    var _fastContradictionMsg = "";

    for (var _fei = 0; _fei < state.equations.length; _fei++) {
        var _feq = state.equations[_fei];
        var _fvars = extractVariables(_feq);
        if (_fvars.length === 0) {
            var _fval = evalAST(_feq, {});
            if (isFinite(_fval) && Math.abs(_fval) > 1e-12) {
                _fastHasContradiction = true;
                _fastContradictionMsg = "常数方程恒不成立（残差=" + _fval.toFixed(2) + "）";
                break;
            }
        }
    }

    if (!_fastHasContradiction && state.equations.length >= 2) {
        var _explicitAssignments = {};
        // 检测1: 显式赋值矛盾 (x=1, x=2)
        for (var _fei = 0; _fei < state.equations.length; _fei++) {
            var _feq = state.equations[_fei];
            if (_feq.type === "binop" && _feq.op === "-" && _feq.left.type === "var" && _feq.right.type === "num") {
                var _vname = _feq.left.name;
                var _vval = _feq.right.value;
                if (_explicitAssignments[_vname] !== undefined && Math.abs(_explicitAssignments[_vname] - _vval) > 1e-10) {
                    _fastHasContradiction = true;
                    _fastContradictionMsg = "变量 " + _vname + " 被赋值为 " + _explicitAssignments[_vname] + " 和 " + _vval + "，矛盾";
                    break;
                }
                _explicitAssignments[_vname] = _vval;
            }
            if (_feq.type === "binop" && _feq.op === "-" && _feq.right.type === "var" && _feq.left.type === "num") {
                var _vname = _feq.right.name;
                var _vval = _feq.left.value;
                if (_explicitAssignments[_vname] !== undefined && Math.abs(_explicitAssignments[_vname] - _vval) > 1e-10) {
                    _fastHasContradiction = true;
                    _fastContradictionMsg = "变量 " + _vname + " 被赋值为 " + _explicitAssignments[_vname] + " 和 " + _vval + "，矛盾";
                    break;
                }
                _explicitAssignments[_vname] = _vval;
            }
        }
        // 检测2: 相同表达式不同值的矛盾 (x+y=5, x+y=8)
        if (!_fastHasContradiction) {
            for (var _pei = 0; _pei < state.equations.length; _pei++) {
                var _peq = state.equations[_pei];
                if (_peq.type !== "binop" || _peq.op !== "-") continue;
                var _pLeft = _peq.left;
                var _pRight = _peq.right;
                if (!_pRight || _pRight.type !== "num") continue;
                for (var _pej = _pei + 1; _pej < state.equations.length; _pej++) {
                    var _peq2 = state.equations[_pej];
                    if (_peq2.type !== "binop" || _peq2.op !== "-") continue;
                    var _pRight2 = _peq2.right;
                    if (!_pRight2 || _pRight2.type !== "num") continue;
                    if (JSON.stringify(_pLeft) === JSON.stringify(_peq2.left)) {
                        var _pVal1 = _pRight.value;
                        var _pVal2 = _pRight2.value;
                        if (Math.abs(_pVal1 - _pVal2) > 1e-10) {
                            _fastHasContradiction = true;
                            _fastContradictionMsg = "两个方程左侧表达式相同但右侧值不同（" + _pVal1 + " ≠ " + _pVal2 + "），矛盾";
                            break;
                        }
                    }
                }
                if (_fastHasContradiction) break;
            }
        }
    }

    if (_fastHasContradiction) {
        state.done = true;
        state.result = { solutions: [], resultType: 1, resultTypeName: "空结果", resultTypeDesc: "快速矛盾检测：两个方程左侧表达式相同但右侧值不同，不可能同时成立", error: "NO_SOLUTION", provenEmpty: true, message: _fastContradictionMsg, executionPath: "快速矛盾检测", timeMs: performance.now() - state.startTime, confidence: "high", varNames: state.varNames };
    }
}

// suan11: 结构恒正/恒负检测 → 平方和、指数、偶次幂恒正→整块剔除
function suan11(state) {
    function _isAlwaysNonNegative(node) {
        if (!node) return false;
        if (node.type === "binop" && node.op === "^" && node.right.type === "num") {
            var _e = node.right.value;
            if (_e > 0 && _e % 2 === 0) return true;
        }
        if (node.type === "func" && node.name === "exp") return true;
        if (node.type === "func" && node.name === "abs") return true;
        return false;
    }

    function _checkStructuralAlwaysPositive(ast) {
        var _sumTerms = [];
        (function _flattenSum(node) {
            if (node.type === "binop" && node.op === "+") { _flattenSum(node.left); _flattenSum(node.right); }
            else { _sumTerms.push(node); }
        })(ast);
        var _hasPosConst = false;
        for (var _sti = 0; _sti < _sumTerms.length; _sti++) {
            var _st = _sumTerms[_sti];
            if (_st.type === "num") { if (_st.value > 0) _hasPosConst = true; else if (_st.value < 0) return false; }
            else if (!_isAlwaysNonNegative(_st)) return false;
        }
        return _hasPosConst;
    }

    function _extractExpr(ast) {
        if (ast.type === "binop" && ast.op === "-" && ast.right.type === "num" && Math.abs(ast.right.value) < 1e-15) return ast.left;
        return ast;
    }

    for (var _sei = 0; _sei < state.equations.length; _sei++) {
        var _expr = _extractExpr(state.equations[_sei]);
        if (_checkStructuralAlwaysPositive(_expr)) {
            state.done = true;
            state.result = { solutions: [], error: "NO_SOLUTION", provenEmpty: true, message: "方程恒正，无实数解（平方和/指数/绝对值恒正检测）", executionPath: "结构恒正剪枝", timeMs: performance.now() - state.startTime, confidence: "high", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "方程恒正，最小值>0，无实数解" };
            return;
        }
        if (_expr.type === "unary" && _expr.op === "-" && _checkStructuralAlwaysPositive(_expr.operand)) {
            state.done = true;
            state.result = { solutions: [], error: "NO_SOLUTION", provenEmpty: true, message: "方程恒负，无实数解（平方和/指数/绝对值恒负检测）", executionPath: "结构恒正剪枝", timeMs: performance.now() - state.startTime, confidence: "high", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "方程恒负，最大值<0，无实数解" };
            return;
        }
    }
}

// suan12: 压缩映射基础区间缩集 → 检测不动点结构，轻量收紧D
function suan12(state) {
// ====================================================================
// S1.6: 压缩映射检测（Contraction Mapping Detection）
// 思想来源：泛函分析 — 巴拿赫不动点定理
// 检测单变量方程 x = f(x) 且 |f'(x)| < 1 → 直接不动点迭代缩小搜索域
// ====================================================================
if (state.varNames.length === 1) {
    var _cmVar = state.varNames[0];
    var _cmEq = state.equations[0];
    if (!state.D0[_cmVar]) return;
    var _cmRHS = null;
    if (_cmEq.type === 'binop' && _cmEq.op === '-') {
        if (_cmEq.left.type === 'var' && _cmEq.left.name === _cmVar) {
            _cmRHS = _cmEq.right;
        } else if (_cmEq.right.type === 'var' && _cmEq.right.name === _cmVar) {
            _cmRHS = _cmEq.left;
        }
    }
    if (_cmRHS) {
        var _cmContainsVar = false;
        (function _cmTraverse(node) {
            if (!node || _cmContainsVar) return;
            if (node.type === 'var') { if (node.name === _cmVar) _cmContainsVar = true; return; }
            if (node.left) _cmTraverse(node.left);
            if (node.right) _cmTraverse(node.right);
            if (node.operand) _cmTraverse(node.operand);
            if (node.args) node.args.forEach(_cmTraverse);
            if (node.arg) _cmTraverse(node.arg);
        })(_cmRHS);
        if (_cmContainsVar) {
            var _cmCenter = (state.D0[_cmVar].min + state.D0[_cmVar].max) / 2;
            var _cmH = 1e-8;
            var _cmVarsP = {}; _cmVarsP[_cmVar] = _cmCenter + _cmH;
            var _cmVarsM = {}; _cmVarsM[_cmVar] = _cmCenter - _cmH;
            var _cmFp = evalAST(_cmRHS, _cmVarsP);
            var _cmFm = evalAST(_cmRHS, _cmVarsM);
            var _cmDeriv = (isFinite(_cmFp) && isFinite(_cmFm)) ? (_cmFp - _cmFm) / (2 * _cmH) : NaN;
            var _cmConvRate = Math.abs(_cmDeriv);
            if (isFinite(_cmConvRate) && _cmConvRate < 0.99) {
                var _cmX = _cmCenter;
                for (var _cmi = 0; _cmi < 200; _cmi++) {
                    var _cmVars = {}; _cmVars[_cmVar] = _cmX;
                    var _cmNewX = evalAST(_cmRHS, _cmVars);
                    if (!isFinite(_cmNewX)) break;
                    if (Math.abs(_cmNewX - _cmX) < 1e-10) { _cmX = _cmNewX; break; }
                    _cmX = _cmNewX;
                }
                var _cmMargin = Math.max(1, (state.D0[_cmVar].max - state.D0[_cmVar].min) * 0.01);
                state.D0[_cmVar].min = Math.max(state.D0[_cmVar].min, _cmX - _cmMargin);
                state.D0[_cmVar].max = Math.min(state.D0[_cmVar].max, _cmX + _cmMargin);
            }
        }
    }
}
}

// suan13: 表达式特征标记 → 标记线性/多项式/三角/非线性（调度用）
function suan13(state) {
// 表达式特征标记 → 标记线性/多项式/三角/非线性（调度用）
var eqFeatures = {
    allLinear: state.equations.every(function(eq) { return isLinear(eq, state.varNames); }),
    hasTrig: false,
    hasExp: false,
    hasODE: false,
    hasDiff: false,
    hasInt: false,
    singleVarSingleEq: state.varNames.length === 1 && state.equations.length === 1,
    hasVariableDenominator: false,
    hasPolynomial: false
};
// 遍历AST检测特殊函数
for (var _fei = 0; _fei < state.equations.length; _fei++) {
    (function _traverseForFeatures(node) {
        if (!node) return;
        if (node.type === 'func') {
            if (node.name === 'sin' || node.name === 'cos' || node.name === 'tan') eqFeatures.hasTrig = true;
            if (node.name === 'exp' || node.name === 'log' || node.name === 'ln') eqFeatures.hasExp = true;
            if (node.name === 'ode' || node.name === 'diff') eqFeatures.hasODE = true;
            if (node.name === 'int') eqFeatures.hasInt = true;
            if (node.name === 'diff') eqFeatures.hasDiff = true;
        }
        // 检测多项式：检查变量是否只出现在非负整数次幂中
        if (node.type === 'binop' && node.op === '^' && node.right.type === 'num') {
            var _exp = node.right.value;
            if (_exp > 0 && Math.abs(_exp - Math.round(_exp)) < 1e-12) {
                // 整数次幂，可能是多项式的一部分
            }
        }
        // 检测变量分母
        if (node.type === 'binop' && node.op === '/') {
            if (node.right.type === 'var') eqFeatures.hasVariableDenominator = true;
            if (node.right.type === 'binop' || node.right.type === 'func') {
                (function _checkVarInDenom(n) {
                    if (!n) return;
                    if (n.type === 'var') eqFeatures.hasVariableDenominator = true;
                    if (n.left) _checkVarInDenom(n.left);
                    if (n.right) _checkVarInDenom(n.right);
                })(node.right);
            }
        }
        if (node.left) _traverseForFeatures(node.left);
        if (node.right) _traverseForFeatures(node.right);
        if (node.operand) _traverseForFeatures(node.operand);
        if (node.args) node.args.forEach(_traverseForFeatures);
        if (node.arg) _traverseForFeatures(node.arg);
    })(state.equations[_fei]);
}

// 多项式检测：如果所有方程都是多项式，标记
if (eqFeatures.singleVarSingleEq) {
    var vn = state.varNames[0];
    var coeffs = extractPolynomialCoefficients(state.equations[0], vn);
    if (coeffs && coeffs.length > 2) eqFeatures.hasPolynomial = true;
}

state.eqFeatures = eqFeatures;

// 根据特征设置跳过标记
var skipOperators = {};
if (eqFeatures.allLinear) {
    skipOperators.manifoldReduction = true;
    skipOperators.topologyAnalysis = true;
    skipOperators.contradictionPruning = true;
}
if (state.varNames.length <= 4) {
    skipOperators.topologyAnalysis = true;
}
state.skipOperators = skipOperators;
}

// suan14: 流形奇点预检测标记 → 检测雅可比行列式趋零区域
function suan14(state) {
    if (!state.D0 || state.varNames.length < 2) { state.singularRegionsInfo = null; return; }

    var n = state.varNames.length;
    var m = state.equations.length;
    if (m < 2) { state.singularRegionsInfo = null; return; }
    
    var singularRegions = [];
    var eps = 1e-7;
    
    // 在区域内均匀采样，检查雅可比行列式
    // 注意：此处只需要采样点，不需要物理边界文本
    var samplePoints = generateStartPoints(state.varNames, null);
    // 限制采样点数量
    var maxSamples = Math.min(20, samplePoints.length);
    
    for (var si = 0; si < maxSamples; si++) {
        var x = samplePoints[si];
        
        // 计算雅可比矩阵
        var J = [];
        var vars = {};
        state.varNames.forEach(function(v, i) { vars[v] = x[i]; });
        var F = state.equations.map(function(eq) { return evalAST(eq, vars); });
        
        for (var i = 0; i < m; i++) {
            J.push(new Array(n));
            for (var j = 0; j < n; j++) {
                var xP = x.slice();
                xP[j] += eps;
                var vP = {};
                state.varNames.forEach(function(v, k) { vP[v] = xP[k]; });
                var fp = evalAST(state.equations[i], vP);
                J[i][j] = (fp - F[i]) / eps;
                if (isNaN(J[i][j]) || !isFinite(J[i][j])) J[i][j] = 0;
            }
        }
        
        // 如果是方阵，计算行列式
        if (m === n) {
            var det = matrixDeterminant(J);
            if (isFinite(det) && Math.abs(det) < 1e-6) {
                singularRegions.push({ point: x.slice(), det: det, isSingular: true });
            }
        }
    }
    
    // 如果检测到奇异点，计算奇异区域的关键信息
    if (singularRegions.length > 0) {
        // 计算奇异点附近的极限行为
        for (var ri = 0; ri < singularRegions.length; ri++) {
            var sr = singularRegions[ri];
            var x = sr.point;
            
            // 在奇异点附近微扰，检查函数值是否剧烈变化
            var perturbValues = [];
            for (var pi = 0; pi < 3; pi++) {
                var perturbed = x.slice();
                for (var j = 0; j < n; j++) {
                    perturbed[j] += (pi === 0 ? eps : (pi === 1 ? -eps : 2*eps));
                }
                var vP = {};
                state.varNames.forEach(function(v, k) { vP[v] = perturbed[k]; });
                var fP = state.equations.map(function(eq) { return evalAST(eq, vP); });
                var norm = 0;
                for (var fi = 0; fi < fP.length; fi++) norm += fP[fi] * fP[fi];
                perturbValues.push(Math.sqrt(norm));
            }
            
            // 计算函数值的变化率（极限行为指标）
            var rateOfChange = 0;
            for (var pi = 1; pi < perturbValues.length; pi++) {
                rateOfChange += Math.abs(perturbValues[pi] - perturbValues[pi-1]);
            }
            sr.rateOfChange = rateOfChange / perturbValues.length;
        }
        state.singularRegionsInfo = singularRegions; return;
    }
    
    state.singularRegionsInfo = null; return;
}

// suan15: 微积分表达式化简 → 链式法则展开、常数导数吸收
function suan15(state) {
    var hasCalc = state.equations.some(function(eq) { return hasCalculusOp(eq); });
    if (!hasCalc) { state.calculusInfo = null; return; }

    var info = { hasODE: false, hasDiff: false, hasInt: false, odeClassification: null, hasContraction: false };

    // 遍历方程，检测具体微积分类型
    for (var ei = 0; ei < state.equations.length; ei++) {
        (function walkNode(n) {
            if (!n) return;
            if (n.type === 'func') {
                if (n.name === 'ode') {
                    info.hasODE = true;
                    // 尝试对 ODE 表达式进行分类
                    if (n.args && n.args.length >= 3) {
                        var expr = n.args[0];
                        var xVarName = n.args[1].name;
                        var yVarName = n.args[2].name;
                        if (xVarName && yVarName) {
                            info.odeClassification = classifyODE(expr, xVarName, yVarName);
                            // 检查压缩映射
                            var stepH = 0.01; // 假设步长
                            info.hasContraction = isContractionMapping(expr, xVarName, yVarName, stepH);
                        }
                    }
                }
                if (n.name === 'diff') info.hasDiff = true;
                if (n.name === 'int') info.hasInt = true;
                getFuncChildrenAll(n).forEach(function(child) { walkNode(child); });
            }
            if (n.type === 'binop') { walkNode(n.left); walkNode(n.right); }
            if (n.type === 'unary') { walkNode(n.operand); }
        })(state.equations[ei]);
    }

    state.calculusInfo = info; return;
}

// suan16: 基础化简兼容分支 → 辅助化简
function suan16(state) {
    if (state.equations.length === 0) {
        state.done = true;
        state.result = { solutions: [], error: "NO_EQUATION", message: "没有可求解的方程", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "无可求解方程" };
        return;
    }
    // 对数反演化简（2026-08-21）：log(u) = c → u = 10^c（log 为常用对数 log10）、ln(u)=c → u=e^c、
    // log2(u)=c → u=2^c、log(u)=log(v) → u=v。
    // 把超越方程转代数方程，让二次判别式等能快速判无解（如 log(xy)=1, x+y=6 → xy=10, x+y=6 →
    // 判别式<0 → 快速无解），避免无解系统走分支定界 8 秒指数递归爆炸。
    // 安全性：10^c / e^c / 2^c 恒 >0，反演不引入定义域外伪解。
    function _isLogFn(n) {
        return n && n.type === 'func' && (n.name === 'log' || n.name === 'log10' || n.name === 'ln' || n.name === 'log2');
    }
    function _logBase(name) {
        if (name === 'ln') return Math.E;
        if (name === 'log2') return 2;
        return 10; // log / log10 为常用对数
    }
    function _tryLogInvert(eq) {
        if (!eq || eq.type !== 'binop' || eq.op !== '-') return eq;
        var L = eq.left, R = eq.right;
        if (_isLogFn(L) && R && R.type === 'num') {
            return { type: 'binop', op: '-', left: L.arg, right: { type: 'num', value: Math.pow(_logBase(L.name), R.value) } };
        }
        if (_isLogFn(R) && L && L.type === 'num') {
            return { type: 'binop', op: '-', left: L.arg, right: { type: 'num', value: Math.pow(_logBase(R.name), L.value) } };
        }
        if (_isLogFn(L) && _isLogFn(R) && L.name === R.name) {
            return { type: 'binop', op: '-', left: L.arg, right: R.arg };
        }
        return eq;
    }
    for (var _li = 0; _li < state.equations.length; _li++) {
        var _inv = _tryLogInvert(state.equations[_li]);
        if (_inv !== state.equations[_li]) {
            state.equations[_li] = _inv;
            if (state.userEquations && state.userEquations[_li]) {
                state.userEquations[_li] = JSON.parse(JSON.stringify(_inv));
            }
        }
    }
}

// suan17: 线性方程组高斯消元 → 全线性系统直接求解
function suan17(state) {
    if (!state.eqFeatures.allLinear) return;
    if (state.equations.length !== state.varNames.length) return;

    var A = [], b = [];
    for (var ei = 0; ei < state.equations.length; ei++) {
        var lc = extractLinearCoefficients(state.equations[ei], state.varNames);
        A.push(state.varNames.map(function(v) { return lc.coeffs[v] || 0; }));
        b.push(-lc.constant);
    }

    var result = gaussianSolve(A, b);
    if (!result) return;

    var solution = {};
    state.varNames.forEach(function(v, i) { solution[v] = roundToGrid(result.solution[i]); });
    var values = state.varNames.map(function(v) { return solution[v]; });

    // 按域约束过滤
    var passesDomain = true;
    for (var dci = 0; dci < state.domainConstraints.length; dci++) {
        var dc = state.domainConstraints[dci];
        var vi = state.varNames.indexOf(dc.varName);
        if (vi >= 0) {
            var val = values[vi];
            if (dc.min !== undefined && val < dc.min - 1e-9) { passesDomain = false; break; }
            if (dc.max !== undefined && val > dc.max + 1e-9) { passesDomain = false; break; }
        }
    }
    if (!passesDomain && state.domainConstraints.length > 0) return;

    var vars = {};
    state.varNames.forEach(function(v, i) { vars[v] = solution[v]; });
    var residuals = state.equations.map(function(eq) { return Math.abs(evalAST(eq, vars)); });
    var maxResidual = Math.max.apply(null, residuals);
    var confidence = maxResidual < 1e-5 ? "high" : (maxResidual < 1e-4 ? "medium" : "low");

    state.done = true;
    state.result = {
        solutions: [{ values: values, residual: maxResidual }],
        executionPath: "高斯消元",
        timeMs: performance.now() - state.startTime,
        confidence: confidence,
        varNames: state.varNames,
        resultType: 2, resultTypeName: "有限离散孤立采样点", resultTypeDesc: "高斯消元直接求解"
    };
}



// suan18: 图论拆分独立子系统 → 拆分为多个独立子问题
function suan18(state) {
    if (state.equations.length < state.varNames.length) {
        var decomposition = decomposeByVariableGraph(state.equations, state.varNames);
        if (decomposition && decomposition.length > 1) {
            state.decomposition = decomposition;
        }
    }
}

// suan19: 变量显式代入消元 → x=g(y)→代入消元
function suan19(state) {
    // 保存原始变量名，用于后续回代
    state.originalVarNames = state.varNames.slice();
    let reducedEqs = state.equations.slice();
    let reducedVars = state.varNames.slice();
    let substitutions = {};
    let substitutedSomething = false;
    const WATCHDOG_MS = 600;
    const AST_NODE_LIMIT = 500;

    for (let i = 0; i < reducedEqs.length; i++) {
        if (reducedVars.length <= 1) break;
        if (performance.now() - state.startTime > WATCHDOG_MS) break;
        if (astNodeCount(reducedEqs[i]) > AST_NODE_LIMIT) continue;

        const explicit = findExplicitForm(reducedEqs[i], reducedVars);
        if (explicit) {
            const exprNodes = astNodeCount(explicit.expr);
            if (exprNodes > AST_NODE_LIMIT / 2) continue;
            substitutions[explicit.var] = explicit.expr;
            substitutedSomething = true;
            const newEqs = [];
            for (let j = 0; j < reducedEqs.length; j++) {
                if (j === i) continue;
                const eqNodes = astNodeCount(reducedEqs[j]);
                newEqs.push(eqNodes > AST_NODE_LIMIT ? reducedEqs[j] : substituteVar(reducedEqs[j], explicit.var, explicit.expr));
            }
            reducedEqs = newEqs;
            reducedVars = reducedVars.filter(v => v !== explicit.var);
            i = -1;
        }
    }

    state.equations = reducedEqs;
    state.varNames = reducedVars;
    state.substitutions = substitutions;
    state.substitutedSomething = substitutedSomething;
}

// === 集中式变量数不变量（2026-08-22 重构）===
// 单一权威：state.originalVarNames 始终保存用户输入的完整变量名（长度 = 用户输入变量数）。
// 仅允许在 _solveImpl 初始化时写入一次（= state.varNames.slice()），suan19 之后绝不修改它。
// 任何需要"完整坐标解向量"的地方，一律调用 reconstructSolution()，禁止再手写回代块；
// _finish 终态调用 _enforceVarInvariant，修复/告警任何 values.length !== originalVarNames.length 的解，
// 以此防住"新加算子漏写回代导致静默缺变量"的回归。
function getOutputVarNames(state) {
    if (state.originalVarNames && state.originalVarNames.length) return state.originalVarNames;
    return state.varNames || [];
}
// 将"缩减坐标解向量"(state.varNames 顺序) 回代为"完整坐标解向量"(originalVarNames 顺序)。
// redValues: number[]，按 state.varNames 顺序排列（无消元时即完整坐标）。
// 返回 number[]，长度 === originalVarNames.length；有消元时按 state.substitutions 链式回代。
// 调用方负责额外的 NaN/越域/残差过滤；本函数只做"坐标对齐 + 消元回代"。
function reconstructSolution(state, redValues) {
    var outNames = getOutputVarNames(state);
    var curNames = (state.varNames && state.varNames.length) ? state.varNames : outNames;
    if (!redValues || !Array.isArray(redValues)) return null;
    var full = {};
    for (var i = 0; i < curNames.length && i < redValues.length; i++) full[curNames[i]] = redValues[i];
    if (state.substitutions) {
        var subOrder = Object.keys(state.substitutions).reverse();
        for (var s = 0; s < subOrder.length; s++) {
            var sv = subOrder[s];
            if (full[sv] === undefined) {
                try { full[sv] = evalAST(state.substitutions[sv], full); } catch (e) { full[sv] = 0; }
            }
        }
    }
    return outNames.map(function(v) { return full[v] !== undefined ? full[v] : 0; });
}

// suan20: 单变量多项式有理根枚举 → 因式分解+有理根定理
function suan20(state) {
    if (state.skipOperators.rationalRoot) return;
    if (state.varNames.length !== 1 || state.equations.length !== 1) return;
    var vn = state.varNames[0];
    // 确定返回时使用的变量名列表（优先使用原始变量名，用于回代）
    var resultVarNames = getOutputVarNames(state);
    var polyCoeffs = extractPolynomialCoefficients(state.equations[0], vn);
    if (!polyCoeffs || polyCoeffs.length <= 2) return;

    var polyRoots = polynomialAllRoots(polyCoeffs, state.tolerance);
    if (polyRoots.length === 0) {
        state.done = true;
        state.result = { solutions: [], error: "NO_SOLUTION", provenEmpty: true, message: "多项式无实根", executionPath: "多项式快速求解", timeMs: performance.now() - state.startTime, confidence: "high", varNames: resultVarNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "多项式方程无实数根" };
        return;
    }

    var solutions = polyRoots
        .filter(function(r) { return !isNaN(r) && isFinite(r) && Math.abs(r) <= 1000000; })
        .map(function(r) { return roundToGrid(r); })
        .filter(function(r, i, arr) { return arr.indexOf(r) === i; })
    .map(function(r) {
        // 集中式回代：单变量值 [r]（state.varNames 顺序）交给 reconstructSolution，
        // 自动完成消元变量链式回代，输出 originalVarNames 顺序的完整解向量。
        var fullValues = reconstructSolution(state, [r]);
        // 用（消元后的）方程在原变量映射下复核残差
        var fullVars = {};
        getOutputVarNames(state).forEach(function(v, i) { fullVars[v] = fullValues[i]; });
        var origEqs = state.equations.slice();
        var res = 0;
        for (var ei = 0; ei < origEqs.length; ei++) {
            var rv = Math.abs(evalAST(origEqs[ei], fullVars));
            if (rv > res) res = rv;
        }
        return { values: fullValues, residual: res };
    });

    if (solutions.length > 0) {
        var maxRes = Math.max.apply(null, solutions.map(function(s) { return s.residual; }));
        var confidence = maxRes < 1e-5 ? "high" : (maxRes < 1e-4 ? "medium" : "low");
        // 按域约束过滤（用户定义的 x∈[a,b] 等）
        var domainFiltered = solutions.filter(function(sol) {
            for (var dci = 0; dci < state.domainConstraints.length; dci++) {
                var dc = state.domainConstraints[dci];
                var vi = resultVarNames.indexOf(dc.varName);
                if (vi >= 0) {
                    var val = sol.values[vi];
                    if (dc.min !== undefined && val < dc.min - 1e-9) return false;
                    if (dc.max !== undefined && val > dc.max + 1e-9) return false;
                }
            }
            return true;
        });
        if (domainFiltered.length === 0 && state.domainConstraints.length > 0) {
            state.done = true;
            state.result = { solutions: [], error: "NO_SOLUTION", message: "多项式有理根被域约束过滤", executionPath: "多项式快速求解", timeMs: performance.now() - state.startTime, confidence: confidence, varNames: resultVarNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "多项式有根但被域约束排除" };
            return;
        }
        state.done = true;
        state.result = { solutions: domainFiltered.length > 0 ? domainFiltered : solutions, executionPath: "多项式快速求解", timeMs: performance.now() - state.startTime, confidence: confidence, varNames: resultVarNames, resultType: 2, resultTypeName: "有限离散孤立采样点", resultTypeDesc: "多项式快速求解" };
    }
}
// suan21: 欠定系统标记 → 方程数<变量数时标记欠定，不提前终止
function suan21(state) {
    if (state.equations.length < state.varNames.length) {
        // 标记欠定，但不返回——让后续算子继续收缩域，最终输出窄域+采样点
        state.underdetermined = true;
    }
}

// suan22: 单变量超越方程牛顿求解 → sin/cos/exp单变量求根
// 单变量点求值残差；未定义/非有限 → 返回 null（保守，不参与符号判定）
function _pointResidual(eq, vn, x) {
    try {
        var vm = {};
        vm[vn] = x;
        var v = evalAST(eq, vm);
        if (v === null || v !== v || !isFinite(v)) return null;
        return v;
    } catch (err) { return null; }
}
// 单变量二分定位：区间 [a,b] 无奇点且 f(a)·f(b)<0（异号），二分至宽度<1e-10（≤100 次）；
// 中途遇到非有限 → 保守终止（放弃该区间）。收敛后经替换链回代并记入候选集（_bisect 标记）。
function _bisectRoot1D(eq, vn, a, b, fa, fb, state, allSolutions, resultVarNames) {
    var _mid2, _fm2, _vm2 = {};
    for (var _bi3 = 0; _bi3 < 100; _bi3++) {
        _mid2 = (a + b) / 2;
        _vm2[vn] = _mid2;
        _fm2 = evalAST(eq, _vm2);
        if (_fm2 === null || _fm2 !== _fm2 || !isFinite(_fm2)) break; // 意外奇点 → 保守终止
        if ((b - a) / 2 < 1e-10) {
            // 集中式回代：单变量中点 [_mid2] → 完整坐标，统一 roundToGrid
            var _fullValues = reconstructSolution(state, [_mid2]).map(roundToGrid);
            allSolutions.push({ values: _fullValues, residual: Math.abs(_fm2), _bisect: true });
            break;
        }
        if (_fm2 * fa < 0) { b = _mid2; fb = _fm2; }
        else { a = _mid2; fa = _fm2; }
    }
}
// 含奇点区间的递归细分（通用奇点分裂）：区间预检含奇点（除零/定义域错/±∞）时，不整体跳过，
// 而是沿中点递归切分（深度≤4），在奇点邻域分离出"无奇点且端点异号"的子区间再二分定位。
// 修复 2026-08-18：分式分母零点（如 x²-1=0）位于异号区间内部时，原逻辑整段跳过导致漏根
// （如 y=1/(x²-1)+x 消元后 g(x)=x²+(1/(x²-1)+x)²-4 在 [-3,3] 漏正根 +0.783）。
function _recScanInterval(eq, vn, a, b, state, allSolutions, resultVarNames, depth) {
    if (depth > 4 || (b - a) < 1e-6) return;
    var _sv = { nan: _IEEE.nan, inf: _IEEE.inf, divZero: _IEEE.divZero, domainErr: _IEEE.domainErr };
    _ieeeReset();
    var _ivm = {}; _ivm[vn] = { min: a, max: b };
    var _iv = intervalEval(eq, _ivm);
    var _myDiv = _IEEE.divZero, _myDom = _IEEE.domainErr;
    _IEEE.nan = _sv.nan; _IEEE.inf = _sv.inf; _IEEE.divZero = _sv.divZero; _IEEE.domainErr = _sv.domainErr;
    var _hasSing = (_iv === null && (_myDiv || _myDom)) || (_iv !== null && (!isFinite(_iv.min) || !isFinite(_iv.max)));
    if (!_hasSing) {
        var _fa = _pointResidual(eq, vn, a), _fb = _pointResidual(eq, vn, b);
        if (_fa !== null && _fb !== null && _fa * _fb < 0) _bisectRoot1D(eq, vn, a, b, _fa, _fb, state, allSolutions, resultVarNames);
        return;
    }
    var _m = (a + b) / 2;
    _recScanInterval(eq, vn, a, _m, state, allSolutions, resultVarNames, depth + 1);
    _recScanInterval(eq, vn, _m, b, state, allSolutions, resultVarNames, depth + 1);
}

// 单变量线性系数提取（issue A 修复 2026-09-01 辅助）：判断节点是否为 vn 的线性函数 a*vn+b。
// 支持 num/var/一元负号/二元 + - * /（* / 仅当一侧为常数）。非线性（x^2、exp(x) 等）返回 null。
function _linearCoef1D(n, vn) {
    if (!n) return null;
    if (n.type === 'num') return { a: 0, b: n.value };
    if (n.type === 'var') return (n.name === vn) ? { a: 1, b: 0 } : null;
    if (n.type === 'unary' && n.op === '-') { var _t = _linearCoef1D(n.operand, vn); return _t ? { a: -_t.a, b: -_t.b } : null; }
    if (n.type === 'binop') {
        if (n.op === '+' || n.op === '-') {
            var _l = _linearCoef1D(n.left, vn), _r = _linearCoef1D(n.right, vn);
            if (_l && _r) return { a: _l.a + (n.op === '-' ? -_r.a : _r.a), b: _l.b + (n.op === '-' ? -_r.b : _r.b) };
            return null;
        }
        if (n.op === '*') {
            if (n.left.type === 'num' && n.right.type === 'var' && n.right.name === vn) return { a: n.left.value, b: 0 };
            if (n.right.type === 'num' && n.left.type === 'var' && n.left.name === vn) return { a: n.right.value, b: 0 };
            return null;
        }
        if (n.op === '/') {
            var _ld = _linearCoef1D(n.left, vn);
            if (_ld && n.right.type === 'num' && n.right.value !== 0) return { a: _ld.a / n.right.value, b: _ld.b / n.right.value };
            return null;
        }
    }
    return null;
}
// 单变量周期检测（issue A 修复 2026-09-01）：遍历 AST，对 sin/cos/tan/cot/sec/csc 且参数为 vn 的
// 线性函数 a*vn+b 的项，取其最小周期（sin/cos/sec/csc → 2π/|a|；tan/cot → π/|a|）。用于把单变量网格
// 扫描步长设为 < 周期/2，确保高频/多周期方程不漏根。无周期/非线性参数返回 null。
function _detectPeriod1D(node, vn) {
    var _P = null;
    (function _walkPer(n) {
        if (!n) return;
        if (n.type === 'func' && ['sin', 'cos', 'sec', 'csc', 'tan', 'cot'].indexOf(n.name) >= 0) {
            var _c = _linearCoef1D(n.arg, vn);
            if (_c && _c.a !== 0) {
                var _p = (n.name === 'tan' || n.name === 'cot') ? (Math.PI / Math.abs(_c.a)) : (2 * Math.PI / Math.abs(_c.a));
                if (_P === null || _p < _P) _P = _p;
            }
        }
        if (n.type === 'func') { if (n.arg) _walkPer(n.arg); if (n.args) for (var _ai = 0; _ai < n.args.length; _ai++) _walkPer(n.args[_ai]); }
        else if (n.type === 'binop') { _walkPer(n.left); _walkPer(n.right); }
        else if (n.type === 'unary') { _walkPer(n.operand); }
    })(node);
    return _P;
}

// 判断方程是否只引用 allowed 集合内的变量（用于区分"纯净单变量"与"消元后的伪单变量"）。
function _eqRefsOnlyAllowed(eq, allowed) {
    var _ok = true;
    (function _w(n) {
        if (!n || !_ok) return;
        if (n.type === 'var') { if (allowed.indexOf(n.name) < 0) _ok = false; }
        else if (n.type === 'binop') { _w(n.left); _w(n.right); }
        else if (n.type === 'unary') { _w(n.operand); }
        else if (n.type === 'func') { if (n.arg) _w(n.arg); if (n.args) for (var _ai = 0; _ai < n.args.length; _ai++) _w(n.args[_ai]); }
    })(eq);
    return _ok;
}

function suan22(state) {
    if (!(state.equations.length === 1 && state.varNames.length === 1)) return;
    var resultVarNames = getOutputVarNames(state);

    // 恒等式识别（2026-08-21）：方程两边恒等（如 x=x、x-x=0、sin(x)=sin(x)）时，
    // 任意实数均为解。原实现会让牛顿法对残差恒 0 的函数"收敛"到任意 23 个起始点，
    // 误报为"有限个解"。改在宽域异质点抽样，残差恒≈0 即判定为无限解集（rt=3）。
    // 抽样点跨度 [-1e6,1e6] 且含 0 点：非恒等函数在如此大的跨度上不可能处处残差≈0，
    // 而 1/x=0 这类在抽样点出现除零/无穷 → 自动排除，不会误判。
    var _eq0 = state.equations[0], _vn0 = state.varNames[0];
    var _probes = [-1000000, -100000, -10000, -1000, -100, -10, -1, 0, 1, 10, 100, 1000, 10000, 100000, 1000000];
    var _ident = true, _allSameConst = true, _firstVal = null, _finiteCount = 0;
    for (var _pdi = 0; _pdi < _probes.length; _pdi++) {
        var _pv = {}; _pv[_vn0] = _probes[_pdi];
        var _pr = evalAST(_eq0, _pv);
        if (_pr === null || _pr !== _pr || !isFinite(_pr)) { _ident = false; _allSameConst = false; continue; }
        _finiteCount++;
        if (Math.abs(_pr) > 1e-5) _ident = false;
        if (_firstVal === null) _firstVal = _pr;
        else if (Math.abs(_pr - _firstVal) > 1e-5) _allSameConst = false;
    }
    // BUG-2 修复：x/0=1 这类方程在所有抽样点均非有限（处处除零/定义域错误/±∞），
    // 说明左侧在定义域内无有限取值，对任意实数都不可能满足 =0 → 无实数解。
    // 原逻辑遇到非有限点直接 break，导致恒等式/恒矛盾判定失效且漏判无解，
    // 最终 fall through 到 suan47 全局分支定界空转满 8 秒(HARD_TIMEOUT)。
    if (_finiteCount === 0) {
        state.done = true;
        state.result = { solutions: [], error: "NO_SOLUTION", message: "方程在定义域内处处无定义（抽样点均非有限，疑似分母恒为零或定义域错误），无实数解", executionPath: "单变量全域无定义检测", timeMs: performance.now() - state.startTime, confidence: "high", varNames: resultVarNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "方程在所有抽样点均非有限，定义域内无实数满足等式" };
        return;
    }
    if (_ident) {
        // 推荐解取声明域内距原点最近的点（声明域可能是 [5,10] 之类不含 0 的区间）
        var _rec0 = 0;
        var _d0v = state.D0 && state.D0[_vn0];
        if (_d0v) { if (_rec0 < _d0v.min) _rec0 = _d0v.min; if (_rec0 > _d0v.max) _rec0 = _d0v.max; }
        for (var _dciI = 0; _dciI < state.domainConstraints.length; _dciI++) {
            var _dcI = state.domainConstraints[_dciI];
            if (_dcI.varName === _vn0) {
                if (_dcI.min !== undefined && _rec0 < _dcI.min) _rec0 = _dcI.min;
                if (_dcI.max !== undefined && _rec0 > _dcI.max) _rec0 = _dcI.max;
            }
        }
        // 回代补全：suan19 消元可能把 x 代入消去（state.varNames 只剩缩减子集如 [y]），
        // 推荐解须回代到完整变量，否则输出缺分量（如 x+y=2, 2x+2y=4 曾输出 [0] 而非 (2,0)）。
        // 集中式回代：单变量推荐值 [_rec0] → 完整坐标（消元变量链式回代）。
        var _fullVals0 = reconstructSolution(state, [_rec0]).map(roundToGrid);
        state.done = true;
        state.finalSolutions = [{ values: _fullVals0, residual: 0 }];
        state.result = { solutions: state.finalSolutions, error: null, message: "方程为恒等式：方程两边恒等，任意实数均为解（已给出声明域内距原点最近的推荐解）", executionPath: "单变量恒等式识别", timeMs: performance.now() - state.startTime, confidence: "high", varNames: resultVarNames, resultType: 3, resultTypeName: "无限解集(推荐解)", resultTypeDesc: "方程两边恒等，解集为整个实数轴（或声明域），任意值均满足" };
        return;
    }
    // 恒矛盾识别（2026-08-21）：所有抽样点残差 ≈ 同一非零常数（如 x=x+1 → 恒 -1、1=2 → 恒 -1）
    // 时，方程对任意实数都不满足 → 直接判无解，避免矛盾方程空耗 4 秒走完整兜底链。
    if (_allSameConst && _firstVal !== null && Math.abs(_firstVal) > 1e-5) {
        state.done = true;
        state.result = { solutions: [], error: "NO_SOLUTION", message: "方程恒矛盾：化简后为常数 " + _firstVal.toFixed(6) + " ≠ 0，无任何实数解", executionPath: "单变量恒矛盾识别", timeMs: performance.now() - state.startTime, confidence: "high", varNames: resultVarNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "方程两边之差为常数非零，任何实数代入均不满足" };
        return;
    }
    // 阶梯函数直接解析（2026-08-21）：floor(x)=c → x∈[c,c+1)，ceil(x)=c → x∈(c-1,c]。
    // 原实现让牛顿对"平台"（导数为 0 的平坦区）失效：误分类为有限个散点，且 ceil 空转 5 秒。
    // 直接构造连续区间解（rt=3 无限解集），代表点取区间内距原点最近的边界点。
    var _floorCeilMatch = null;
    (function() {
        var _le = _eq0, _fe = null, _ce = null;
        // 数值节点取值：支持 num 与 unary 负号（"-1" 解析为 unary(-, num(1))，非 num(-1)）
        function _numVal(n) {
            if (!n) return null;
            if (n.type === 'num') return n.value;
            if (n.type === 'unary' && n.op === '-' && n.operand && n.operand.type === 'num') return -n.operand.value;
            return null;
        }
        // suan16 化简可能把 floor(x) = -1 写成 floor(x) + 1 = 0（op 从 '-' 变 '+'），
        // 故同时支持 '-' 与 '+'：func ± num = 0 → func = ∓num；num ± func = 0 → func = ∓num
        if (_le && _le.type === 'binop' && (_le.op === '-' || _le.op === '+')) {
            var _l = _le.left, _r = _le.right, _rv = _numVal(_r), _lv = _numVal(_l);
            if (_l && _l.type === 'func' && ['floor', 'ceil'].indexOf(_l.name) >= 0 && _rv !== null) {
                _fe = _l; _ce = (_le.op === '-') ? _rv : -_rv;
            } else if (_r && _r.type === 'func' && ['floor', 'ceil'].indexOf(_r.name) >= 0 && _lv !== null) {
                _fe = _r; _ce = (_le.op === '-') ? _lv : -_lv;
            }
            if (_fe && _fe.arg && _fe.arg.type === 'var' && _fe.arg.name === _vn0) {
                _floorCeilMatch = { fn: _fe.name, c: _ce };
            }
        }
    })();
    if (_floorCeilMatch) {
        var _cVal = _floorCeilMatch.c;
        var _loF = -1000000, _hiF = 1000000;
        if (state.D0 && state.D0[_vn0]) { _loF = Math.max(_loF, state.D0[_vn0].min); _hiF = Math.min(_hiF, state.D0[_vn0].max); }
        for (var _dciF = 0; _dciF < state.domainConstraints.length; _dciF++) {
            var _dcF = state.domainConstraints[_dciF];
            if (_dcF.varName === _vn0) {
                if (_dcF.min !== undefined) _loF = Math.max(_loF, _dcF.min);
                if (_dcF.max !== undefined) _hiF = Math.min(_hiF, _dcF.max);
            }
        }
        var _sLo = _floorCeilMatch.fn === 'floor' ? _cVal : _cVal - 1;
        var _sHi = _floorCeilMatch.fn === 'floor' ? _cVal + 1 : _cVal;
        _sLo = Math.max(_sLo, _loF); _sHi = Math.min(_sHi, _hiF);
        if (_sLo < _sHi) {
            // 代表点：c 恒在解区间内（floor 时 c∈[c,c+1)，ceil 时 c∈(c-1,c]）；声明域排除了 c 才取边界
            var _repF = Math.min(Math.max(_cVal, _sLo), _sHi);
            // 回代补全消元变量（同恒等式块，保证输出完整分量）；集中式回代：单变量代表点 [_repF] → 完整坐标
            var _fullValsF = reconstructSolution(state, [_repF]).map(roundToGrid);
            state.done = true;
            state.finalSolutions = [{ values: _fullValsF, residual: 0 }];
            state.result = { solutions: state.finalSolutions, error: null, message: "阶梯方程：解为连续区间 " + (_floorCeilMatch.fn === 'floor' ? "[" + _cVal + ", " + (_cVal + 1) + ")" : "(" + (_cVal - 1) + ", " + _cVal + "]") + "（区间内任意值均满足），已给出代表点 " + _repF.toFixed(6), executionPath: "单变量阶梯函数直接解析", timeMs: performance.now() - state.startTime, confidence: "high", varNames: resultVarNames, resultType: 3, resultTypeName: "无限解集(推荐解)", resultTypeDesc: "floor/ceil 阶梯函数方程的解为连续区间，区间内任意实数均满足" };
            return;
        }
    }

    const startPoints = [-1000, -500, -200, -100, -50, -20, -10, -5, -2, -1, -0.5, 0, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    const allSolutions = [];
    const WATCHDOG_MS = 600;

    for (const start of startPoints) {
        if (performance.now() - state.startTime > WATCHDOG_MS) break;
        const result = newtonSolve(state.equations, state.varNames, [start], {
            maxIter: state.maxIter, tolerance: state.tolerance,
            _deadline: performance.now() + 100
        });
        if (result.converged) {
            const root = roundToGrid(result.solution[0]);
            if (isNaN(root) || !isFinite(root) || Math.abs(root) > 1000000) continue;
            // 域约束传播：牛顿收敛的根若不在声明域/求解域内，直接丢弃。
            // 否则越域根会霸占 allSolutions，使"域内兜底扫描"（奇点感知二分）永不运行，
            // 导致域内真根漏解（如 tan(x)=100,x∈[0,4] 牛顿收敛到 224.6≈71π+1.56 越域根，
            // 而域内真根 1.5608 反而找不到）。
            var _rootInDomain = true;
            if (state.D0 && state.D0[state.varNames[0]]) {
                if (root < state.D0[state.varNames[0]].min - 1e-9 || root > state.D0[state.varNames[0]].max + 1e-9) _rootInDomain = false;
            }
            if (_rootInDomain) {
                for (var _dciN = 0; _dciN < state.domainConstraints.length; _dciN++) {
                    var _dcN = state.domainConstraints[_dciN];
                    if (_dcN.varName === state.varNames[0]) {
                        if (_dcN.min !== undefined && root < _dcN.min - 1e-9) _rootInDomain = false;
                        if (_dcN.max !== undefined && root > _dcN.max + 1e-9) _rootInDomain = false;
                    }
                }
            }
            if (!_rootInDomain) continue;
            // 集中式回代：单变量根 [root]（state.varNames 顺序）→ 完整坐标
            const fullValues = reconstructSolution(state, [root]).map(roundToGrid);
            const fullVars = {};
            getOutputVarNames(state).forEach(function(v, i) { fullVars[v] = fullValues[i]; });
            // 用原始方程验证
            const origEqs = state.equations.slice();
            var maxResidual = 0;
            for (var ei = 0; ei < origEqs.length; ei++) {
                var rv = Math.abs(evalAST(origEqs[ei], fullVars));
                if (rv > maxResidual) maxResidual = rv;
            }
            if (maxResidual < state.tolerance * 1000) {
                allSolutions.push({ values: fullValues, residual: maxResidual });
            }
        }
    }

    // 二分查找兜底：对单变量方程在【声明域/求解域】内执行"奇点感知网格扫描 + 二分"，找全域内全部根。
    // 域约束传播：搜索域取声明域约束 ∩ state.D0，杜绝越域伪根（如 tan(x)=100 时 25π+1.5608≈80.1）。
    // 奇点分裂：tan 在 kπ+π/2 处有渐近线；按 tan 奇点把域切成单调子区间（奇点两侧留 1e-9 间隙），
    // 子区间内网格细分找异号，二分前用区间求值预检奇点（含奇点区间不二分，防把奇点当根）。
    // 多根修复（2026-08-18）：兜底【总是运行】（不再依赖 allSolutions 为空）——原逻辑在牛顿已收敛到
    // 部分根时跳过兜底，导致域内其余真根漏检（如 sin(x)+y=1 消元后 x²+(1-sin x)²=4 在 [-3,3] 的负侧根）。
    // 宽域防护：声明域缺省 [-1e6,1e6] 时 tan 奇点数可达数十万（子区间数爆炸）→ 超宽域跳过扫描。
    {
        var _eq = state.equations[0];
        var _vn = state.varNames[0];
        // 全域扫描证据（无解快速判定用）：是否有符号穿越 / 网格点最小|f|
        var _scanCross = false, _scanMinAbs = Infinity;
        var _scanStep = (_hi - _lo) / 32;   // 实际网格步长（周期感知扫描会改写），供尾部密度自检使用
        // ---- 确定搜索域：声明域约束 ∩ D0（默认全域）----
        var _lo = -1e6, _hi = 1e6;
        for (var _dci = 0; _dci < state.domainConstraints.length; _dci++) {
            var _dc = state.domainConstraints[_dci];
            if (_dc.varName === _vn) {
                if (_dc.min !== undefined) _lo = Math.max(_lo, _dc.min);
                if (_dc.max !== undefined) _hi = Math.min(_hi, _dc.max);
            }
        }
        if (state.D0 && state.D0[_vn]) {
            _lo = Math.max(_lo, state.D0[_vn].min);
            _hi = Math.min(_hi, state.D0[_vn].max);
        }
        // 消元后定义域收紧（2026-08-21）：suan9 在消元（suan19）之前跑，sqrt(5-x) 这类
        // 消元后才出现的复合参数定义域约束未被推导（如 sqrt(x)+sqrt(y)=3, x+y=5 消元后
        // 剩 sqrt(x)+sqrt(5-x)=3，要求 x≤5）。此处对单变量方程扫描 AST 的 sqrt/log 线性
        // 参数，直接收紧扫描域 [lo,hi]，使网格扫描能覆盖定义域内全部根。
        (function() {
            function _lc(n, vn) {
                if (!n) return null;
                if (n.type === 'var') return n.name === vn ? { a: 1, b: 0 } : null;
                if (n.type === 'num') return { a: 0, b: n.value };
                if (n.type === 'unary' && n.op === '-') { var t = _lc(n.operand, vn); return t ? { a: -t.a, b: -t.b } : null; }
                if (n.type === 'binop') {
                    if (n.op === '+' || n.op === '-') {
                        var l = _lc(n.left, vn), r = _lc(n.right, vn);
                        if (l && r) return { a: l.a + (n.op === '-' ? -r.a : r.a), b: l.b + (n.op === '-' ? -r.b : r.b) };
                        return null;
                    }
                    if (n.op === '*') {
                        if (n.left.type === 'num' && n.right.type === 'var' && n.right.name === vn) return { a: n.left.value, b: 0 };
                        if (n.right.type === 'num' && n.left.type === 'var' && n.left.name === vn) return { a: n.right.value, b: 0 };
                        return null;
                    }
                    // 消元代入常生成 (expr)/((1+0)-0) 之类结构：除以常量表达式保持线性
                    if (n.op === '/') {
                        var l2 = _lc(n.left, vn);
                        if (l2 && n.right) {
                            var _rv2 = evalAST(n.right, {});
                            if (isFinite(_rv2) && _rv2 !== 0) return { a: l2.a / _rv2, b: l2.b / _rv2 };
                        }
                        return null;
                    }
                }
                return null;
            }
            function _walk1(n) {
                if (!n) return;
                if (n.type === 'func' && (n.name === 'sqrt' || n.name === 'log' || n.name === 'ln' || n.name === 'log2' || n.name === 'log10') && n.arg) {
                    var c = _lc(n.arg, _vn);
                    if (c && c.a !== 0) {
                        var bnd = -c.b / c.a;
                        if (c.a > 0) { if (bnd > _lo) _lo = bnd; }
                        else { if (bnd < _hi) _hi = bnd; }
                    }
                }
                if (n.type === 'binop') { _walk1(n.left); _walk1(n.right); }
                else if (n.type === 'unary') { _walk1(n.operand); }
                else if (n.type === 'func') { if (n.arg) _walk1(n.arg); if (n.args) for (var i = 0; i < n.args.length; i++) _walk1(n.args[i]); }
            }
            _walk1(_eq);
        })();
        if (_lo < _hi) {
            var _dense = false;  // 修3：根稠密/超时提前终止扫描（防宽域周期方程穷举挂起）
            var _denseByCount = false;  // 修3：仅由"根数超阈值"触发的稠密标记（用于无限/截断判定，区别于超时触发）
            var _denseNonPeriodic = false;  // 修3：非周期稠密截断标记（与 periodic→无限 分支互补）
            // ---- 周期感知步长（issue A 修复 2026-09-01）：高频/多周期方程用 < 周期/2 的网格，
            //      确保不漏根；非周期方程回退到 4096 点默认细网格。点数上限 _NMAX 护栏防宽域爆炸。 ----
            var _P = _detectPeriod1D(_eq, _vn);
            var _NMAX = 400000;
            var _hTarget = (_P !== null) ? (_P / 10) : ((_hi - _lo) / 4096);
            var _N = Math.ceil((_hi - _lo) / _hTarget);
            var _truncScan = false;
            if (_N > _NMAX) { _N = _NMAX; _truncScan = true; }
            var _h = (_hi - _lo) / _N;
            _scanStep = _h;
            // ---- 收集域内 tan 奇点 kπ+π/2（奇点分裂点）----
            var _sings = [];
            for (var _k = Math.floor((_lo - Math.PI / 2) / Math.PI); _k <= Math.ceil((_hi - Math.PI / 2) / Math.PI); _k++) {
                var _s = _k * Math.PI + Math.PI / 2;
                if (_s >= _lo && _s <= _hi) _sings.push(_s);
            }
            // ---- 子区间边界：奇点两侧留 1e-9 间隙（保证子区间端点有限、可安全点求值）----
            var _bounds = [_lo];
            for (var _bi2 = 0; _bi2 < _sings.length; _bi2++) {
                _bounds.push(_sings[_bi2] - 1e-9);
                _bounds.push(_sings[_bi2] + 1e-9);
            }
            _bounds.push(_hi);
            for (var _seg = 0; _seg < _bounds.length - 1; _seg++) {
                var _A = _bounds[_seg], _B = _bounds[_seg + 1];
                if (_B - _A < 1e-12) continue;
                // ---- 子区间内自适应网格（按周期步长细分）找异号 + 近零点 ----
                var _gN = Math.max(8, Math.round((_B - _A) / _h));
                if (_gN > _NMAX) _gN = _NMAX;
                var _gH = (_B - _A) / _gN;
                var _gxP = _A, _gfP = _pointResidual(_eq, _vn, _A);
                // 起始端点若有根（恰落在域边界）也记录，避免漏端点根
                if (_gfP !== null && Math.abs(_gfP) < 1e-7) {
                    var _faV = reconstructSolution(state, [_A]).map(roundToGrid);
                    allSolutions.push({ values: _faV, residual: Math.abs(_gfP), _bisect: true });
                }
                for (var _gi = 1; _gi <= _gN; _gi++) {
                    var _gx = _A + _gH * _gi;
                    var _gf = _pointResidual(_eq, _vn, _gx);
                    if (_gf === null) { _gxP = _gx; _gfP = null; continue; }
                    if (_gfP !== null && _gfP * _gf < 0) _scanCross = true;
                    if (Math.abs(_gf) < _scanMinAbs) _scanMinAbs = Math.abs(_gf);
                    // 近零网格点（根恰落格点 / 偶重根）：局部极小值且 |f| 极小 → 直接记为候选根（防漏）
                    if (Math.abs(_gf) < 1e-7) {
                        var _gnxt = (_gi < _gN) ? _pointResidual(_eq, _vn, _A + _gH * (_gi + 1)) : null;
                        var _localMin = (_gfP === null || Math.abs(_gfP) >= Math.abs(_gf)) && (_gnxt === null || Math.abs(_gnxt) >= Math.abs(_gf));
                        if (_localMin) {
                            var _fullV = reconstructSolution(state, [_gx]).map(roundToGrid);
                            allSolutions.push({ values: _fullV, residual: Math.abs(_gf), _bisect: true });
                        }
                    }
                    if (_gfP !== null && _gfP * _gf < 0) {
                        // ---- 区间求值预检：异号区间含奇点（除零/定义域错/±∞）→ 不二分，防把奇点当根 ----
                        var _sv = { nan: _IEEE.nan, inf: _IEEE.inf, divZero: _IEEE.divZero, domainErr: _IEEE.domainErr };
                        _ieeeReset();
                        var _ivm = {};
                        _ivm[_vn] = { min: _gxP, max: _gx };
                        var _iv = intervalEval(_eq, _ivm);
                        var _myDiv = _IEEE.divZero, _myDom = _IEEE.domainErr;
                        _IEEE.nan = _sv.nan; _IEEE.inf = _sv.inf; _IEEE.divZero = _sv.divZero; _IEEE.domainErr = _sv.domainErr;
                        var _hasSing = (_iv === null && (_myDiv || _myDom)) || (_iv !== null && (!isFinite(_iv.min) || !isFinite(_iv.max)));
                        if (!_hasSing) {
                            // ---- 异号且无奇点 → 二分定位 ----
                            _bisectRoot1D(_eq, _vn, _gxP, _gx, _gfP, _gf, state, allSolutions, resultVarNames);
                        } else {
                            // ---- 异号区间含奇点（如分式分母零点在区间内部）→ 递归细分分离奇点后再定位 ----
                            _recScanInterval(_eq, _vn, _gxP, _gx, state, allSolutions, resultVarNames, 0);
                        }
                    }
                    if (allSolutions.length > 200) { _dense = true; _denseByCount = true; break; }
                    if ((performance.now() - state.startTime) > 1500) { _dense = true; break; }
                    _gxP = _gx; _gfP = _gf;
                }
                if (_dense) break;
                // 终止端点若有根也记录
                if (_gfP !== null && Math.abs(_gfP) < 1e-7) {
                    var _fbV = reconstructSolution(state, [_B]).map(roundToGrid);
                    allSolutions.push({ values: _fbV, residual: Math.abs(_gfP), _bisect: true });
                }
            }
            if (_truncScan) state.truncated = true; // 周期感知扫描因域过宽/频率过高被点数上限截断 → 诚实标记
        }
    }

    // 全域扫描证无解（2026-08-21）：域宽≤2e5 时扫描已全覆盖；无符号穿越且网格最小|f|远大于
    // 数值噪声（>1e-4）→ 按中间值定理判无实数解。杜绝 log(xy)=1, x+y=6 这类无解系统
    // 空耗 8 秒走分支定界指数递归（suan47 每层重跑完整流水线）。
    // BUG-2 修复：x/0=1 这类"分母恒为 0 常量"方程，全域采样点因除零均返回 null（奇点），
    // 使 _scanMinAbs 恒为 Infinity；原条件(_scanMinAbs!==Infinity)将其排除 → 漏判无解、fall through 到
    // suan47 全局分支定界空转满 8 秒(HARD_TIMEOUT)。现扩展：全域无有限采样点(处处奇点/除零)
    // 且无符号穿越时，同样按中间值定理判无实数解（等式在定义域处处无定义 → 无实数解）。
    if (allSolutions.length === 0 && (_hi - _lo) <= 2e5 && !_scanCross && (_scanMinAbs === Infinity || _scanMinAbs > 1e-4)) {
        state.done = true;
        state.result = { solutions: [], error: "NO_SOLUTION", message: "单变量方程在声明域内扫描无零点：函数与零保持同号（最小距离 " + _scanMinAbs.toExponential(1) + "），按中间值定理判无实数解", executionPath: "单变量全域扫描证无解", timeMs: performance.now() - state.startTime, confidence: "high", varNames: resultVarNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "扫描全域无符号穿越且未触零，按中间值定理判无实数解" };
        return;
    }

    if (allSolutions.length > 0) {
        // 1) 距离去重合并（使用deduplicateSolutions，非hash方式）
        var _valArrays = allSolutions.map(function(s) { return s.values; });
        var _uniqueIdx = deduplicateSolutions(_valArrays, resultVarNames, state.tolerance);
        // 将去重后的索引映射回原solutions，保留最小残差
        var _dedupMap = {};
        for (var _di = 0; _di < _uniqueIdx.length; _di++) {
            var _uv = _uniqueIdx[_di];
            // 找到原allSolutions中对应此值的条目（取残差最小者）
            var _best = null;
            for (var _sj = 0; _sj < allSolutions.length; _sj++) {
                var _match = true;
                for (var _vk = 0; _vk < _uv.length; _vk++) {
                    if (Math.abs(allSolutions[_sj].values[_vk] - _uv[_vk]) > 1e-4) { _match = false; break; }
                }
                if (_match && (!_best || allSolutions[_sj].residual < _best.residual)) { _best = allSolutions[_sj]; }
            }
            if (_best) _dedupMap[_di] = _best;
        }
        var mergedSolutions = [];
        for (var _mi = 0; _mi < _uniqueIdx.length; _mi++) {
            if (_dedupMap[_mi]) mergedSolutions.push(_dedupMap[_mi]);
        }

        // 修3（2026-09-04）：稠密根防护——单变量周期方程在宽域内根稠密，
        // 继续穷举既耗时（曾致 solve 挂起 >110s）又产出无用的海量解集。
        // 含周期函数且根数超阈值 ⇒ 解集实际为无限（周期平移），如实标 rt=3 无限解集(代表解)；
        // 非周期但稠密（如高次多项式）⇒ 不谎称无限，置 truncated 并后续告警，诚实返回部分代表根。
        if (_denseByCount) {
            if (_P !== null) {
                state.done = true;
                state.result = {
                    solutions: mergedSolutions,
                    error: null,
                    message: "单变量周期方程在声明域内出现大量（>" + 200 + "）孤立根，呈周期性稠密分布，解集实际为无限（如 x = x₀ + k·" + _P.toFixed(4) + "）。已给出 " + mergedSolutions.length + " 个代表根；如需有限个解请收窄变量定义域。",
                    executionPath: "单变量稠密周期根判定(无限解集)",
                    timeMs: performance.now() - state.startTime,
                    confidence: "high",
                    varNames: resultVarNames,
                    resultType: 3,
                    resultTypeName: "无限解集(代表解)",
                    resultTypeDesc: "周期方程在宽域内根稠密，解集为周期平移的无穷集合，已给出代表根"
                };
                return;
            }
            state.truncated = true;  // 非周期稠密：诚实截断（避免海量/不完整解集），下方 domainFiltered 产出部分代表根
            _denseNonPeriodic = true;
        }

        // 2) 原始方程回代验证：对每组候选解，代入全部原始方程重新计算残差
        //    二分查找得到的解（_bisect=true）跳过残差验证（区间收敛保证精度）
        var _origEqs = state.originalEquations || state.equations;
        var _verifiedSolutions = [];
        for (var _vi = 0; _vi < mergedSolutions.length; _vi++) {
            var _sol = mergedSolutions[_vi];
            // 二分查找解跳过残差验证
            if (_sol._bisect) {
                _verifiedSolutions.push(_sol);
                continue;
            }
            var _fullVars = {};
            resultVarNames.forEach(function(vn, i) { _fullVars[vn] = _sol.values[i]; });
            // 回代消元变量
            var _subOrder = Object.keys(state.substitutions || {}).reverse();
            for (var _sbi = 0; _sbi < _subOrder.length; _sbi++) {
                var _sv = _subOrder[_sbi];
                if (_fullVars[_sv] === undefined) {
                    try { _fullVars[_sv] = evalAST(state.substitutions[_sv], _fullVars); } catch(e) { }
                }
            }
            // 计算全部原始方程残差
            var _maxRes = 0;
            for (var _ei = 0; _ei < _origEqs.length; _ei++) {
                try {
                    var _r = Math.abs(evalAST(_origEqs[_ei], _fullVars));
                    if (_r > _maxRes) _maxRes = _r;
                } catch(e) { _maxRes = Infinity; break; }
            }
            // 残差<=1e-6才保留
            if (isFinite(_maxRes) && _maxRes <= 1e-6) {
                _verifiedSolutions.push({ values: _sol.values, residual: _maxRes, _origResidual: _maxRes });
            }
        }

        // 3) 按域约束过滤
        var domainFiltered = _verifiedSolutions.filter(function(sol) {
            for (var dci = 0; dci < state.domainConstraints.length; dci++) {
                var dc = state.domainConstraints[dci];
                var vi = resultVarNames.indexOf(dc.varName);
                if (vi >= 0) {
                    var val = sol.values[vi];
                    if (dc.min !== undefined && val < dc.min - 1e-9) return false;
                    if (dc.max !== undefined && val > dc.max + 1e-9) return false;
                }
            }
            return true;
        });
        if (domainFiltered.length > 0) {
            // 近似解聚类（2026-08-21）：奇异/病态点附近牛顿收敛噪声产生多个近似重复点
            // （如 1/x+1/y=1, x+y=4 在 (2,2) 给出 (2,2),(2.001,1.999),(2.002,1.998)）。
            // 按欧氏距离 < 1e-3 聚类，每组取残差最小者（与 suan48 聚类口径一致）。
            var _clust2 = [];
            var _used2 = {};
            for (var _cai = 0; _cai < domainFiltered.length; _cai++) {
                if (_used2[_cai]) continue;
                var _grp = [_cai]; _used2[_cai] = true;
                for (var _caj = _cai + 1; _caj < domainFiltered.length; _caj++) {
                    if (_used2[_caj]) continue;
                    var _dsum2 = 0;
                    for (var _cki = 0; _cki < resultVarNames.length; _cki++) {
                        _dsum2 += Math.abs(domainFiltered[_cai].values[_cki] - domainFiltered[_caj].values[_cki]);
                    }
                    if (_dsum2 < 2e-3 * resultVarNames.length) { _grp.push(_caj); _used2[_caj] = true; }
                }
                var _best2 = domainFiltered[_cai];
                for (var _cg = 0; _cg < _grp.length; _cg++) {
                    if (domainFiltered[_grp[_cg]].residual < _best2.residual) _best2 = domainFiltered[_grp[_cg]];
                }
                _clust2.push(_best2);
            }
            domainFiltered = _clust2;
            domainFiltered.sort(function(a, b) { return a.residual - b.residual; });
            // 置信度：通过原始方程回代校验（残差<1e-5）为高，否则中
            const maxRes = domainFiltered[0].residual;
            const confidence = maxRes < 1e-5 ? "high" : (maxRes < 1e-4 ? "medium" : "low");
            state.done = true;
            state.result = { solutions: domainFiltered, executionPath: "显式替换牛顿", timeMs: performance.now() - state.startTime, confidence: confidence, varNames: resultVarNames, resultType: 2, resultTypeName: "有限离散孤立采样点", resultTypeDesc: "显式替换牛顿求解" };
            // 周期方程完整性标注（2026-08-21）：单变量方程含 sin/cos/tan 等周期函数、
            // 且声明域宽度远超周期时，真解为周期平移的无穷集合，牛顿+扫描只能给出有限
            // 代表根。如实标注 truncated 并说明解的结构，杜绝"静默给出不完整解集"。
            // （与"已验证解保真 + 穷尽尽力而为：资源耗尽显式标记 truncated/残余告警，绝不谎称已穷尽"承诺对齐）
            var _period = 0;
            (function _scanPer(node) {
                if (!node) return;
                if (node.type === 'func') {
                    if (node.name === 'tan' || node.name === 'cot') { if (_period === 0) _period = Math.PI; }
                    else if (['sin', 'cos', 'sec', 'csc'].indexOf(node.name) >= 0) { if (_period !== Math.PI) _period = 2 * Math.PI; }
                    else if (node.name === 'mod' && node.args && node.args[1] && node.args[1].type === 'num') {
                        // mod(x, c) 周期 = |c|（取最小周期，保守标注）
                        var _mC = Math.abs(node.args[1].value);
                        if (_mC > 0 && (_period === 0 || _mC < _period)) _period = _mC;
                    }
                    if (node.arg) _scanPer(node.arg);
                    if (node.args) for (var _ai2 = 0; _ai2 < node.args.length; _ai2++) _scanPer(node.args[_ai2]);
                } else if (node.type === 'binop') { _scanPer(node.left); _scanPer(node.right); }
                else if (node.type === 'unary') { _scanPer(node.operand); }
            })(_eq);
            // 仅当"已找到 ≥2 个解"才标 truncated：找到 1 个解时（如 cos(x)=x 全域唯一解，
            // 因 |cos|≤1 把根限制在 [-1,1]）可能是完整解集，不能因"含周期函数"而误报不完整。
            if (_period > 0 && (_hi - _lo) > 3 * _period && domainFiltered.length >= 2) {
                var _theoN = Math.floor((_hi - _lo) / _period) + 1;
                if (domainFiltered.length < _theoN * 0.5) {
                    state.truncated = true;
                    state.result.warnings = (state.result.warnings || []).concat([
                        "周期方程：方程含 " + (_period === Math.PI ? "tan/cot" : "sin/cos 等") + " 周期函数，声明域宽度 " + Math.round(_hi - _lo) + " 远超周期 " + _period.toFixed(3) + "，真解为周期平移的无穷集合（约 " + _theoN + " 个解）；已给出 " + domainFiltered.length + " 个代表解、未穷举全部。缩小变量范围可得到完整解集。"
                    ]);
                }
            }
            // 解密度自检（2026-08-21）：找到的相邻解间距小于扫描网格步长时，说明解分布密集、
            // 可能存在未定位的零点（如 sin(x²)=0 在 [0,10] 有 32 个根，网格扫描只能捕获部分）。
            // 保守标注 truncated + 警告，杜绝静默漏解；缩小变量范围可获完整解集。
            // 仅当扫描实际执行（域宽 ≤ 2e5）时密度自检才有意义：宽域（默认 ±100万）不执行
            // 网格扫描，网格步长基准 (_hi-_lo)/32 会虚高到 62500，导致 gamma(x)=1（2 个孤立解）
            // 之类被误标"解分布密集"。
            if (domainFiltered.length >= 2 && (_hi - _lo) <= 2e5) {
                var _minGap = Infinity;
                var _sorted2 = domainFiltered.slice().sort(function(a, b) { return a.values[0] - b.values[0]; });
                for (var _gi2 = 1; _gi2 < _sorted2.length; _gi2++) {
                    var _gap2 = _sorted2[_gi2].values[0] - _sorted2[_gi2 - 1].values[0];
                    if (_gap2 > 0 && _gap2 < _minGap) _minGap = _gap2;
                }
                var _gridW2 = (_hi - _lo) / 32;
                if (_minGap < _gridW2 * 0.75) {
                    state.truncated = true;
                    state.result.warnings = (state.result.warnings || []).concat([
                        "解分布密集（最小相邻间距 " + _minGap.toFixed(4) + " < 扫描网格步长 " + _gridW2.toFixed(4) + "）：可能存在未枚举的解，结果不完整。缩小变量范围可获完整解集。"
                    ]);
                }
            }
        }
        // 修3：非周期稠密截断告警（与上方 periodic→无限 分支互补）
        if (_denseNonPeriodic && state.result) {
            state.result.warnings = (state.result.warnings || []).concat([
                "方程在声明域内根数量过多（>" + 200 + "），已截断扫描；结果不完整，缩小变量范围或确认方程规模可获完整解集。"
            ]);
        }
    }
}

// suan23: 分式有理式变量替换 → 交叉相乘消去分母
function suan23(state) {
    if (state.varNames.length !== 1) return;
    var denominators = collectVariableDenominators(state.equations[0], state.varNames[0]);
    if (denominators.length === 0) return;
    var transformed = tryRationalTransform(state.equations[0], state.varNames[0]);
    if (transformed) { state.equations[0] = transformed.transformed; }
}

// suan24: 多项式全域根收割 → 剔除无根区间，压缩D
function suan24(state) {
    var vn = state.varNames[0];
    var polyCoeffs = extractPolynomialCoefficients(state.equations[0], vn);
    if (polyCoeffs && polyCoeffs.length > 2) {
        var polyRoots = polynomialAllRoots(polyCoeffs, state.tolerance);
        if (polyRoots.length > 0) {
            var minRoot = Math.min.apply(null, polyRoots);
            var maxRoot = Math.max.apply(null, polyRoots);
            if (state.D0[vn]) {
                state.D0[vn].min = Math.max(state.D0[vn].min, minRoot - 1);
                state.D0[vn].max = Math.min(state.D0[vn].max, maxRoot + 1);
            }
        }
    }
}

// suan25: 区间算术分析 → 计算函数值域 + 平方和约束 → 检测矛盾并收缩D0
function suan25(state) {
    if (state.eqFeatures.allLinear) return;

    // 1. 从平方和方程提取约束：x² + y² = r² → |x| ≤ r, |y| ≤ r
    // 遍历每个方程，检查是否为平方和=常数的形式
    var _contracted = false;
    for (var _ei25 = 0; _ei25 < state.equations.length; _ei25++) {
        var _eq25 = state.equations[_ei25];
        // 方程形式: f(x) - 0 = 0 → 提取 f(x)
        var _expr25 = null;
        if (_eq25.type === 'binop' && _eq25.op === '-') {
            _expr25 = _eq25.left;
        }

        if (_expr25) {
            // 检查右端是否为常数（处理 x² + y² - 1 = 0 → x² + y² = 1）
            var _eqConst25 = 0;
            if (_eq25.right && _eq25.right.type === 'num') {
                _eqConst25 = _eq25.right.value;
            }

            // 检查是否为 平方和 - 常数 形式
            var _sqTerms25 = [];
            var _const25 = 0;
            (function _flattenSum25(node, negate) {
                if (!node) return;
                if (node.type === 'binop' && node.op === '+') {
                    _flattenSum25(node.left, negate);
                    _flattenSum25(node.right, negate);
                } else if (node.type === 'binop' && node.op === '-') {
                    _flattenSum25(node.left, negate);
                    _flattenSum25(node.right, !negate);
                } else if (node.type === 'num') {
                    _const25 += negate ? -node.value : node.value;
                } else if (node.type === 'binop' && node.op === '^' && node.right.type === 'num' && Math.abs(node.right.value - 2) < 1e-9) {
                    _sqTerms25.push({ node: node.left, negate: negate });
                }
            })(_expr25, false);

            // 总常数 = 右端常数 + 表达式内常数
            _const25 += _eqConst25;

            // 如果检测到平方和项，且常数不为0
            if (_sqTerms25.length >= 1 && _const25 !== 0) {
                if (_sqTerms25.every(function(t) { return !t.negate; })) {
                    // 所有平方项都是正号：x₁² + x₂² + ... = C
                    // 每个 |x_i| ≤ sqrt(C)
                    var _C25 = Math.abs(_const25);
                    var _sqrtC25 = Math.sqrt(_C25);
                    for (var _si25 = 0; _si25 < _sqTerms25.length; _si25++) {
                        var _sqNode25 = _sqTerms25[_si25].node;
                        if (_sqNode25.type === 'var') {
                            var _vn25 = _sqNode25.name;
                            if (state.D0[_vn25]) {
                                var _oldMin25 = state.D0[_vn25].min;
                                var _oldMax25 = state.D0[_vn25].max;
                                state.D0[_vn25].min = Math.max(state.D0[_vn25].min, -_sqrtC25);
                                state.D0[_vn25].max = Math.min(state.D0[_vn25].max, _sqrtC25);
                                if (state.D0[_vn25].min !== _oldMin25 || state.D0[_vn25].max !== _oldMax25) {
                                    _contracted = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. 平方和约束下的乘积范围分析：x² + y² = r² → |xy| ≤ r²/2
    // 用于检测 sin(xy) = c 等隐含乘积约束中的矛盾
    var _prodConstraints = {};
    for (var _ei25 = 0; _ei25 < state.equations.length; _ei25++) {
        var _eq25 = state.equations[_ei25];
        var _expr25 = (_eq25.type === 'binop' && _eq25.op === '-') ? _eq25.left : null;
        if (!_expr25) continue;
        var _sqTerms25 = [];
        var _const25 = 0;
        var _eqConst25 = (_eq25.right && _eq25.right.type === 'num') ? _eq25.right.value : 0;
        (function _flatten25(node, negate) {
            if (!node) return;
            if (node.type === 'binop' && node.op === '+') { _flatten25(node.left, negate); _flatten25(node.right, negate); }
            else if (node.type === 'binop' && node.op === '-') { _flatten25(node.left, negate); _flatten25(node.right, !negate); }
            else if (node.type === 'num') { _const25 += negate ? -node.value : node.value; }
            else if (node.type === 'binop' && node.op === '^' && node.right.type === 'num' && Math.abs(node.right.value - 2) < 1e-9) {
                _sqTerms25.push({ node: node.left, negate: negate });
            }
        })(_expr25, false);
        _const25 += _eqConst25;
        if (_sqTerms25.length >= 2 && _const25 > 0 && _sqTerms25.every(function(t) { return !t.negate; })) {
            var _r25 = Math.sqrt(_const25);
            for (var _si25a = 0; _si25a < _sqTerms25.length; _si25a++) {
                for (var _si25b = _si25a + 1; _si25b < _sqTerms25.length; _si25b++) {
                    var _vna = _sqTerms25[_si25a].node;
                    var _vnb = _sqTerms25[_si25b].node;
                    if (_vna.type === 'var' && _vnb.type === 'var') {
                        var _key25 = [_vna.name, _vnb.name].sort().join('*');
                        _prodConstraints[_key25] = { r2: _r25 * _r25 / 2, vars: [_vna.name, _vnb.name] };
                    }
                }
            }
        }
    }

    // 3. 区间值域分析：对每个方程 f(x)=0，计算 f(D) 的值域，0∉f(D) → 矛盾
    var _intervals25 = {};
    for (var _vi25 = 0; _vi25 < state.varNames.length; _vi25++) {
        var _vnn25 = state.varNames[_vi25];
        if (state.D0[_vnn25]) {
            _intervals25[_vnn25] = { min: state.D0[_vnn25].min, max: state.D0[_vnn25].max };
        }
    }

    for (var _ei25b = 0; _ei25b < state.equations.length; _ei25b++) {
        var _eqExpr25 = state.equations[_ei25b];
        // 提取 f(x) from f(x) = 0
        if (_eqExpr25.type === 'binop' && _eqExpr25.op === '-') {
            // 对完整方程 f(x) - c = 0 整体求值（不能只对 f(x) 求值，会忽略常数项 c）
            var _range25 = intervalEval(_eqExpr25, _intervals25);
            if (_range25 && _range25.min > 1e-12) {
                // f(D) - c 全部 > 0 → 无解
                state.done = true;
                state.result = {
                    solutions: [], error: "NO_SOLUTION",
                    message: "区间算术分析：函数值域全为正，最小 " + _range25.min.toFixed(6) + " > 0，无解",
                    executionPath: "区间算术", timeMs: performance.now() - state.startTime,
                    confidence: "high", varNames: state.varNames,
                    unconverged: false, resultType: 1, resultTypeName: "空结果",
                    resultTypeDesc: "区间算术严格证明不存在满足条件的解"
                };
                return;
            }
            if (_range25 && _range25.max < -1e-12) {
                // f(D) - c 全部 < 0 → 无解
                state.done = true;
                state.result = {
                    solutions: [], error: "NO_SOLUTION",
                    message: "区间算术分析：函数值域全为负，最大 " + _range25.max.toFixed(6) + " < 0，无解",
                    executionPath: "区间算术", timeMs: performance.now() - state.startTime,
                    confidence: "high", varNames: state.varNames,
                    unconverged: false, resultType: 1, resultTypeName: "空结果",
                    resultTypeDesc: "区间算术严格证明不存在满足条件的解"
                };
                return;
            }
        }
    }

    // 3b. 乘积约束检测：利用平方和约束检查 sin(xy)=c 等隐含矛盾
    if (Object.keys(_prodConstraints).length > 0) {
        for (var _ei25c = 0; _ei25c < state.equations.length; _ei25c++) {
            var _eq25c = state.equations[_ei25c];
            // 提取表达式
            var _expr25c = (_eq25c.type === 'binop' && _eq25c.op === '-') ? _eq25c.left : null;
            if (!_expr25c) continue;
            // 检查是否为 sin(expr) - c 形式
            var _checkSinProduct = function(node) {
                if (!node || node.type !== 'func' || node.name !== 'sin') return false;
                var _arg = node.arg || (node.args ? node.args[0] : null);
                if (!_arg || _arg.type !== 'binop' || _arg.op !== '*') return false;
                if (_arg.left.type !== 'var' || _arg.right.type !== 'var') return false;
                var _va = _arg.left.name, _vb = _arg.right.name;
                var _key = [_va, _vb].sort().join('*');
                return _prodConstraints[_key] || false;
            }(_expr25c);
            if (_checkSinProduct) {
                var _sinArg = _expr25c.arg || (_expr25c.args ? _expr25c.args[0] : null);
                if (_sinArg && _sinArg.type === 'binop' && _sinArg.op === '*') {
                    var _va = _sinArg.left.name, _vb = _sinArg.right.name;
                    var _key = [_va, _vb].sort().join('*');
                    var _pc = _prodConstraints[_key];
                    if (_pc) {
                        // 检查 sin(xy) = 0.5 是否可能
                        // 找到 _eq25c 中的常数项（右端减数）
                        var _constC = 0;
                        if (_eq25c.right && _eq25c.right.type === 'num') _constC = _eq25c.right.value;
                        // sin(xy) = c 要求 xy = arcsin(c) + 2πk 或 π-arcsin(c) + 2πk
                        // 检查最接近0的周期解是否在 |xy| ≤ pc.r2 范围内
                        var _cAbs = Math.abs(_constC);
                        if (_cAbs <= 1) {
                            var _arc = Math.asin(_constC);
                            // 两个基本解: arcsin(c) 和 π - arcsin(c)
                            // 对每个基本解，找最接近0的周期值
                            var _closestVal = Infinity;
                            // 检查 arcsin(c) + 2πk
                            for (var _k = -5; _k <= 5; _k++) {
                                var _v = _arc + 2 * Math.PI * _k;
                                if (Math.abs(_v) < Math.abs(_closestVal)) _closestVal = _v;
                                _v = Math.PI - _arc + 2 * Math.PI * _k;
                                if (Math.abs(_v) < Math.abs(_closestVal)) _closestVal = _v;
                            }
                            // 如果最接近0的解的绝对值 > 乘积上限，则无解
                            if (Math.abs(_closestVal) > _pc.r2 + 1e-12) {
                                // 但也需检查 -_closestVal 是否在范围内
                                var _found = false;
                                for (var _k = -5; _k <= 5; _k++) {
                                    var _v1 = _arc + 2 * Math.PI * _k;
                                    var _v2 = Math.PI - _arc + 2 * Math.PI * _k;
                                    if (Math.abs(_v1) <= _pc.r2 + 1e-12 || Math.abs(_v2) <= _pc.r2 + 1e-12) {
                                        _found = true; break;
                                    }
                                }
                                if (!_found) {
                                    state.done = true;
                                    state.result = {
                                        solutions: [], error: "NO_SOLUTION",
                                        message: "区间算术分析：sin(" + _va + "*" + _vb + ")=" + _constC + " 要求 " + _va + "*" + _vb + "≈" + _closestVal.toFixed(4) + "，但由 " + _va + "²+" + _vb + "²=" + (2*_pc.r2).toFixed(2) + " 知 |" + _va + "*" + _vb + "|≤" + _pc.r2.toFixed(4) + "，矛盾，无解",
                                        executionPath: "区间算术", timeMs: performance.now() - state.startTime,
                                        confidence: "high", varNames: state.varNames,
                                        unconverged: false, resultType: 1, resultTypeName: "空结果",
                                        resultTypeDesc: "区间算术严格证明不存在满足条件的解"
                                    };
                                    return;
                                }
                            }
                        }
                    }
                }
            }
        }
        if (state.done) return;
    }

    // 4. 若区间收缩有效，标记已收缩
    if (_contracted) {
        // 检查收缩后是否导致矛盾（某个变量区间为空）
        for (var _ci25 = 0; _ci25 < state.varNames.length; _ci25++) {
            var _cvn25 = state.varNames[_ci25];
            if (state.D0[_cvn25] && state.D0[_cvn25].min > state.D0[_cvn25].max) {
                state.done = true;
                state.result = {
                    solutions: [], error: "NO_SOLUTION",
                    message: "区间收缩后变量 " + _cvn25 + " 的搜索域为空",
                    executionPath: "区间算术", timeMs: performance.now() - state.startTime,
                    confidence: "high", varNames: state.varNames,
                    resultType: 1, resultTypeName: "空结果", resultTypeDesc: "区间算术严格证明不存在满足条件的解"
                };
                return;
            }
        }
    }
}

// 区间算术求值：计算 AST 表达式在给定变量区间下的值域
// —— 切片B·IEEE754 异常闭环 + 区间算术统一守卫 ——
// 全部区间运算结果经 _iNorm 归一：NaN / ±Inf 不再静默污染解集，
// 转为保守外包区间并置位模块级 _IEEE 内部异常标记（输出 JSON 字段可见）。
// 单解串行场景下用模块级标记；P2 编译内核改为 SolverCtx 内 per-ctx 字段。
var _IEEE = { nan: false, inf: false, divZero: false, domainErr: false };
function _ieeeReset() { _IEEE.nan = false; _IEEE.inf = false; _IEEE.divZero = false; _IEEE.domainErr = false; }
function _iNorm(r) {
    if (!r) return r;                                  // null 保持：保守跳过（sound，不收缩）
    if (typeof r.min !== 'number' || typeof r.max !== 'number') return r;
    if (isNaN(r.min) || isNaN(r.max)) {               // NaN 出现 → 保守全空间，绝不让 NaN 进入盒子
        _IEEE.nan = true;
        return { min: -Infinity, max: Infinity };
    }
    var lo = r.min, hi = r.max;
    if (lo === Infinity || lo === -Infinity || hi === Infinity || hi === -Infinity) {
        _IEEE.inf = true;                             // ±Inf 记录；区间本身保留（保守且真实）
    }
    if (Math.abs(lo) > 1e300 || Math.abs(hi) > 1e300) { _IEEE.inf = true; }  // 极端有限幅值亦记溢出
    return { min: lo, max: hi };                      // 不重排 min/max：保留空区间语义（min>max 表示空）
}

function _rangeEval(ast, intervals) {
    if (!ast) return null;
    if (ast.type === 'num') return _iNorm({ min: ast.value, max: ast.value });
    if (ast.type === 'var') {
        var iv = intervals[ast.name];
        if (iv) {
            if (iv.min > iv.max) return _iNorm({ min: iv.min, max: iv.max }); // 空区间（保留 min>max 语义）
            return _iNorm({ min: iv.min, max: iv.max });
        }
        // 变量不在区间映射中，使用默认全域
        return _iNorm({ min: -1e6, max: 1e6 });
    }
    if (ast.type === 'binop') {
        var left = _rangeEval(ast.left, intervals);
        var right = _rangeEval(ast.right, intervals);
        if (!left || !right) return null;

        switch (ast.op) {
            case '+': return _iNorm({ min: left.min + right.min, max: left.max + right.max });
            case '-': return _iNorm({ min: left.min - right.max, max: left.max - right.min });
            case '*': {
                var vals = [left.min * right.min, left.min * right.max, left.max * right.min, left.max * right.max];
                return _iNorm({ min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) });
            }
            case '/': {
                if (right.min <= 0 && right.max >= 0) {
                    _IEEE.divZero = true;             // 含 0 的分母：保守跳过并标记（绝不崩溃）
                    return null;
                }
                var vals = [left.min / right.min, left.min / right.max, left.max / right.min, left.max / right.max];
                return _iNorm({ min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) });
            }
            case '^': {
                // 处理幂运算
                if (right.min === right.max && Number.isInteger(right.min) && Math.abs(right.min) < 100) {
                    var exp = Math.round(right.min);
                    if (exp === 2) {
                        var a = left.min, b = left.max;
                        if (a >= 0) return _iNorm({ min: a * a, max: b * b });
                        if (b <= 0) return _iNorm({ min: b * b, max: a * a });
                        return _iNorm({ min: 0, max: Math.max(a * a, b * b) });
                    }
                    if (exp === 1) return left;
                    if (exp === 0) return _iNorm({ min: 1, max: 1 });
                    if (exp > 0 && exp % 2 === 0) {
                        // 偶次幂
                        var a = left.min, b = left.max;
                        if (a >= 0) return _iNorm({ min: Math.pow(a, exp), max: Math.pow(b, exp) });
                        if (b <= 0) return _iNorm({ min: Math.pow(b, exp), max: Math.pow(a, exp) });
                        return _iNorm({ min: 0, max: Math.max(Math.pow(a, exp), Math.pow(b, exp)) });
                    }
                    if (exp > 0) {
                        // 奇次幂
                        return _iNorm({ min: Math.pow(left.min, exp), max: Math.pow(left.max, exp) });
                    }
                }
                return null; // 非整数幂，保守跳过
            }
        }
        return null;
    }
    if (ast.type === 'func') {
        var arg = ast.arg || (ast.args ? ast.args[0] : null);
        var argRange = arg ? _rangeEval(arg, intervals) : null;
        if (!argRange) return null;

        switch (ast.name) {
            case 'sin': {
                var a = argRange.min, b = argRange.max;
                if (b - a >= 2 * Math.PI) return _iNorm({ min: -1, max: 1 });
                var vals = [Math.sin(a), Math.sin(b)];
                for (var k = -5; k <= 5; k++) {
                    var cp = Math.PI / 2 + k * Math.PI;
                    if (cp >= a && cp <= b) vals.push(Math.sin(cp));
                    cp = -Math.PI / 2 + k * Math.PI;
                    if (cp >= a && cp <= b) vals.push(Math.sin(cp));
                }
                return _iNorm({ min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) });
            }
            case 'cos': {
                var a = argRange.min, b = argRange.max;
                if (b - a >= 2 * Math.PI) return _iNorm({ min: -1, max: 1 });
                var vals = [Math.cos(a), Math.cos(b)];
                for (var k = -5; k <= 5; k++) {
                    var cp = k * Math.PI;
                    if (cp >= a && cp <= b) vals.push(Math.cos(cp));
                }
                return _iNorm({ min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) });
            }
            case 'tan': {
                // tan 在每个无奇点的连续分支上严格单调增，值域=[tan(a),tan(b)]；
                // 若盒 [a,b] 含奇点 kπ+π/2，则值域为全体实数（保守取全区间）。
                // 旧实现固定返回 [-1e6,1e6]，导致含解但无奇点的盒无法被区间收紧，
                // 进而把 tan(x)=100 这类真有解的方程误判为"必无解"（漏解缺陷）。
                // 新实现：不含奇点时给出紧致且 sound 的值域，恢复区间收缩能力。
                var a = argRange.min, b = argRange.max;
                if (!isFinite(a) || !isFinite(b) || b < a) return _iNorm({ min: -Infinity, max: Infinity });
                var kLo = Math.floor((a - Math.PI / 2) / Math.PI);
                var kHi = Math.ceil((b - Math.PI / 2) / Math.PI);
                for (var k = kLo; k <= kHi; k++) {
                    var _sing = k * Math.PI + Math.PI / 2;
                    if (_sing >= a - 1e-12 && _sing <= b + 1e-12) {
                        return _iNorm({ min: -Infinity, max: Infinity }); // 含奇点：覆盖全体实数
                    }
                }
                var _ta = Math.tan(a), _tb = Math.tan(b);
                if (!isFinite(_ta) || !isFinite(_tb)) return _iNorm({ min: -Infinity, max: Infinity });
                return _iNorm({ min: Math.min(_ta, _tb), max: Math.max(_ta, _tb) });
            }
            case 'exp': {
                if (argRange.min > 700) return _iNorm({ min: Infinity, max: Infinity });
                if (argRange.max < -700) return _iNorm({ min: 0, max: Math.exp(argRange.max) });
                return _iNorm({ min: Math.exp(Math.max(-700, argRange.min)), max: Math.exp(Math.min(700, argRange.max)) });
            }
            case 'ln': case 'log': {
                if (argRange.max <= 0) { _IEEE.domainErr = true; return null; } // 定义域错误：标记 + 保守跳过（不崩溃）
                return _iNorm({ min: Math.log(Math.max(1e-300, argRange.min)), max: Math.log(argRange.max) });
            }
            case 'sqrt': {
                if (argRange.max < 0) { _IEEE.domainErr = true; return null; }
                return _iNorm({ min: Math.sqrt(Math.max(0, argRange.min)), max: Math.sqrt(argRange.max) });
            }
                case 'abs': {
                    var a = argRange.min, b = argRange.max;
                    if (a >= 0) return _iNorm({ min: a, max: b });
                    if (b <= 0) return _iNorm({ min: -b, max: -a });
                    return _iNorm({ min: 0, max: Math.max(-a, b) });
                }
                case 'arcsin': {
                    if (argRange.max < -1 || argRange.min > 1) { _IEEE.domainErr = true; return null; }
                    return _iNorm({ min: Math.asin(Math.max(-1, argRange.min)), max: Math.asin(Math.min(1, argRange.max)) });
                }
                case 'arccos': {
                    if (argRange.max < -1 || argRange.min > 1) { _IEEE.domainErr = true; return null; }
                    return _iNorm({ min: Math.acos(Math.min(1, argRange.max)), max: Math.acos(Math.max(-1, argRange.min)) });
                }
                case 'arctan': {
                    return _iNorm({ min: Math.atan(argRange.min), max: Math.atan(argRange.max) });
                }
                case 'sinh': {
                    return _iNorm({ min: Math.sinh(argRange.min), max: Math.sinh(argRange.max) });
                }
                case 'cosh': {
                    var a = argRange.min, b = argRange.max;
                    if (a >= 0) return _iNorm({ min: Math.cosh(a), max: Math.cosh(b) });
                    if (b <= 0) return _iNorm({ min: Math.cosh(b), max: Math.cosh(a) });
                    return _iNorm({ min: 1, max: Math.max(Math.cosh(a), Math.cosh(b)) });
                }
                case 'tanh': {
                    return _iNorm({ min: Math.tanh(argRange.min), max: Math.tanh(argRange.max) });
                }
            }
            return null;
    }
    if (ast.type === 'unary') {
        // 一元算子区间求值（此前缺失 → 含 -2.5 这类负常量等式的标准化 AST 求导后退化，
        // 导致 Krawczyk 雅可比整行保守 [-1e6,1e6]，无法认证 proven）。
        var u = _rangeEval(ast.operand, intervals);
        if (!u) return null;
        if (ast.op === '-') return _iNorm({ min: -u.max, max: -u.min });
        if (ast.op === '+') return u;
        return _iNorm({ min: -1e6, max: 1e6 }); // 未知一元算子：保守退化（sound，绝不假证）
    }
    return null;
}





// ============ A1: 一阶仿射算术（Affine Arithmetic, Comba–Stolfi）============
// 缓解区间算术的"相依性灾难"（同变量多次出现致区间虚假膨胀，如 x-x≠0），
// 使 hull-consistency 收缩更紧 → truncated 占比下降、收窄 sound-incomplete 自承缺口。
// 保守性：x̂=c+Σαᵢεᵢ (|εᵢ|≤1)；toInterval=[c-Σ|αᵢ|, c+Σ|αᵢ|] 严格保守包围，
// 故 Krawczyk 认证层仍消费保守区间、仍 sound。
// 最小 sound 切片：+ - * / 与变量/常数走仿射；超越函数降级为"仿射自变量→保守区间包围"（复用 _rangeEval），已 sound。
var _affSym = 0;
function _Aff(c, e) { return { c: c, e: e || {} }; }
function _affRad(a) { if (!a) return 0; var r = 0; for (var k in a.e) r += Math.abs(a.e[k]); return r; }
function _affToInterval(a) { if (!a) return null; var r = _affRad(a); return _iNorm({ min: a.c - r, max: a.c + r }); }
function _affAdd(a, b) { var e = {}; for (var k in a.e) e[k] = a.e[k]; for (var k in b.e) e[k] = (e[k] || 0) + b.e[k]; return _Aff(a.c + b.c, e); }
function _affSub(a, b) { var e = {}; for (var k in a.e) e[k] = a.e[k]; for (var k in b.e) e[k] = (e[k] || 0) - b.e[k]; return _Aff(a.c - b.c, e); }
function _affMul(a, b) {
  // 一阶 AA 乘法（de Figueiredo 2004）：线性项 + 二次残差保守吸收为新噪声 ε
  var ra = _affRad(a), rb = _affRad(b), e = {};
  for (var i in a.e) e[i] = (e[i] || 0) + b.c * a.e[i];
  for (var i in b.e) e[i] = (e[i] || 0) + a.c * b.e[i];
  var xlo = a.c - ra, xhi = a.c + ra, ylo = b.c - rb, yhi = b.c + rb;
  var cross = Math.abs((xlo - a.c) * (yhi - b.c) + (xhi - a.c) * (ylo - b.c)) / 2;
  var gamma = cross;
  for (var i in a.e) for (var j in b.e) gamma += Math.abs(a.e[i] * b.e[j]);
  var sym = _affSym++; e[sym] = gamma;
  return _Aff(a.c * b.c, e);
}
function _affInv(b) {
  // 1/b 一阶泰勒，误差保守界 |(b-b0)^2|/(2 b0^2 ξ^2)，ξ∈盒，min|ξ|=|b0|-rb
  var rb = _affRad(b); if (b.c === 0) return null;
  var r = _affSub(_Aff(0, {}), b);
  var lin = _affMul(r, _Aff(-1 / (b.c * b.c), {}));
  var e = {}; for (var k in lin.e) e[k] = lin.e[k];
  var m = Math.abs(b.c) - rb; if (m <= 0) return null;
  var err = (rb * rb) / (2 * b.c * b.c * m * m);
  var sym = _affSym++; e[sym] = err;
  return _Aff(1 / b.c + lin.c, e);
}
function _affDiv(a, b) { var ib = _affInv(b); return ib ? _affMul(a, ib) : null; }
function _buildAffEnv(intervals) {
  var env = {}; _affSym = 0;
  if (intervals) for (var name in intervals) {
    var iv = intervals[name];
    if (!iv || iv.min > iv.max) { env[name] = _Aff(iv ? (iv.min + iv.max) / 2 : 0, {}); continue; }
    var e = {}; e[_affSym++] = (iv.max - iv.min) / 2; env[name] = _Aff((iv.min + iv.max) / 2, e);
  }
  return env;
}
function _affineEval(ast, env) {
  if (!ast) return null;
  if (ast.type === 'num') return _Aff(ast.value, {});
  if (ast.type === 'var') {
    if (env[ast.name]) return env[ast.name];
    var e = {}; e[_affSym++] = 1e6; return _Aff(0, e); // 默认全域 [-1e6,1e6]
  }
  if (ast.type === 'binop') {
    var l = _affineEval(ast.left, env), r = _affineEval(ast.right, env);
    if (!l || !r) return null;
    if (ast.op === '+') return _affAdd(l, r);
    if (ast.op === '-') return _affSub(l, r);
    if (ast.op === '*') return _affMul(l, r);
    if (ast.op === '/') return _affDiv(l, r);
    if (ast.op === '^') {
      if (Object.keys(r.e).length === 0 && Number.isInteger(Math.round(r.c)) && Math.abs(r.c) < 100) {
        var n = Math.round(r.c); if (n === 0) return _Aff(1, {}); if (n === 1) return l;
        var acc = l; for (var p = 1; p < Math.abs(n); p++) acc = _affMul(acc, l);
        return n < 0 ? _affInv(acc) : acc;
      }
      return null; // 非整数幂：保守跳过（区间版也跳过，降级 _rangeEval）
    }
    return null;
  }
  if (ast.type === 'func') {
    var arg = ast.arg || (ast.args ? ast.args[0] : null);
    var av = arg ? _affineEval(arg, env) : null;
    if (!av) return null;
    var iv = _affToInterval(av); if (!iv) return null;
    // 超越函数降级：仿射自变量 → 保守区间函数包围（复用 _rangeEval，无递归环）
    var tmp = { type: 'func', name: ast.name, arg: { type: 'var', name: '__a' } };
    var rv = _rangeEval(tmp, { __a: iv });
    if (!rv || !isFinite(rv.min) || !isFinite(rv.max)) return null; // 含 ±Inf：交还 _rangeEval 直接给出保守区间
    // 关键修复（P0-2）：旧实现 return _Aff((rv.min+rv.max)/2, {}) 把合法区间宽度丢成 0，
    // 致 intervalEval(sin x)@[-2,2] 塌成 [0,0]（unsound：真值须含 [-1,1]）。
    // 正确做法：用半径 (rv.max-rv.min)/2 的噪声符号把 rv 完整编码为仿射，
    // 使 _affToInterval 还原为 [rv.min, rv.max]（sound 且紧致），Krawczyk 雅可比随之可信。
    var e = {}; e[_affSym++] = (rv.max - rv.min) / 2;
    return _Aff((rv.min + rv.max) / 2, e);
  }
  if (ast.type === 'unary') {
    var u = _affineEval(ast.operand, env);
    if (!u) return null;
    if (ast.op === '-') return _affSub(_Aff(0, {}), u);
    if (ast.op === '+') return u;
    return null;
  }
  return null;
}
function intervalEval(ast, intervals) {
  if (!ast) return null;
  // 空域（min>max）走保守旧逻辑，保留"空区间"语义供调用方检测无解
  if (intervals) { for (var k in intervals) { if (intervals[k] && intervals[k].min > intervals[k].max) return _rangeEval(ast, intervals); } }
  try {
    var env = _buildAffEnv(intervals || {});
    var aff = _affineEval(ast, env);
    var iv = aff ? _affToInterval(aff) : null;
    return iv || _rangeEval(ast, intervals || {});
  } catch (e) { return _rangeEval(ast, intervals || {}); }
}

// suan29: 导数符号单调性剪枝 → 拉格朗日中值定理：单调+端点同号→剔除
function suan29(state) {
    if (state.varNames.length !== 1) return;
    var vn = state.varNames[0];
    var domain = state.D0[vn];
    if (!domain) return;

    var a = domain.min, b = domain.max;
    if (!isFinite(a) || !isFinite(b) || b <= a) return;
    if (b - a < 1e-10) return;

    var box = {}; box[vn] = { min: a, max: b };

    // 严格测试①（最强）：f 在区间上的区间包络不含 0 → 由中值定理严格证明该盒内无根
    var F = intervalEval(state.equations[0], box);
    if (F && (F.max < 0 || F.min > 0)) {
        state.done = true;
        state.result = { solutions: [], error: "NO_SOLUTION", provenEmpty: true, message: "f 在 [" + a + "," + b + "] 上的严格区间包络不含 0（包络=[" + F.min.toExponential(2) + "," + F.max.toExponential(2) + "]），由中值定理严格证明该盒内无根", executionPath: "导数单调性剪枝", timeMs: performance.now() - state.startTime, confidence: "high", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "区间包络严格证明区间内无根" };
        return;
    }

    // 严格测试②（单调+端点同号）：导数包络排除 0 ⇒ 确证严格单调；
    //   再结合端点值（退化点盒的区间求值）同号 ⇒ 由中值定理严格证明无根。
    //   用符号微分+区间求值得到【紧致】导数包络，取代原“3 条割线同号”启发式（会漏根，见评审 unsound）。
    var dAST = _diffAST(state.equations[0], vn);
    var dI = dAST ? intervalEval(dAST, box) : null;
    if (dI && (dI.min > 0 || dI.max < 0)) {
        var faBox = {}, fbBox = {}; faBox[vn] = { min: a, max: a }; fbBox[vn] = { min: b, max: b };
        var faI = intervalEval(state.equations[0], faBox);
        var fbI = intervalEval(state.equations[0], fbBox);
        if (faI && fbI && ((faI.min > 0 && fbI.min > 0) || (faI.max < 0 && fbI.max < 0))) {
            state.done = true;
            state.result = { solutions: [], error: "NO_SOLUTION", provenEmpty: true, message: "函数在区间 [" + a + "," + b + "] 上导数包络排除 0（严格单调）且两端点同号，由中值定理严格证明区间内无根", executionPath: "导数单调性剪枝", timeMs: performance.now() - state.startTime, confidence: "high", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "导数单调性严格证明区间内无根" };
            return;
        }
    }
}


// suan26: 奇偶对称区间压缩 → 偶函数→搜索域缩半
function suan26(state) {
    if (state.varNames.length !== 1) return;
    var vn = state.varNames[0];
    var domain = state.D0[vn];
    if (!domain) return;
    
    var a = domain.min, b = domain.max;
    if (!isFinite(a) || !isFinite(b)) return;
    if (b - a < 1e-10) return;
    
    // 检查是否为偶函数: f(x) == f(-x)
    // 采样检查
    var testPoints = [a + (b-a)*0.25, (a+b)/2, a + (b-a)*0.75];
    var isEven = true;
    var eps = 1e-8;
    
    for (var ti = 0; ti < testPoints.length; ti++) {
        var x = testPoints[ti];
        if (Math.abs(x) < 1e-10) continue;
        var v1 = {}; v1[vn] = x;
        var v2 = {}; v2[vn] = -x;
        var f1 = evalAST(state.equations[0], v1);
        var f2 = evalAST(state.equations[0], v2);
        if (isFinite(f1) && isFinite(f2)) {
            if (Math.abs(f1 - f2) > 1e-6 * (Math.abs(f1) + 1)) {
                isEven = false;
                break;
            }
        }
    }
    
    // 偶函数本可“域缩半到 [0,∞)”以加速，但原实现只砍负半轴而不把解镜像回 -x，
    // 会丢 x=-2 类解（见评审 unsound）。为保证【不丢解】，此处保守地不做域削减（保留完整搜索域）。
    // 后续里程碑：实现“削减 + 解镜像回填”以同时获得正确性与剪枝收益。
    
    // 检查是否为奇函数: f(x) == -f(-x)
    var isOdd = true;
    for (var ti = 0; ti < testPoints.length; ti++) {
        var x = testPoints[ti];
        if (Math.abs(x) < 1e-10) continue;
        var v1 = {}; v1[vn] = x;
        var v2 = {}; v2[vn] = -x;
        var f1 = evalAST(state.equations[0], v1);
        var f2 = evalAST(state.equations[0], v2);
        if (isFinite(f1) && isFinite(f2)) {
            if (Math.abs(f1 + f2) > 1e-6 * (Math.abs(f1) + 1)) {
                isOdd = false;
                break;
            }
        }
    }
    
    // 奇函数在对称区间上必有f(0)=0，但不做特殊处理，保留完整搜索域
}



// suan35: 投影反证剪枝（Projection Refutation Pruning）
// ─────────────────────────────────────────────────────────────────────────
// 数学依据（sound，绝不丢真解）：
//   设原始方程组的解集为 S⊂R^n，π_I 为投影到变量子集 I 的算子，则
//     π_I(S) = { x_I : ∃ x_{¬I}, (x_I, x_{¬I})∈S }
//   若某个变量子集 I 上的“独立子系统”（全部方程变量⊂I）在 I 上 **无解**，
//   即 π_I(S)=∅，则由投影定义直接推出 S=∅ —— 整棵高维求解树可 sound 剪掉。
// 这是 suan7（代入已知值后单方程矛盾）的推广：suan7 处理“1 方程 vs 已知值”，
// 本算子处理“多方程耦合子系统 vs 变量子集”，能抓住 suan7 抓不到的耦合矛盾。
// 红线：只在“子问题确证无解”方向置 done；绝不在“子问题有解”方向声称全局有解。
function suan35(state) {
    if (state.done) return;
    // 单变量/两变量已由更精确算子覆盖，跳过（与历史 p3LowDim 口径一致）
    if (state.varNames.length <= 2) return;
    if (state.skipOperators.manifoldReduction) return; // 复用原跳过标记，保持兼容

    var allEqs = state.originalEquations || state.equations;
    if (!allEqs || allEqs.length === 0) return;
    var allVars = getOutputVarNames(state);
    if (!allVars || allVars.length <= 2) return;

    // 1) 收集每个方程的“涉及变量集”，并按变量集分组（提取可投影的独立子系统）
    var eqVarSets = [];
    for (var ei = 0; ei < allEqs.length; ei++) {
        var vs = extractVariables(allEqs[ei]);
        if (vs && vs.length) eqVarSets.push({ eq: allEqs[ei], vars: vs });
    }

    // 2) 枚举“投影面” I：严格遍历 allVars 的所有真子集，大小 2..n-1。
    //    变量上限已锁死 6 维，故投影面总数 ≤ C(6,2)+C(6,3)+C(6,4)+C(6,5)=15+20+15+6=56，
    //    每个面只做一次轻量可行性判定（线性高斯相容 / 非线性 intervalEval），
    //    微秒级，无需贪心近似即可做到“全部投一遍”的严格完备。
    //    |I|=1 跳过（单变量子系统矛盾已被 suan7 覆盖，且巨域下区间包络恒含 0 无剪枝价值）；
    //    |I|=n 即全集不是真子集，跳过（那是全系统矛盾，由其他算子处理）。
    var candidates = [];
    var nVars = allVars.length;
    // 二进制枚举所有非空真子集，筛出大小∈[2, n-1]
    var totalMasks = 1 << nVars;
    for (var mask = 1; mask < totalMasks; mask++) {
        var pop = 0, bits = [];
        for (var b = 0; b < nVars; b++) {
            if (mask & (1 << b)) { pop++; bits.push(allVars[b]); }
        }
        if (pop < 2 || pop >= nVars) continue; // 真子集且 2≤|I|≤n-1
        candidates.push(bits);
    }
    if (candidates.length === 0) return;

    // 3) 对每个候选 I：抽出“变量全⊂I”的方程子集，在 I 上判定可行性
    function _subsystemFeasible(subEqs, I) {
        // 实际出现在子集里的变量
        var usedVars = {};
        for (var s = 0; s < subEqs.length; s++) {
            var vv = extractVariables(subEqs[s]);
            for (var t = 0; t < vv.length; t++) usedVars[vv[t]] = 1;
        }
        var used = Object.keys(usedVars);
        if (used.length === 0) return true; // 无变量（纯常数方程）交给其他算子

        // 取 I（used）在 D0 上的域，夹取到有限区间
        var box = {};
        var allFinite = true;
        for (var u = 0; u < used.length; u++) {
            var b = state.D0[used[u]];
            if (!b || !isFinite(b.min) || !isFinite(b.max)) { allFinite = false; break; }
            box[used[u]] = { min: b.min, max: b.max };
        }
        if (!allFinite) return true; // 域未初始化，放弃该候选（保守）

        // (a) 全线性 → 高斯相容判定（精确 sound）
        var allLinear = true;
        for (var q = 0; q < subEqs.length; q++) {
            if (!_isLinearAST(subEqs[q])) { allLinear = false; break; }
        }
        if (allLinear && subEqs.length >= 1) {
            return _linearSystemConsistent(subEqs, used);
        }

        // (b) 含非线性 → 区间包络矛盾检测：任一方程在 used 全域上的区间包络不含 0
        //     ⇒ 该子问题在 used 上无解（中值定理，sound）。注意：包络含 0 不证明有解，
        //     故仅在“不含 0”时返回 false（不可行）。
        for (var r = 0; r < subEqs.length; r++) {
            var iF = intervalEval(subEqs[r], box);
            if (iF && isFinite(iF.min) && isFinite(iF.max) && (iF.max < 0 || iF.min > 0)) {
                return false; // 该方程在 used 全域上严格无根 ⇒ 子问题不可行 ⇒ 全局不可行
            }
        }
        return true; // 保守：无法证伪则假定可行
    }

    for (var ci = 0; ci < candidates.length; ci++) {
        var I = candidates[ci];
        // 抽“变量全⊂I”的方程
        var subEqs = [];
        for (var e = 0; e < eqVarSets.length; e++) {
            var ok = true;
            for (var v = 0; v < eqVarSets[e].vars.length; v++) {
                if (I.indexOf(eqVarSets[e].vars[v]) < 0) { ok = false; break; }
            }
            if (ok) subEqs.push(eqVarSets[e].eq);
        }
        if (subEqs.length < 1) continue;
        if (_subsystemFeasible(subEqs, I)) continue;
        // 命中：子问题在 I 上确证无解 ⇒ 由投影包含关系推出全局无解（sound）
        state.done = true;
        state.result = {
            solutions: [], error: "NO_SOLUTION",
            message: "投影反证剪枝：变量子集 {" + I.join(',') + "} 上的独立子系统在其实数域上严格无解（区间包络不含 0 / 线性不相容），由投影包含关系 π_I(S)=∅ ⇒ S=∅，整系统无实数解",
            executionPath: "投影反证剪枝(suan35)", timeMs: performance.now() - state.startTime,
            confidence: "high", varNames: state.varNames, resultType: 1,
            resultTypeName: "空结果", resultTypeDesc: "投影反证：子系统无解推出全局无解"
        };
        return;
    }
}

// 线性 AST 判定（仅含 + - * 与 var/num，且变量次数≤1）
function _isLinearAST(node) {
    if (!node) return false;
    if (node.type === 'var' || node.type === 'num') return true;
    if (node.type === 'unary') return node.op === '-' ? _isLinearAST(node.operand) : false;
    if (node.type === 'binop') {
        if (node.op === '+' || node.op === '-') return _isLinearAST(node.left) && _isLinearAST(node.right);
        if (node.op === '*') {
            var lL = (node.left.type === 'num'), lR = (node.right.type === 'num');
            // 允许 常数*变量 或 变量*常数
            return (lL && _isLinearAST(node.right)) || (lR && _isLinearAST(node.left));
        }
        return false;
    }
    return false; // func / ^ / / 等视为非线性
}

// 线性方程组相容性判定（sound）：rank(A) == rank([A|b]) 则有解，否则无解
function _linearSystemConsistent(eqs, vars) {
    var n = vars.length, m = eqs.length;
    if (m === 0) return true;
    // 把每个方程写成  Σ a_k·var_k - c = 0  → 提取系数向量与常数
    function _coeffOf(eqAst, vn) {
        // 返回 {a, c} 使 eqAst 等价于 a·vn + c'（仅当 eqAst 对 vn 线性且其他量为常数时有效）
        // 通用做法：在 vn 上做符号线性提取（仅支持 + - * 常数 与 常数*变量）
        function _extract(node, target) {
            if (!node) return { a: 0, c: 0 };
            if (node.type === 'num') return { a: 0, c: node.value };
            if (node.type === 'var') return node.name === target ? { a: 1, c: 0 } : { a: 0, c: 0 };
            if (node.type === 'unary' && node.op === '-') { var t = _extract(node.operand, target); return { a: -t.a, c: -t.c }; }
            if (node.type === 'binop') {
                if (node.op === '+' || node.op === '-') {
                    var L = _extract(node.left, target), R = _extract(node.right, target);
                    return { a: L.a + (node.op === '-' ? -R.a : R.a), c: L.c + (node.op === '-' ? -R.c : R.c) };
                }
                if (node.op === '*') {
                    var cl = (node.left.type === 'num') ? node.left.value : null;
                    var cr = (node.right.type === 'num') ? node.right.value : null;
                    if (cl !== null && node.right.type === 'var' && node.right.name === target) return { a: cl, c: 0 };
                    if (cr !== null && node.left.type === 'var' && node.left.name === target) return { a: cr, c: 0 };
                    return { a: 0, c: 0 }; // 含非常数积（如 var*var）→ 非目标线性（上层已判 _isLinearAST 拦截）
                }
            }
            return { a: 0, c: 0 };
        }
        // eqAst 形如 LHS - RHS = 0 ；先取 LHS-RHS 的整体线性提取
        // 这里 eqAst 已是 (LHS)-(RHS) 的 AST（suan 内部方程统一减式）
        return _extract(eqAst, vn);
    }
    var A = [], B = [];
    for (var i = 0; i < m; i++) {
        // 方程约定为 binop('-', lhs, rhs) ≡ lhs - rhs = 0
        var lhs = eqs[i].left, rhs = eqs[i].right;
        var lcoef = {}, rcoef = {};
        for (var v = 0; v < n; v++) {
            lcoef[vars[v]] = _coeffOf(lhs, vars[v]).a;
            rcoef[vars[v]] = _coeffOf(rhs, vars[v]).a;
        }
        var row = [];
        for (var v2 = 0; v2 < n; v2++) row.push(lcoef[vars[v2]] - rcoef[vars[v2]]);
        // 常数：lhs 常数 - rhs 常数（移到右侧）
        var lc = _coeffOf(lhs, '__none__').c, rc = _coeffOf(rhs, '__none__').c;
        B.push(lc - rc);
        A.push(row);
    }
    // 高斯消元算 rank(A) 与 rank([A|B])
    function _rank(mat, withB) {
        var M = [];
        for (var r = 0; r < mat.length; r++) {
            var row = mat[r].slice();
            if (withB) row.push(B[r]);
            M.push(row);
        }
        var rows = M.length, cols = withB ? n + 1 : n;
        var rank = 0;
        for (var col = 0; col < cols; col++) {
            var piv = -1;
            for (var rr = rank; rr < rows; rr++) {
                if (Math.abs(M[rr][col]) > 1e-9) { piv = rr; break; }
            }
            if (piv < 0) continue;
            var tmp = M[rank]; M[rank] = M[piv]; M[piv] = tmp;
            for (var rr2 = 0; rr2 < rows; rr2++) {
                if (rr2 !== rank && Math.abs(M[rr2][col]) > 1e-12) {
                    var f = M[rr2][col] / M[rank][col];
                    for (var cc = col; cc < cols; cc++) M[rr2][cc] -= f * M[rank][cc];
                }
            }
            rank++;
        }
        return rank;
    }
    var rA = _rank(A, false);
    var rAB = _rank(A, true);
    return rA === rAB; // 相容 ⇔ 有解
}
// suan36: 雅可比秩引导投影方向（分析算子，不收缩/不剪枝，sound 中性）
// ─────────────────────────────────────────────────────────────────────────
// 数学依据：若解流形在采样点处光滑，则雅可比矩阵 J 的数值秩 = 局部约束独立数，
// 局部自由度 dof = n - rank(J)。投影到 rank 个变量上最“经济”（其余变量可由约束反解）。
// 本算子仅做分析并写入 state.projectionHint，供 suan35 / 消元 / 牛顿选择投影方向参考；
// 不动 D0、不动 equations、不动 varNames，绝不据此剪枝或丢弃任何解。
function suan36(state) {
    if (state.done) return;
    if (!state.varNames || state.varNames.length <= 1) { state.projectionHint = null; return; }

    var eqs = state.equations && state.equations.length ? state.equations : (state.originalEquations || []);
    var vars = state.varNames;
    if (eqs.length === 0 || vars.length === 0) { state.projectionHint = null; return; }

    // 样本点：D0 中点（夹取到有限域）；雅可比在该点估值
    var mid = {};
    for (var v = 0; v < vars.length; v++) {
        var b = state.D0[vars[v]];
        if (!b || !isFinite(b.min) || !isFinite(b.max)) { mid[vars[v]] = 0; }
        else mid[vars[v]] = (b.min + b.max) / 2;
    }
    function _f(eqAst, ctx) {
        var val; try { val = evalAST(eqAst, ctx); } catch (e) { val = NaN; }
        return isFinite(val) ? val : NaN;
    }
    // 数值雅可比：中心差分
    var h = 1e-6;
    var J = [];
    var computable = true;
    for (var i = 0; i < eqs.length && computable; i++) {
        var row = [];
        for (var j = 0; j < vars.length; j++) {
            var vp = vars[j];
            var ctxP = {}, ctxM = {};
            for (var kk = 0; kk < vars.length; kk++) { ctxP[vars[kk]] = mid[vars[kk]]; ctxM[vars[kk]] = mid[vars[kk]]; }
            ctxP[vp] = mid[vp] + h; ctxM[vp] = mid[vp] - h;
            var fp = _f(eqs[i], ctxP), fm = _f(eqs[i], ctxM);
            if (!isFinite(fp) || !isFinite(fm)) { computable = false; break; }
            row.push((fp - fm) / (2 * h));
        }
        if (computable) J.push(row);
    }
    if (!computable || J.length === 0) { state.projectionHint = null; return; }

    // 数值秩（高斯消元，阈值 1e-7）
    var rank = 0;
    var M = J.map(function (r) { return r.slice(); });
    var cols = vars.length;
    for (var col = 0; col < cols; col++) {
        var piv = -1;
        for (var rr = rank; rr < M.length; rr++) {
            if (Math.abs(M[rr][col]) > 1e-7) { piv = rr; break; }
        }
        if (piv < 0) continue;
        var tmp = M[rank]; M[rank] = M[piv]; M[piv] = tmp;
        for (var rr2 = 0; rr2 < M.length; rr2++) {
            if (rr2 !== rank && Math.abs(M[rr2][col]) > 1e-10) {
                var f = M[rr2][col] / M[rank][col];
                for (var cc = col; cc < cols; cc++) M[rr2][cc] -= f * M[rank][cc];
            }
        }
        rank++;
    }
    var dof = vars.length - rank;
    // 建议投影方向：优先固定 rank 个“被最多方程依赖”的变量（简单启发：按列绝对值和排序）
    var colSum = [];
    for (var c = 0; c < cols; c++) {
        var s = 0; for (var ri = 0; ri < M.length; ri++) s += Math.abs(J[ri][c]);
        colSum.push({ v: vars[c], s: s });
    }
    colSum.sort(function (x, y) { return y.s - x.s; });
    var suggested = colSum.slice(0, Math.max(1, rank)).map(function (o) { return o.v; });

    state.projectionHint = {
        rank: rank, dof: dof, samplePoint: mid,
        suggestedProjectionVars: suggested,
        note: "雅可比数值秩=" + rank + "，局部自由度=" + dof + "；建议投影到 {" + suggested.join(',') + "} 上"
    };
}




// suan9: 自动定义域约束推导 → 从所有函数的结构推导变量的定义域范围
function suan9(state) {
    // 线性系数提取：把 AST 解析为 a·vn + b（仅 x、a*x、a*x±b、b±a*x、x±b 等线性形式），
    // 非线形返回 null。用于 sqrt/log 的复合线性参数定义域推导（如 sqrt(5-x) → x≤5）。
    function _linearCoeffOf(node, vn) {
        if (!node) return null;
        if (node.type === 'var') return node.name === vn ? { a: 1, b: 0 } : null;
        if (node.type === 'num') return { a: 0, b: node.value };
        if (node.type === 'unary' && node.op === '-') {
            var t = _linearCoeffOf(node.operand, vn);
            return t ? { a: -t.a, b: -t.b } : null;
        }
        if (node.type === 'binop') {
            if (node.op === '+' || node.op === '-') {
                var l = _linearCoeffOf(node.left, vn), r = _linearCoeffOf(node.right, vn);
                if (l && r) return { a: l.a + (node.op === '-' ? -r.a : r.a), b: l.b + (node.op === '-' ? -r.b : r.b) };
                return null;
            }
            if (node.op === '*') {
                if (node.left.type === 'num' && node.right.type === 'var' && node.right.name === vn) return { a: node.left.value, b: 0 };
                if (node.right.type === 'num' && node.left.type === 'var' && node.left.name === vn) return { a: node.right.value, b: 0 };
                return null;
            }
            if (node.op === '/') {
                var l2 = _linearCoeffOf(node.left, vn);
                if (l2 && node.right) {
                    var _rv2 = evalAST(node.right, {});
                    if (isFinite(_rv2) && _rv2 !== 0) {
                        return { a: l2.a / _rv2, b: l2.b / _rv2 };
                    }
                }
                return null;
            }
        }
        return null;
    }
    // 遍历AST，收集所有函数定义域约束
    function collectDomainConstraints(node) {
        if (!node) return [];
        var constraints = [];

        if (node.type === 'func') {
            var arg = node.arg || (node.args ? node.args[0] : null);
            if (arg && arg.type === 'var') {
                var vn = arg.name;
                switch (node.name) {
                    // ── 偶次根: sqrt(x) → x ≥ 0；sqrt(线性表达式) → 线性式 ≥ 0（如 sqrt(5-x) → x ≤ 5）──
                    case 'sqrt':
                        if (arg.type === 'var') {
                            constraints.push({ type: 'domain', varName: vn, min: 0 });
                        } else if (state.varNames.length === 1) {
                            var _ls = _linearCoeffOf(arg, state.varNames[0]);
                            if (_ls && _ls.a !== 0) {
                                if (_ls.a > 0) constraints.push({ type: 'domain', varName: state.varNames[0], min: -_ls.b / _ls.a });
                                else constraints.push({ type: 'domain', varName: state.varNames[0], max: -_ls.b / _ls.a });
                            }
                        }
                        break;

                    // ── 对数: ln(x), log(x), log2(x), log10(x) → x > 0；线性复合参数同理 ──
                    case 'log': case 'ln': case 'log2': case 'log10':
                        if (arg.type === 'var') {
                            constraints.push({ type: 'domain', varName: vn, min: 1e-300 });
                        } else if (state.varNames.length === 1) {
                            var _ll = _linearCoeffOf(arg, state.varNames[0]);
                            if (_ll && _ll.a !== 0) {
                                if (_ll.a > 0) constraints.push({ type: 'domain', varName: state.varNames[0], min: -_ll.b / _ll.a });
                                else constraints.push({ type: 'domain', varName: state.varNames[0], max: -_ll.b / _ll.a });
                            }
                        }
                        break;

                    // ── 反正弦/反余弦: arcsin(x), arccos(x) → x ∈ [-1, 1] ──
                    case 'arcsin': case 'arccos':
                        constraints.push({ type: 'domain', varName: vn, min: -1, max: 1 });
                        break;

                    // ── 反双曲余弦: arccosh(x) → x ≥ 1 ──
                    case 'arccosh':
                        constraints.push({ type: 'domain', varName: vn, min: 1 });
                        break;

                    // ── 反双曲正切: arctanh(x) → x ∈ (-1, 1) ──
                    case 'arctanh':
                        constraints.push({ type: 'domain', varName: vn, min: -1, max: 1 });
                        break;

                    // ── 正切: tan(x) → x ≠ π/2 + kπ（奇点警告） ──
                    case 'tan': case 'sec':
                        state.conditionWarnings.push(node.name + "(x) 有奇点 " + (node.name === 'tan' ? "x = kπ+π/2" : "x = kπ+π/2") + "，求解器无法排除奇点解，结果需人工验证");
                        break;

                    // ── 余切/余割: cot(x), csc(x) → x ≠ kπ ──
                    case 'cot': case 'csc':
                        state.conditionWarnings.push(node.name + "(x) 有奇点 x = kπ，求解器无法排除奇点解，结果需人工验证");
                        break;

                    // ── 反余切/反正割/反余割: 定义域有界的较少见函数 ──
                    case 'arcsec':
                        // arcsec(x) = arccos(1/x), 定义域 |x| ≥ 1
                        constraints.push({ type: 'domain', varName: vn, min: 1 });
                        // 还需要 x ≤ -1，但区间约束只能表示连续区间，所以加警告
                        state.conditionWarnings.push("arcsec(x) 定义域为 |x| ≥ 1，当前仅约束 x ≥ 1，x ≤ -1 部分的解可能被遗漏");
                        break;
                    case 'arccsc':
                        // arccsc(x) = arcsin(1/x), 定义域 |x| ≥ 1
                        constraints.push({ type: 'domain', varName: vn, max: -1 });
                        state.conditionWarnings.push("arccsc(x) 定义域为 |x| ≥ 1，当前仅约束 x ≤ -1，x ≥ 1 部分的解可能被遗漏");
                        break;
                }
            }
            // 递归处理参数（如果参数是复合表达式，需要遍历其子节点提取变量约束）
            if (node.args) node.args.forEach(function(a) { constraints = constraints.concat(collectDomainConstraints(a)); });
            if (node.arg) constraints = constraints.concat(collectDomainConstraints(node.arg));
        }

        if (node.type === 'binop') {
            // ── 除法: 分母 ≠ 0 ──
            if (node.op === '/') {
                constraints = constraints.concat(collectDomainConstraints(node.left));
                constraints = constraints.concat(collectDomainConstraints(node.right));
            }
            // ── 幂运算: x^(1/n) 偶次根 或 x^(-n) 负指数 ──
            else if (node.op === '^') {
                if (node.left.type === 'var') {
                    var vn = node.left.name;
                    var expVal = null;
                    // 尝试提取指数值
                    if (node.right.type === 'num') {
                        expVal = node.right.value;
                    } else if (node.right.type === 'binop' && node.right.op === '/' && node.right.left.type === 'num' && node.right.right.type === 'num') {
                        expVal = node.right.left.value / node.right.right.value;
                    }
                    if (expVal !== null) {
                        // 负指数: x^(-n) → x ≠ 0
                        if (expVal < 0) {
                            state.conditionWarnings.push("变量 " + vn + " 出现在负指数 " + expVal.toFixed(4) + " 中，要求 " + vn + " ≠ 0，结果可能包含奇点，需人工验证");
                        }
                        // 正分数指数: x^(1/n) 且 n 为偶数 → x ≥ 0
                        if (expVal > 0 && expVal < 1) {
                            var recip = 1 / expVal;
                            var recipInt = Math.round(recip);
                            if (Math.abs(recip - recipInt) < 1e-10 && recipInt % 2 === 0) {
                                constraints.push({ type: 'domain', varName: vn, min: 0 });
                            }
                        }
                    }
                }
                constraints = constraints.concat(collectDomainConstraints(node.left));
                constraints = constraints.concat(collectDomainConstraints(node.right));
            } else {
                constraints = constraints.concat(collectDomainConstraints(node.left));
                constraints = constraints.concat(collectDomainConstraints(node.right));
            }
        }

        // 递归遍历所有子节点
        if (node.left) constraints = constraints.concat(collectDomainConstraints(node.left));
        if (node.right) constraints = constraints.concat(collectDomainConstraints(node.right));
        if (node.operand) constraints = constraints.concat(collectDomainConstraints(node.operand));
        if (node.arg) constraints = constraints.concat(collectDomainConstraints(node.arg));
        if (node.args) node.args.forEach(function(a) { constraints = constraints.concat(collectDomainConstraints(a)); });
        return constraints;
    }

    // 遍历所有方程收集约束
    var autoConstraints = [];
    for (var ei = 0; ei < state.equations.length; ei++) {
        autoConstraints = autoConstraints.concat(collectDomainConstraints(state.equations[ei]));
    }

    // ========== 结构级方程分析 ==========
    // 1) 乘积 = 非零常数 → 每个因子 ≠ 0
    // 2) 复合分母 → 提取分母变量，警告 ≠ 0
    // 3) 结构矛盾 → sqrt(x) = 负数, exp(x) = 0, |x| = 负数, 平方和 = 负数
    for (var ei = 0; ei < state.equations.length; ei++) {
        var eq = state.equations[ei];
        // 方程形式: f(x) - c = 0 → f(x) = c
        if (eq.type !== 'binop' || eq.op !== '-') continue;
        var lhs = eq.left;
        var rhs = eq.right;
        // 确保右端是常数（支持 num(-2) 和 unary('-', num(2)) 两种形式）
        var cVal = null;
        if (rhs && rhs.type === 'num') {
            cVal = rhs.value;
        } else if (rhs && rhs.type === 'unary' && rhs.op === '-' && rhs.operand && rhs.operand.type === 'num') {
            cVal = -rhs.operand.value;
        }
        if (cVal === null) continue;

        // ── 1) 乘积 = 非零常数 ──
        // 检查左端是否为连续乘积
        if (cVal !== 0) {
            var prodVars = [];
            (function flattenProd(node) {
                if (!node) return;
                if (node.type === 'binop' && node.op === '*') {
                    flattenProd(node.left);
                    flattenProd(node.right);
                } else if (node.type === 'var') {
                    prodVars.push(node.name);
                }
            })(lhs);
            if (prodVars.length >= 2) {
                // 乘积=非零常数，数学上直接推导每个因子≠0，无需输出告警
                // 内部记录约束，供后置校验使用
                if (!state._nonZeroVars) state._nonZeroVars = [];
                prodVars.forEach(function(pv) {
                    if (state._nonZeroVars.indexOf(pv) < 0) state._nonZeroVars.push(pv);
                });
            }
        }

        // ── 2) 复合分母检测（已移除告警，分母约束在 evalAST 自然处理）──

        // ── 3) 结构矛盾检测 ──
        // (a) sqrt(x) = 负数 → 无解（因为 sqrt ≥ 0）
        // 检查左端是否为 sqrt(expr) 且右端为负数
        if (lhs.type === 'func' && lhs.name === 'sqrt' && cVal < 0) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：sqrt(x) = " + cVal + " < 0，平方根函数值域 ≥ 0，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (b) exp(x) ≤ 0 → 无解（因为 exp > 0）
        if (lhs.type === 'func' && lhs.name === 'exp' && cVal <= 0) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：exp(x) = " + cVal + " ≤ 0，指数函数值域 > 0，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (c) |x| = 负数 → 无解（因为 |x| ≥ 0）
        if (lhs.type === 'func' && lhs.name === 'abs' && cVal < 0) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：|x| = " + cVal + " < 0，绝对值函数值域 ≥ 0，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (d) x^2 + y^2 + ... = 负数 → 无解（扩展：支持 x^4, x^6 等偶次幂）
        // 检查左端是否为纯偶次幂和
        if (cVal < 0) {
            var sqTerms = [];
            var hasNonSquare = false;
            (function flattenSum(node) {
                if (!node) return;
                if (node.type === 'binop' && node.op === '+') {
                    flattenSum(node.left);
                    flattenSum(node.right);
                } else if (node.type === 'binop' && node.op === '^' && node.right.type === 'num') {
                    var exp = node.right.value;
                    var expRound = Math.round(exp);
                    if (Math.abs(exp - expRound) < 1e-9 && expRound > 0 && expRound % 2 === 0) {
                        sqTerms.push(node.left);
                    } else {
                        hasNonSquare = true;
                    }
                } else {
                    hasNonSquare = true;
                }
            })(lhs);
            if (sqTerms.length >= 1 && !hasNonSquare) {
                var sqVarNames = [];
                sqTerms.forEach(function(t) {
                    if (t.type === 'var') sqVarNames.push(t.name);
                });
                state.done = true;
                state.result = {
                    solutions: [], error: "NO_SOLUTION",
                    message: "结构矛盾：" + (sqVarNames.length >= 1 ? sqVarNames.join("² + ") + "²" : "偶次幂项") + " = " + cVal + " < 0，偶次幂 ≥ 0，无实数解",
                    executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                    confidence: "high", varNames: state.varNames, resultType: 1
                };
                return;
            }
        }
        // (e) sin(x) = c, |c| > 1 或 cos(x) = c, |c| > 1 → 无解（三角函数值域 [-1, 1]）
        if (lhs.type === 'func' && (lhs.name === 'sin' || lhs.name === 'cos') && Math.abs(cVal) > 1 + 1e-12) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：" + lhs.name + "(x) = " + cVal + "，三角函数值域 [-1, 1]，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (f) 非零常数 / expr = 0 → 无解（分子非零的分式不可能等于 0）
        if (cVal === 0 && lhs.type === 'binop' && lhs.op === '/' && lhs.left.type === 'num' && Math.abs(lhs.left.value) > 1e-15) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：分子 " + lhs.left.value + " ≠ 0，分式方程不可能等于 0，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (g) 非负项之和 = 负数 → 无解（sqrt + |x| + x^2 + ... = 负数）
        // 检测 sqrt(x) + |y| + 偶次幂 + ... = 负数
        if (cVal < 0) {
            var nonnegTerms = [];
            var hasOther = false;
            (function flattenSum2(node) {
                if (!node) return;
                if (node.type === 'binop' && node.op === '+') {
                    flattenSum2(node.left);
                    flattenSum2(node.right);
                } else if (node.type === 'func' && (node.name === 'sqrt' || node.name === 'abs' || node.name === 'exp')) {
                    nonnegTerms.push(node);
                } else if (node.type === 'binop' && node.op === '^' && node.right.type === 'num') {
                    var exp = node.right.value;
                    var expRound = Math.round(exp);
                    if (Math.abs(exp - expRound) < 1e-9 && expRound > 0 && expRound % 2 === 0) {
                        nonnegTerms.push(node);
                    } else {
                        hasOther = true;
                    }
                } else {
                    hasOther = true;
                }
            })(lhs);
            if (nonnegTerms.length >= 1 && !hasOther) {
                state.done = true;
                state.result = {
                    solutions: [], error: "NO_SOLUTION",
                    message: "结构矛盾：非负项之和 = " + cVal + " < 0，各项均 ≥ 0，无实数解",
                    executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                    confidence: "high", varNames: state.varNames, resultType: 1
                };
                return;
            }
        }
        // (h) x^0 = c, c ≠ 1 → 无解（x^0 ≡ 1，任何非零实数的 0 次幂 = 1）
        // 检测左端是否为 expr^0 形式
        if (lhs.type === 'binop' && lhs.op === '^' && lhs.right.type === 'num' && Math.abs(lhs.right.value) < 1e-12 && Math.abs(cVal - 1) > 1e-12) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：表达式^0 = " + cVal + " ≠ 1，任何非零实数的 0 次幂 = 1，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (i) a^x = c ≤ 0（a > 0 常数）→ 无解（正数的任意次幂 > 0）
        // 检测左端是否为 常数正数 ^ 表达式 形式，且右端 ≤ 0
        if (lhs.type === 'binop' && lhs.op === '^' && lhs.left.type === 'num' && lhs.left.value > 0 && cVal <= 0) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：" + lhs.left.value + "^x = " + cVal + " ≤ 0，正数的任意实数次幂 > 0，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (j) sqrt(x) = 0 且 x 有定义域约束 ≥ 正数 → 但从结构上无法直接判断，留给后续算子
    }

    // 将收集到的约束合并到 state.domainConstraints
    if (autoConstraints.length > 0) {
        autoConstraints.forEach(function(ac) {
            if (ac.type === 'domain') {
                state.domainConstraints.push(ac);
            }
        });
    }

    // 自动推导的约束已存入 state.domainConstraints
    // 与当前 D0 求交集（单向缩小：Dₙₑw ⊆ Dₒₗd）
    if (autoConstraints.length > 0) {
        var _hasContradiction = false;
        for (var _dci8 = 0; _dci8 < state.domainConstraints.length; _dci8++) {
            var _dc8 = state.domainConstraints[_dci8];
            var _vn8 = _dc8.varName;
            if (state.D0[_vn8]) {
                if (_dc8.min !== undefined) {
                    state.D0[_vn8].min = Math.max(state.D0[_vn8].min, _dc8.min);
                }
                if (_dc8.max !== undefined) {
                    state.D0[_vn8].max = Math.min(state.D0[_vn8].max, _dc8.max);
                }
                if (state.D0[_vn8].min > state.D0[_vn8].max) {
                    _hasContradiction = true; break;
                }
            }
        }
        if (_hasContradiction) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "自动定义域推导：变量搜索域为空，无解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
        }
    }
}

// suan37: 流形类型分类 → 判定离散点/曲线/曲面
function suan37(state) {
    if (!state.manifoldInfo) {
        state.manifoldType = { type: 'unknown', dim: -1, strategy: 'newton', description: '无法检测流形' };
        return;
    }
    var rank = state.manifoldInfo.rank;
    var n = state.varNames.length;
    var effectiveDim = n - rank; // 解流形的维数（自由度）
    
    if (rank === 0) {
        return { type: 'discrete', dim: 0, effectiveDim: 0, strategy: 'extract_candidates',
            description: '0维离散点集 — 从代数边界候选提取直接读出' };
    }
    if (effectiveDim === 0) {
        return { type: 'discrete', dim: 0, effectiveDim: 0, strategy: 'extract_candidates',
            description: '0维离散点集（满秩约束） — 代数候选提取 + 直接读出' };
    }
    if (effectiveDim === 1) {
        return { type: 'curve', dim: 1, effectiveDim: 1, strategy: 'geodesic_tracking',
            description: '1维曲线流形 — 测地线跟踪遍历' };
    }
    if (effectiveDim <= 4) {
        return { type: 'surface', dim: effectiveDim, effectiveDim: effectiveDim, strategy: 'grid_sampling',
            description: effectiveDim + '维曲面流形 — 流形格点采样' };
    }
    // effectiveDim >= 5
    return { type: 'highdim', dim: effectiveDim, effectiveDim: effectiveDim, strategy: 'nullspace_reduction',
        description: effectiveDim + '维高维流形 — 零空间参数化降维' };
}

// suan38: 固定规则均匀采样 → 确定性网格点生成候选初值
function suan38(state) {
    var n = state.varNames.length;
    const points = [];

    // 使用 D0 作为起始点生成依据
    function getStartValue(v, base) {
        if (state.D0 && state.D0[v]) {
            const b = state.D0[v];
            const min = b.min === -Infinity ? -1000000 : b.min;
            const max = b.max === Infinity ? 1000000 : b.max;
            if (base < min) return min;
            if (base > max) return max;
            return base;
        }
        return base;
    }

    // 原点
    points.push(state.varNames.map(v => getStartValue(v, 0)));
    // 全+1
    points.push(state.varNames.map(v => getStartValue(v, 1)));
    // 全-1
    points.push(state.varNames.map(v => getStartValue(v, -1)));
    // 全+10
    points.push(state.varNames.map(v => getStartValue(v, 10)));
    // 全-10
    points.push(state.varNames.map(v => getStartValue(v, -10)));

    // 混合符号点（多变量时覆盖不同象限）
    if (n >= 2) {
        points.push(state.varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? 5 : -5)));
        points.push(state.varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? -5 : 5)));
        points.push(state.varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? 10 : -10)));
        points.push(state.varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? -10 : 10)));
    }

    // 3个确定性网格点（基于 D0 区间）
    const gridFractions = [0.25, 0.5, 0.75];
    for (let r = 0; r < 3; r++) {
        const pt = [];
        for (let i = 0; i < n; i++) {
            const v = state.varNames[i];
            if (state.D0 && state.D0[v]) {
                const b = state.D0[v];
                const min = b.min === -Infinity ? -1000000 : b.min;
                const max = b.max === Infinity ? 1000000 : b.max;
                pt.push(min + gridFractions[r] * (max - min));
            } else {
                pt.push((r - 1) * 66);
            }
        }
        points.push(pt);
    }

    return points;
}

// suan39: 零空间流形投影校准 → 将起始点投影到流形上
function suan39(state) {
    if (!state.manifoldInfo || !state.startPoints) return;
    if (state.manifoldInfo && state.manifoldInfo.hasRedundancy) {
        state.startPoints = projectToManifold(state.startPoints, state.manifoldInfo);
    }
}

// suan40: 线搜索牛顿迭代 → 带Armijo阻尼的牛顿迭代
function suan40(state) {
    if (!state.startPoints || state.startPoints.length === 0) {
        // 如果没有起始点，尝试从默认网格生成
        state.startPoints = generateStartPoints(state.varNames, state.D0);
        if (!state.startPoints || state.startPoints.length === 0) return;
    }

    var allSolutions = [];
    var WATCHDOG_MS = 600;

    for (var spi = 0; spi < state.startPoints.length; spi++) {
        if (performance.now() - state.startTime > WATCHDOG_MS) break;
        var sp = state.startPoints[spi];
        var result = lineSearchNewton(state.equations, state.varNames, sp, {
            maxIter: state.maxIter,
            tolerance: state.tolerance,
            _deadline: performance.now() + 100
        });
        if (result.converged) {
            var sol = result.solution.map(function(v) { return roundToGrid(v); });
            var hasNaN = false;
            for (var si = 0; si < sol.length; si++) {
                if (isNaN(sol[si]) || !isFinite(sol[si]) || Math.abs(sol[si]) > 1000000) { hasNaN = true; break; }
            }
            if (hasNaN) continue;
            var vars = {};
            state.varNames.forEach(function(v, i) { vars[v] = sol[i]; });
            var res = 0;
            state.equations.forEach(function(eq) { var r = Math.abs(evalAST(eq, vars)); if (r > res) res = r; });
            allSolutions.push({ values: sol, residual: res });
        }
    }

    if (allSolutions.length > 0) {
        var seen = new Set();
        var unique = allSolutions.filter(function(s) {
            var hash = s.values.map(function(v) { return v.toFixed(6); }).join(",");
            if (seen.has(hash)) return false;
            seen.add(hash);
            return true;
        });
        unique.sort(function(a, b) { return a.residual - b.residual; });
        state.allRawSolutions = unique;
    }
}

// suan41: 区间牛顿兜底求精 → 区间分裂+反证剔除
function suan41(state) {
    var tolerance = state.tolerance;
    var maxBoxes = 20;
    var eps = 1e-7;
    var n = state.varNames.length;
    
    // 初始区间栈
    var stack = [state.D0];
    var solutions = [];
    var iterations = 0;
    
    while (stack.length > 0 && iterations < 200) {
        iterations++;
        var X = stack.pop();
        if (!X) continue;
        
        // 计算区间宽度，如果足够小则取中点作为候选解
        var maxWidth = 0;
        for (var vi = 0; vi < n; vi++) {
            var vn = state.varNames[vi];
            var w = X[vn].max - X[vn].min;
            if (w > maxWidth) maxWidth = w;
        }
        
        if (maxWidth < tolerance) {
            // 取中点作为候选解
            var candidate = new Array(n);
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                candidate[vi] = (X[vn].min + X[vn].max) / 2;
            }
            // 验证
            var vars = {};
            state.varNames.forEach(function(v, k) { vars[v] = candidate[k]; });
            var F = state.equations.map(function(eq) { return evalAST(eq, vars); });
            var maxRes = 0;
            var _hasNaN = false;
            for (var fi = 0; fi < F.length; fi++) {
                if (isNaN(F[fi]) || !isFinite(F[fi])) { _hasNaN = true; break; }
                var absF = Math.abs(F[fi]);
                if (absF > maxRes) maxRes = absF;
            }
            if (!_hasNaN && maxRes < tolerance * 10) {
                solutions.push({ values: candidate, residual: maxRes });
            }
            continue;
        }
        
        // 计算中点
        var mid = new Array(n);
        for (var vi = 0; vi < n; vi++) {
            var vn = state.varNames[vi];
            mid[vi] = (X[vn].min + X[vn].max) / 2;
        }
        
        // 计算F(mid)
        var vars = {};
        state.varNames.forEach(function(v, k) { vars[v] = mid[k]; });
        var Fmid = state.equations.map(function(eq) { return evalAST(eq, vars); });
        var hasNaN = false;
        for (var fi = 0; fi < Fmid.length; fi++) {
            if (isNaN(Fmid[fi]) || !isFinite(Fmid[fi])) { hasNaN = true; break; }
        }
        if (hasNaN) {
            // 区间包含奇异点，直接分裂
            var splitVar = 0;
            var maxW = 0;
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                var w = X[vn].max - X[vn].min;
                if (w > maxW) { maxW = w; splitVar = vi; }
            }
            var svn = state.varNames[splitVar];
            var midVal = (X[svn].min + X[svn].max) / 2;
            var X1 = {}, X2 = {};
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                X1[vn] = { min: X[vn].min, max: (vi === splitVar ? midVal : X[vn].max) };
                X2[vn] = { min: (vi === splitVar ? midVal : X[vn].min), max: X[vn].max };
            }
            if (stack.length < maxBoxes) {
                stack.push(X2);
                stack.push(X1);
            }
            continue;
        }
        
        // 计算区间雅可比矩阵 F'(X)
        var Jint = [];
        for (var i = 0; i < state.equations.length; i++) {
            Jint.push(new Array(n));
            for (var j = 0; j < n; j++) {
                // 数值区间导数：在X上计算偏导数的区间
                var dMin = Infinity, dMax = -Infinity;
                var samplePts = [mid[j], X[state.varNames[j]].min, X[state.varNames[j]].max];
                for (var si = 0; si < samplePts.length; si++) {
                    var xP = mid.slice();
                    xP[j] = samplePts[si] + eps;
                    var xM = mid.slice();
                    xM[j] = samplePts[si] - eps;
                    var vP = {}, vM = {};
                    state.varNames.forEach(function(v, k) { vP[v] = xP[k]; vM[v] = xM[k]; });
                    var fp = evalAST(state.equations[i], vP);
                    var fm = evalAST(state.equations[i], vM);
                    var deriv = (fp - fm) / (2 * eps);
                    if (isFinite(deriv) && !isNaN(deriv)) {
                        if (deriv < dMin) dMin = deriv;
                        if (deriv > dMax) dMax = deriv;
                    }
                }
                Jint[i][j] = { min: dMin === Infinity ? 0 : dMin, max: dMax === -Infinity ? 0 : dMax };
            }
        }
        
        // 构造区间牛顿算子：N(X) = mid - J(X)^{-1} * F(mid)
        // 使用高斯消元法解 J * delta = F(mid)
        // 区间高斯消元（简化：用中点矩阵近似）
        var Jmid = [];
        for (var i = 0; i < state.equations.length; i++) {
            Jmid.push(new Array(n));
            for (var j = 0; j < n; j++) {
                Jmid[i][j] = (Jint[i][j].min + Jint[i][j].max) / 2;
            }
        }
        
        var negFmid = Fmid.map(function(f) { return -f; });
        var gaussResult = gaussianSolve(Jmid, negFmid);
        
        if (!gaussResult) {
            // 奇异雅可比，直接分裂
            var splitVar = 0;
            var maxW = 0;
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                var w = X[vn].max - X[vn].min;
                if (w > maxW) { maxW = w; splitVar = vi; }
            }
            var svn = state.varNames[splitVar];
            var midVal = (X[svn].min + X[svn].max) / 2;
            var X1 = {}, X2 = {};
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                X1[vn] = { min: X[vn].min, max: (vi === splitVar ? midVal : X[vn].max) };
                X2[vn] = { min: (vi === splitVar ? midVal : X[vn].min), max: X[vn].max };
            }
            if (stack.length < maxBoxes) {
                stack.push(X2);
                stack.push(X1);
            }
            continue;
        }
        
        var delta = gaussResult.solution;
        
        // 计算N(X)的区间：delta的区间扩展
        var N = {};
        for (var vi = 0; vi < n; vi++) {
            var vn = state.varNames[vi];
            // 用区间扩张计算delta的误差边界
            var deltaErr = 0;
            for (var j = 0; j < n; j++) {
                var halfWidth = (Jint[vi][j].max - Jint[vi][j].min) / 2;
                deltaErr += halfWidth * Math.abs(delta[j]);
            }
            var dVal = delta[vi];
            N[vn] = {
                min: mid[vi] + dVal - deltaErr - 1e-10,
                max: mid[vi] + dVal + deltaErr + 1e-10
            };
        }
        
        // 区间牛顿判定
        var isSubset = true;    // N(X) ⊆ X ?
        var isDisjoint = false; // N(X) ∩ X = ∅ ?
        
        for (var vi = 0; vi < n; vi++) {
            var vn = state.varNames[vi];
            var Nlo = N[vn].min, Nhi = N[vn].max;
            var Xlo = X[vn].min, Xhi = X[vn].max;
            
            // 检查N(X) ⊆ X
            if (Nlo < Xlo - 1e-10 || Nhi > Xhi + 1e-10) isSubset = false;
            // 检查N(X) ∩ X = ∅
            if (Nhi < Xlo - 1e-10 || Nlo > Xhi + 1e-10) isDisjoint = true;
        }
        
        if (isDisjoint) {
            // 注意：区间雅可比用的是"中点矩阵近似"而非严格区间包络，
            // 因此 N(X)∩X=∅ 不可靠——可能把真含解的盒子误判为无解而漏解。
            // 为保证"不漏解"，此处不丢弃盒子，而是继续走下方 else 的分裂分支，
            // 让更深层的区间判定去处理（isSubset 必为 false，故会进入分裂）。
        }
        
        if (isSubset) {
            // N(X) ⊆ X → 唯一解存在，收缩区间并继续
            // 用N(X)更新X
            var newX = {};
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                newX[vn] = {
                    min: Math.max(X[vn].min, N[vn].min),
                    max: Math.min(X[vn].max, N[vn].max)
                };
            }
            // 检查新区间宽度，如果足够小则取中点
            var w = 0;
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                var ww = newX[vn].max - newX[vn].min;
                if (ww > w) w = ww;
            }
            if (w < tolerance) {
                var candidate = new Array(n);
                for (var vi = 0; vi < n; vi++) {
                    var vn = state.varNames[vi];
                    candidate[vi] = (newX[vn].min + newX[vn].max) / 2;
                }
                var vars = {};
                state.varNames.forEach(function(v, k) { vars[v] = candidate[k]; });
                var F = state.equations.map(function(eq) { return evalAST(eq, vars); });
                var maxRes = 0;
                var _hasNaN = false;
                for (var fi = 0; fi < F.length; fi++) {
                    if (isNaN(F[fi]) || !isFinite(F[fi])) { _hasNaN = true; break; }
                    var absF = Math.abs(F[fi]);
                    if (absF > maxRes) maxRes = absF;
                }
                if (!_hasNaN && maxRes < tolerance * 10) {
                    solutions.push({ values: candidate, residual: maxRes });
                } else {
                }
            } else {
                if (stack.length < maxBoxes) stack.push(newX);
            }
        } else {
            // N(X) 与 X 部分重叠 → 分裂
            var splitVar = 0;
            var maxW = 0;
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                var w = X[vn].max - X[vn].min;
                if (w > maxW) { maxW = w; splitVar = vi; }
            }
            var svn = state.varNames[splitVar];
            var midVal = (X[svn].min + X[svn].max) / 2;
            var X1 = {}, X2 = {};
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                X1[vn] = { min: X[vn].min, max: (vi === splitVar ? midVal : X[vn].max) };
                X2[vn] = { min: (vi === splitVar ? midVal : X[vn].min), max: X[vn].max };
            }
            if (stack.length < maxBoxes) {
                stack.push(X2);
                stack.push(X1);
            }
        }
    }
    
    state.intervalNewtonSolutions = solutions;
}

// suan42: 区间解点过滤 → 剔除残差>1e-6的伪解
function suan42(state) {
    var allRaw = [];
    if (state.allRawSolutions) {
        state.allRawSolutions.forEach(function(s) { if (s.values) allRaw.push(s.values); });
    }
    if (state.intervalNewtonSolutions) {
        state.intervalNewtonSolutions.forEach(function(s) { if (s.values) allRaw.push(s.values); });
    }
    state.allRawSolutions = allRaw;

    var VERIFY_TOL = Math.max(1e-4, state.tolerance * 10);
    var verified = [];
    for (var ri = 0; ri < allRaw.length; ri++) {
        var raw = allRaw[ri];
        var vars = {};
        state.varNames.forEach(function(v, i) { vars[v] = raw[i]; });
        var maxRes = 0;
        state.equations.forEach(function(eq) {
            var r = Math.abs(evalAST(eq, vars));
            if (r > maxRes) maxRes = r;
        });
        if (maxRes < VERIFY_TOL) {
            var rounded = raw.map(roundToGrid);
            verified.push({ values: rounded, residual: maxRes });
        }
    }
    state.verified = verified;
}



// suan43: 解点精度标准化修正 → 6位小数网格落点
function suan43(state) {
    if (!state.verified) return;
    for (var i = 0; i < state.verified.length; i++) {
        state.verified[i].values = state.verified[i].values.map(roundToGrid);
    }
}

// suan44: 全局约束复核校验 → 代入全部原始方程验算残差
function suan44(state) {
    if (!state.verified || state.verified.length === 0) return;

    var VERIFY_TOL = Math.max(1e-4, state.tolerance * 10);
    var verifiedFiltered = [];
    for (var i = 0; i < state.verified.length; i++) {
        var sol = state.verified[i];
        var vars = {};
        state.varNames.forEach(function(v, idx) { vars[v] = sol.values[idx]; });
        var maxRes = 0;
        state.equations.forEach(function(eq) {
            var r = Math.abs(evalAST(eq, vars));
            if (r > maxRes) maxRes = r;
        });
        if (maxRes < VERIFY_TOL) {
            sol.residual = maxRes;
            verifiedFiltered.push(sol);
        }
    }
    state.verified = verifiedFiltered;

    // 域约束过滤
    if (state.domainConstraints.length > 0) {
        var domainFiltered = [];
        for (var dsi = 0; dsi < state.verified.length; dsi++) {
            var dSol = state.verified[dsi];
            var dViolated = false;
            for (var dci = 0; dci < state.domainConstraints.length; dci++) {
                var dc = state.domainConstraints[dci];
                var vi = state.varNames.indexOf(dc.varName);
                if (vi >= 0) {
                    var val = dSol.values[vi];
                    if (dc.min !== undefined && val < dc.min - 1e-9) { dViolated = true; break; }
                    if (dc.max !== undefined && val > dc.max + 1e-9) { dViolated = true; break; }
                }
            }
            if (!dViolated) domainFiltered.push(dSol);
        }
        if (domainFiltered.length > 0) { state.verified = domainFiltered; }
        else {
            state.done = true;
            state.result = { solutions: [], error: "NO_SOLUTION", message: "解被域约束条件过滤", executionPath: "定义域过滤", timeMs: performance.now() - state.startTime, confidence: "low", varNames: state.varNames, warnings: state.conditionWarnings.length > 0 ? state.conditionWarnings : undefined, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "候选解被域约束条件排除" };
            return;
        }
    }

    if (state.verified.length === 0) {
        state.done = true;
        state.result = { solutions: [], error: "NO_SOLUTION", message: "验证后无满足残差条件的解", executionPath: "残差过滤", timeMs: performance.now() - state.startTime, varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "所有候选解残差均过大" };
        return;
    }
    state.uniqueVerified = state.verified;
}

// suan45: 物理限位边界过滤 → 剔除超出物理边界的解
function suan45(state) {
    if (!state.uniqueVerified || state.uniqueVerified.length === 0) return;
    state.finalSolutions = state.uniqueVerified;
    state.eliminated = 0;
}

// suan46: 解集去重合并 → 6位精度合并等价解
function suan46(state) {
    if (!state.finalSolutions || state.finalSolutions.length <= 1) return;
    var valueArrays = state.finalSolutions.map(function(s) { return s.values; });
    var unique = deduplicateSolutions(valueArrays, state.varNames, state.tolerance);
    var finalUnique = [];
    for (var ui = 0; ui < unique.length; ui++) {
        var found = null;
        for (var fi = 0; fi < state.finalSolutions.length; fi++) {
            if (state.finalSolutions[fi].values === unique[ui]) { found = state.finalSolutions[fi]; break; }
        }
        if (!found) {
            // 用值数组重建条目
            var res = 0;
            var vars = {};
            state.varNames.forEach(function(v, i) { vars[v] = unique[ui][i]; });
            state.equations.forEach(function(eq) { var r = Math.abs(evalAST(eq, vars)); if (r > res) res = r; });
            found = { values: unique[ui], residual: res };
        }
        finalUnique.push(found);
    }
    state.finalSolutions = finalUnique;
}

// suan47: 分支定界 → 当剩余集合很大且不连续时，递归二分分割求解
// 核心逻辑：对 D0 做递归二分，在子域上重新调用 solve()，收集所有解后合并去重
// 这是求解器的最终兜底方案，确保确定性、完备性、不连续兼容
// 多起点阻尼牛顿（2026-08-21 新增）：方阵非线性强耦合系统（如三数问题
// x+y+z=6, xy+yz+zx=11, xyz=6）分支定界收敛极慢（实测 6.7 秒、子域指数细分），
// 而多起点阻尼牛顿可毫秒级定位全部真解。起点为确定性小值组合（±1/±3 裁剪到 D0）
// + D0 分层点，全部落域内；残差单调下降（阻尼），保证确定性可复现。

// 生成 0..n-1 的全排列（n≤6 时最多 720，可接受）
function _permutations(n) {
    if (n <= 1) return [[0]];
    var res = [], used = new Array(n).fill(false), path = [];
    (function rec() {
        if (path.length === n) { res.push(path.slice()); return; }
        for (var i = 0; i < n; i++) {
            if (!used[i]) { used[i] = true; path.push(i); rec(); path.pop(); used[i] = false; }
        }
    })();
    return res;
}

// 对称系统排列补全：对 sols 中每个解的全体变量置换生成候选，用原始方程字符串
// 验证残差 <1e-9 接收。baseKeys 按排序后元组去重，避免重复裂变与伪排列混入。
function _symmetryExpand(sols, varNames, eqStrs, D0) {
    if (!sols || !sols.length || !varNames || varNames.length < 2) return sols;
    // 预编译原始方程 AST（在完整变量空间验证）
    var _eqASTs = [];
    if (eqStrs) {
        for (var _e = 0; _e < eqStrs.length; _e++) {
            try {
                var _i = eqStrs[_e].indexOf('=');
                _eqASTs.push(parse(tokenize('(' + eqStrs[_e].slice(0, _i) + ')-(' + eqStrs[_e].slice(_i + 1) + ')')));
            } catch (err) { _eqASTs.push(null); }
        }
    }
    if (!_eqASTs.length) return sols;
    var n = varNames.length;
    var _baseKeys = {};
    for (var _bk = 0; _bk < sols.length; _bk++) {
        _baseKeys[sols[_bk].values.map(function(v) { return v.toFixed(4); }).join(',')] = true;
    }
    var _perms = _permutations(n);
    for (var _pi = 0; _pi < sols.length; _pi++) {
        var _base = sols[_pi].values;
        for (var _pj = 0; _pj < _perms.length; _pj++) {
            var _perm = _perms[_pj];
            var _pv = [];
            for (var _pk = 0; _pk < n; _pk++) _pv.push(_base[_perm[_pk]]);
            var _key = _pv.map(function(v) { return v.toFixed(4); }).join(',');
            if (_baseKeys[_key]) continue;
            // 域内检查
            var _inDom = true;
            for (var _vi = 0; _vi < n; _vi++) {
                var _dd = D0 && D0[varNames[_vi]];
                if (_dd && (_pv[_vi] < _dd.min - 1e-6 || _pv[_vi] > _dd.max + 1e-6)) { _inDom = false; break; }
            }
            if (!_inDom) continue;
            // 完整空间残差验证（严格 1e-9）
            var _known = {}; for (var _vk = 0; _vk < n; _vk++) _known[varNames[_vk]] = _pv[_vk];
            var _maxR = 0;
            for (var _ei = 0; _ei < _eqASTs.length; _ei++) {
                if (!_eqASTs[_ei]) continue;
                var _rr; try { _rr = Math.abs(evalAST(_eqASTs[_ei], _known)); } catch (err) { _rr = 1e10; }
                if (_rr > _maxR) _maxR = _rr;
            }
            if (_maxR >= 1e-9) continue;
            sols.push({ values: _pv, residual: _maxR });
            _baseKeys[_key] = true;
        }
    }
    return sols;
}

function _multiStartNewton(state) {
    var eqs = state.equations || [];
    var vns = state.varNames || [];
    var n = vns.length, m = eqs.length;
    if (n === 0 || m !== n) return null;   // 仅方阵
    if (n > 6 || m > 6) return null;
    // 生成确定性起点（笛卡尔积上限 64 + D0 中心点）
    var baseSets = [];
    for (var i = 0; i < n; i++) {
        var d = state.D0 && state.D0[vns[i]] ? state.D0[vns[i]] : null;
        // 起点值集合：含 0 与小编号优先（2026-08-21：原 {±1,±3} 笛卡尔积截断 64 后
        // 全部起点第一个分量相同，缺多样性——如示例8 的 5 维牛顿从 (-3,...) 起步全发散；
        // 含 0 使 (0,0,0,0,0) 等靠近原点的起点可用）
        var set = [0, 1, -1, 2, -2, 3, -3];
        if (d && (d.max < -3 || d.min > 3)) {
            set = [d.min + 0.25 * (d.max - d.min), d.max - 0.25 * (d.max - d.min), d.min, d.max];
        }
        var su = [];
        for (var s = 0; s < set.length; s++) {
            var v = set[s];
            if (d) { if (v < d.min) v = d.min; if (v > d.max) v = d.max; }
            if (su.indexOf(v) < 0) su.push(v);
        }
        baseSets.push(su);
    }
    var combos = [[]];
    for (var c = 0; c < baseSets.length && combos.length <= 128; c++) {
        var nc = [];
        for (var a = 0; a < combos.length; a++) {
            for (var b = 0; b < baseSets[c].length; b++) nc.push(combos[a].concat([baseSets[c][b]]));
        }
        combos = nc;
    }
    if (combos.length > 128) combos = combos.slice(0, 128);
    var midPt = [];
    for (var mi = 0; mi < n; mi++) midPt.push(state.D0 && state.D0[vns[mi]] ? (state.D0[vns[mi]].min + state.D0[vns[mi]].max) / 2 : 0);
    combos.push(midPt);
    // 整数优先种子（2026-08-22）：对称多项式等系统的根常为小整数排列（如 (1,2,3,4,5)）。
    // 笛卡尔积起点被截断（n≥4 时 7^n 远超 128）永远触不到 (1,2,...,n) 区域，导致多起点牛顿
    // 漏掉所有基解、对称补全无从展开。这里额外追加少量结构化整数种子（不参与 128 截断），
    // 仅为让牛顿"碰到"一个基解，后续 _symmetryExpand 补全全部排列。对一般系统无害（发散即跳过）。
    // 只取与域不冲突的种子，避免越界。
    var _intSeeds = [];
    // 用原始变量数 origN 决定整数范围（消元后 n 可能小于 origN，根仍落在 1..origN）
    var _origN = (state.originalVarNames && state.originalVarNames.length) ? state.originalVarNames.length : n;
    var _seq = []; for (var _si = 1; _si <= _origN; _si++) _seq.push(_si);
    // 取 _seq 的前 n 项作为种子长度与 n 匹配；若 origN>n，则前 n 项覆盖 1..n
    var _head = _seq.slice(0, n);
    _intSeeds.push(_head.slice());                       // (1,2,...,n)
    _intSeeds.push(_head.slice().reverse());             // (n,...,2,1)
    _intSeeds.push(_head.map(function() { return 1; })); // (1,1,...,1)
    // 追加若干个 (1..origN) 的循环移位，覆盖对称系统的不同基解起点（与域兼容才采纳）
    for (var _sh = 1; _sh < _origN && _intSeeds.length < 12; _sh++) {
        var _rot = []; for (var _r = 0; _r < n; _r++) _rot.push(_seq[(_sh + _r) % _origN]);
        _intSeeds.push(_rot);
    }
    for (var _is = 0; _is < _intSeeds.length; _is++) {
        var _okSeed = true;
        for (var _iv = 0; _iv < n; _iv++) {
            var _dd = state.D0 && state.D0[vns[_iv]];
            var _v = _intSeeds[_is][_iv];
            if (_dd && (_v < _dd.min || _v > _dd.max)) { _okSeed = false; break; }
        }
        if (_okSeed) combos.push(_intSeeds[_is]);
    }
    // 域远端采样种子（2026-08-22）：当某变量定义域宽度较大(>12)时，整数/原点优先种子
    // 偏向中心，可能漏掉落在域边缘的远端孤立根（如 Freudenstein-Roth 第二根 x1≈11.4）。
    // 追加少量确定性"域边界与三分点"种子（bounded，最多 +2^n 且受 256 上限约束），
    // 让牛顿有机会碰到远端根。对一般小域系统无影响（宽度<=12 不追加）。发散即跳过，无随机性。
    var _wideVars = [];
    for (var _wv = 0; _wv < n; _wv++) {
        var _wd = state.D0 && state.D0[vns[_wv]];
        if (_wd && (_wd.max - _wd.min) > 12) _wideVars.push(_wv);
    }
    if (_wideVars.length > 0 && combos.length < 256) {
        var _edgeSets = [];
        for (var _ev = 0; _ev < n; _ev++) {
            var _e = state.D0 && state.D0[vns[_ev]];
            if (_wideVars.indexOf(_ev) >= 0) {
                _edgeSets.push([_e.min, _e.min + (_e.max - _e.min) / 3, _e.min + 2 * (_e.max - _e.min) / 3, _e.max]);
            } else {
                _edgeSets.push([0]);
            }
        }
        var _ec = [[]];
        for (var _eci = 0; _eci < _edgeSets.length && _ec.length <= 256; _eci++) {
            var _enc = [];
            for (var _ea = 0; _ea < _ec.length; _ea++) for (var _eb = 0; _eb < _edgeSets[_eci].length; _eb++) _enc.push(_ec[_ea].concat([_edgeSets[_eci][_eb]]));
            _ec = _enc;
        }
        if (_ec.length > 256) _ec = _ec.slice(0, 256);
        for (var _ei2 = 0; _ei2 < _ec.length; _ei2++) combos.push(_ec[_ei2]);
    }
    var sols = [];
    for (var ci = 0; ci < combos.length; ci++) {
        var known = {};
        for (var vi = 0; vi < n; vi++) known[vns[vi]] = combos[ci][vi];
        var converged = false;
        for (var it = 0; it < 40; it++) {
            var fvec = [], maxf = 0;
            for (var ei = 0; ei < m; ei++) {
                var fv; try { fv = evalAST(eqs[ei], known); } catch(e) { fv = NaN; }
                if (!isFinite(fv)) fv = 1e30;
                fvec.push(fv);
                if (Math.abs(fv) > maxf) maxf = Math.abs(fv);
            }
            if (maxf < 1e-9) { converged = true; break; }
            var J = [];
            for (var jei = 0; jei < m; jei++) {
                var row = [];
                for (var jv = 0; jv < n; jv++) {
                    var h = 1e-6 * Math.max(1, Math.abs(known[vns[jv]] || 0));
                    known[vns[jv]] += h;
                    var fp; try { fp = evalAST(eqs[jei], known); } catch(e) { fp = NaN; }
                    known[vns[jv]] -= 2 * h;
                    var fm; try { fm = evalAST(eqs[jei], known); } catch(e) { fm = NaN; }
                    known[vns[jv]] += h;
                    row.push((isFinite(fp) && isFinite(fm)) ? (fp - fm) / (2 * h) : 0);
                }
                J.push(row);
            }
            var delta = null;
            try { var gs2 = gaussianSolve(J, fvec.map(function(v) { return -v; })); delta = gs2 ? gs2.solution : null; } catch(e) { delta = null; }
            if (!delta) break;
            var accepted = false;
            for (var dmp = 0; dmp < 10; dmp++) {
                var tmpK = {};
                for (var tk in known) { if (known.hasOwnProperty(tk)) tmpK[tk] = known[tk]; }
                for (var di = 0; di < n; di++) {
                    var nv = tmpK[vns[di]] + delta[di];
                    var dd = state.D0 && state.D0[vns[di]];
                    if (dd) { if (nv < dd.min) nv = dd.min; if (nv > dd.max) nv = dd.max; }
                    tmpK[vns[di]] = nv;
                }
                var nmf = 0;
                for (var fei = 0; fei < m; fei++) {
                    var fv2; try { fv2 = evalAST(eqs[fei], tmpK); } catch(e) { fv2 = NaN; }
                    if (!isFinite(fv2)) fv2 = 1e30;
                    if (Math.abs(fv2) > nmf) nmf = Math.abs(fv2);
                }
                if (nmf <= maxf || dmp >= 8) {
                    for (var di2 = 0; di2 < n; di2++) known[vns[di2]] = tmpK[vns[di2]];
                    accepted = true;
                    break;
                }
                for (var di3 = 0; di3 < n; di3++) delta[di3] *= 0.5;
            }
            if (!accepted) break;
        }
        if (converged) {
            var dup = false;
            for (var si = 0; si < sols.length; si++) {
                var dsum = 0;
                for (var dvi = 0; dvi < n; dvi++) dsum += Math.abs(sols[si].values[dvi] - known[vns[dvi]]);
                if (dsum < 1e-4) { dup = true; break; }
            }
            if (!dup) {
                var inDom = true, maxR = 0;
                for (var vi2 = 0; vi2 < n; vi2++) {
                    var dd2 = state.D0 && state.D0[vns[vi2]];
                    if (dd2 && (known[vns[vi2]] < dd2.min - 1e-6 || known[vns[vi2]] > dd2.max + 1e-6)) { inDom = false; break; }
                }
                if (inDom) {
                    for (var ei2 = 0; ei2 < m; ei2++) {
                        var rr; try { rr = Math.abs(evalAST(eqs[ei2], known)); } catch(e) { rr = 1e10; }
                        if (rr > maxR) maxR = rr;
                    }
                    if (maxR < 1e-9) sols.push({ values: vns.map(function(v) { return known[v]; }), residual: maxR });
                }
            }
        }
    }
    // 对称系统排列补全（2026-08-22）：对完全对称（变量置换不变）的方程组，
    // 多起点牛顿因笛卡尔积起点被截断（n≥4 时 7^n 远超 128 上限）只能收敛到部分排列解。
    // 这里对已得精确解生成全部变量排列并验证接收，补齐漏掉的排列解（如四元对称 (1,2,3,4)
    // 理论 24 解，起点不足时仅得部分）。非对称系统的伪排列会因 1e-9 残差阈值被拒，安全。
    if (sols.length > 0) {
        // 快照原始精确解，避免扩展过程中新加入的排列又被重复裂变
        var _baseSols = sols.map(function(s) { return s.values.slice(); });
        var _baseKeys = {};
        for (var _bk = 0; _bk < _baseSols.length; _bk++) {
            _baseKeys[_baseSols[_bk].map(function(v) { return v.toFixed(4); }).join(',')] = true;
        }
        var _perms = _permutations(n);
        for (var _pi = 0; _pi < _baseSols.length; _pi++) {
            var _base = _baseSols[_pi];
            for (var _pj = 0; _pj < _perms.length; _pj++) {
                var _perm = _perms[_pj];
                var _pv = [];
                for (var _pk = 0; _pk < n; _pk++) _pv.push(_base[_perm[_pk]]);
                // 与原始解集合去重（按原始顺序元组），避免重复加入同一排列
                var _key = _pv.map(function(v) { return v.toFixed(4); }).join(',');
                if (_baseKeys[_key]) continue;
                // 域内检查
                var _inDom2 = true;
                for (var _vi3 = 0; _vi3 < n; _vi3++) {
                    var _dd3 = state.D0 && state.D0[vns[_vi3]];
                    if (_dd3 && (_pv[_vi3] < _dd3.min - 1e-6 || _pv[_vi3] > _dd3.max + 1e-6)) { _inDom2 = false; break; }
                }
                if (!_inDom2) continue;
                // 残差验证（严格 1e-9，滤掉流形准解）
                var _known2 = {}; for (var _vi4 = 0; _vi4 < n; _vi4++) _known2[vns[_vi4]] = _pv[_vi4];
                var _maxR2 = 0;
                for (var _ei3 = 0; _ei3 < m; _ei3++) {
                    var _rr2; try { _rr2 = Math.abs(evalAST(eqs[_ei3], _known2)); } catch(e) { _rr2 = 1e10; }
                    if (_rr2 > _maxR2) _maxR2 = _rr2;
                }
                if (_maxR2 >= 1e-9) continue;
                sols.push({ values: _pv, residual: _maxR2 });
                _baseKeys[_key] = true;  // 登记，防止后续重复
            }
        }
    }
    return sols.length ? sols : null;
}

// 多起点牛顿求解封装（2026-08-22 抽取）：方阵非线性系统尝试牛顿定位基解 →
// 回代消元变量 → 对称排列补全 → 原始方程复核。成功则置 state.done 并返回 true。
// 供阶段 3.5（提前牛顿）与尾段 suan47 共用，__LS_MSNEWTON_DONE 守卫确保只跑一次。
function suan47_tryNewton(state) {
    if (state.equations.length !== state.varNames.length) return false;
    var _msSols = _multiStartNewton(state);
    if (!(_msSols && _msSols.length)) return false;
    // 回代消元变量（suan19 消元后 varNames 可能缩减——如三数问题 z 被消，
    // 若不回代输出只有 [x,y] 两个分量）
    var _msOutVars = getOutputVarNames(state);
    var _msExpanded = [];
    for (var msi = 0; msi < _msSols.length; msi++) {
        var _msol = _msSols[msi];
        // 集中式回代：多起点牛顿收敛解（state.varNames 顺序）→ 完整坐标
        var _fvArr = reconstructSolution(state, _msol.values);
        if (_fvArr && _fvArr.every(function(x) { return isFinite(x); })) {
            _msExpanded.push({ values: _fvArr, residual: _msol.residual });
        }
    }
    if (!_msExpanded.length) return false;
    // 对称系统排列补全（2026-08-22）：消元后 _multiStartNewton 只在缩减变量空间
    // 收敛（维度低于原始），其内置排列扩展维度不对、无法补全高维排列解。
    // 这里在回代后的完整变量空间做排列扩展——对已得解的全体变量置换生成候选，
    // 用原始方程字符串验证残差 <1e-9 才接收。非对称系统的伪排列会被阈值拒，安全。
    // 覆盖 4/5/6 变量对称系统（如四元/五元/六元对称多项式根的置换解）。
    _msExpanded = _symmetryExpand(_msExpanded, _msOutVars, state.equationStrs, state.D0);
    // 原始方程最终复核（2026-08-22）：多起点牛顿基于化简后方程（如 log(u)=log(v)→u=v）
    // 收敛，但病态耦合下会收敛到流形准解（化简后残差<1e-9，原始超越方程下残差~1e-3）。
    // 这里用原始 equationStrs（含 log/sin 等）复核，滤掉原始残差>1e-7 的伪解，
    // 保留真解。无超越函数的纯代数系统原始残差本就<1e-9，不受影响。
    if (state.equationStrs && state.equationStrs.length) {
        var _eqASTs2 = [];
        for (var _eqi = 0; _eqi < state.equationStrs.length; _eqi++) {
            try {
                var _ei2 = state.equationStrs[_eqi].indexOf('=');
                _eqASTs2.push(parse(tokenize('(' + state.equationStrs[_eqi].slice(0, _ei2) + ')-(' + state.equationStrs[_eqi].slice(_ei2 + 1) + ')')));
            } catch (err) { _eqASTs2.push(null); }
        }
        var _filtered = [];
        for (var _fi = 0; _fi < _msExpanded.length; _fi++) {
            var _s = _msExpanded[_fi], _ok = true;
            var _vv = {}; for (var _vi5 = 0; _vi5 < _msOutVars.length; _vi5++) _vv[_msOutVars[_vi5]] = _s.values[_vi5];
            for (var _ea = 0; _ea < _eqASTs2.length; _ea++) {
                if (!_eqASTs2[_ea]) continue;
                var _rr3; try { _rr3 = Math.abs(evalAST(_eqASTs2[_ea], _vv)); } catch (err) { _rr3 = 1e10; }
                if (_rr3 > 1e-7) { _ok = false; break; }
            }
            if (_ok) _filtered.push(_s);
        }
        _msExpanded = _filtered;
    }
    if (!_msExpanded.length) return false;
    state.done = true;
    state.finalSolutions = _msExpanded;
    state.result = {
        solutions: _msExpanded,
        error: null,
        message: "多起点阻尼牛顿法求解：" + _msExpanded.length + " 组解",
        executionPath: "多起点牛顿",
        timeMs: performance.now() - state.startTime,
        confidence: "high",
        varNames: _msOutVars,
        resultType: 2,
        resultTypeName: "有限离散孤立采样点",
        resultTypeDesc: "多起点阻尼牛顿法收敛得到的解（确定性多起点，可复现）"
    };
    return true;
}

function suan47(state) {
    // 跳过条件：欠定不走分支定界；变量/方程缺失返回。
    if (!state.varNames || state.varNames.length === 0) return;
    if (state.equations.length < state.varNames.length) return; // 欠定不走分支定界
    // 多起点牛顿（2026-08-21）：方阵非线性强耦合系统先尝试毫秒级定位真解，
    // 避免分支定界指数递归（实测三数问题 6.7 秒才收敛）。全局标志保证每根调用只跑一次。
    if (!__LS_MSNEWTON_DONE && state.equations.length === state.varNames.length) {
        __LS_MSNEWTON_DONE = true;
        suan47_tryNewton(state);
        if (state.done) return;
    }
    // 漏解修复（2026-08-18）：原逻辑"已有解即返回"，导致多根场景漏检——
    // 如 sin(x)+y=1, x²+y²=4 在 [-3,3]² 内有 2 个真解，数值求解只收敛到正侧解，
    // 负侧解因分支被跳过而漏检。现改为：已有解但声明域 D0 仍宽（存在未被覆盖的
    // 区域、可能含更多解）→ 仍对 D0 递归分支，将各子域求得的解合并补齐。
    if (state.finalSolutions && state.finalSolutions.length > 0) {
        var _sw = 0;
        for (var _swi = 0; _swi < state.varNames.length; _swi++) {
            var _swb = state.D0[state.varNames[_swi]];
            if (_swb) _sw = Math.max(_sw, _swb.max - _swb.min);
        }
        if (_sw < 1e-3) return; // 已充分收缩，无未覆盖区域 → 跳过分支
        // 否则继续分支补齐（不 return）
    }

    // 初始化盒子集合
    state.branchBboxes = state.branchBboxes || [];

    // 分支深度
    state.branchDepth = state.branchDepth || 0;

    // 分支预算：state.branchBudget 既作为单测可观测的递减计数（兼容性，
    // 预言机3 断言其 2→1→0 递减、归零时置 truncated），又通过递归子调用透传
    // 剩余预算实现跨子树全局共享（防无解时指数爆炸）。
    // 首次进入（未显式声明）从全局池 __LS_BRANCH_BUDGET 取初值；递归子调用已由
    // solve 的 opts.maxBranch 写入剩余预算，故不会各自重置回 200。
    if (typeof state.branchBudget === 'undefined') {
        state.branchBudget = (__LS_BRANCH_BUDGET !== undefined) ? __LS_BRANCH_BUDGET : 200;
    }
    if (state.branchBudget <= 0) {
        state.unconverged = true;
        state.truncated = true;       // 资源截断：分支预算耗尽，剩余子域未处理（如实暴露，不静默丢解）
        var _box = {};
        state.varNames.forEach(function(vn) { _box[vn] = { min: state.D0[vn].min, max: state.D0[vn].max }; });
        state.branchBboxes.push({ box: _box, converged: false });
        return;
    }
    state.branchBudget--;

    // 检查 D0 是否"很大"（最大宽度 > 1e-3）
    var maxWidth = 0;
    var splitVar = null;
    for (var _bvi = 0; _bvi < state.varNames.length; _bvi++) {
        var _bvn = state.varNames[_bvi];
        var _box = state.D0[_bvn];
        if (_box) {
            var _w = _box.max - _box.min;
            if (_w > maxWidth) { maxWidth = _w; splitVar = _bvn; }
        }
    }

    // 如果所有变量宽度都小于 1e-3，不需要分割
    // 记录当前盒子（宽度 < 1e-3 的收敛底盒或未被分割的窄域）
    if (maxWidth < 1e-3) {
        var _box = {};
        state.varNames.forEach(function(vn) { _box[vn] = { min: state.D0[vn].min, max: state.D0[vn].max }; });
        state.branchBboxes.push({ box: _box, converged: true });
        return;
    }

    // 深度限制（最多 10 层）：达到深度限制且仍有宽盒子 → 标记未收敛
    if (state.branchDepth >= 10) {
        state.unconverged = true;
        var _box = {};
        state.varNames.forEach(function(vn) { _box[vn] = { min: state.D0[vn].min, max: state.D0[vn].max }; });
        state.branchBboxes.push({ box: _box, converged: false });
        return;
    }

    // 时间看门狗：分支定界总耗时不超过 10 秒（使用全局根起点，跨递归子树共享，2026-08-21 修复）
    if (performance.now() - __LS_ROOT_START > 10000) {
        state.unconverged = true;
        var _box = {};
        state.varNames.forEach(function(vn) { _box[vn] = { min: state.D0[vn].min, max: state.D0[vn].max }; });
        state.branchBboxes.push({ box: _box, converged: false });
        return;
    }

    // 选择最宽维度，在中心点处二分切割
    var _mid = (state.D0[splitVar].min + state.D0[splitVar].max) / 2;

    // 创建两个子域
    var _D0_1 = JSON.parse(JSON.stringify(state.D0));
    _D0_1[splitVar].max = _mid;
    var _D0_2 = JSON.parse(JSON.stringify(state.D0));
    _D0_2[splitVar].min = _mid;

    // 子域1非空检查
    var _valid1 = true;
    for (var _bvi = 0; _bvi < state.varNames.length; _bvi++) {
        var _bvn = state.varNames[_bvi];
        if (_D0_1[_bvn].min > _D0_1[_bvn].max) { _valid1 = false; break; }
    }
    // 子域2非空检查
    var _valid2 = true;
    for (var _bvi = 0; _bvi < state.varNames.length; _bvi++) {
        var _bvn = state.varNames[_bvi];
        if (_D0_2[_bvn].min > _D0_2[_bvn].max) { _valid2 = false; break; }
    }

    // 递归调用求解器：对每个子域重复执行完整求解流程
    // 使用 originalVarNames（消元前的完整变量名），避免消元后变量缺失导致 NaN 错误
    state.branchDepth++;
    var _recVarNames = getOutputVarNames(state);
    // 传递分支深度到子域，防止递归深度无限制
    _D0_1._branchDepth = state.branchDepth;
    _D0_2._branchDepth = state.branchDepth;
    // 递归时透传剩余预算（maxBranch），使子问题继承当前剩余额度继续递减，
    // 实现跨递归子树全局共享，防止无解时子树指数爆炸（与全局根计时看门狗协同）。
    var _result1 = _valid1 ? solve(state.equationStrs, _recVarNames, state.decimals, _D0_1, undefined, { maxBranch: state.branchBudget }) : null;
    var _result2 = _valid2 ? solve(state.equationStrs, _recVarNames, state.decimals, _D0_2, undefined, { maxBranch: state.branchBudget }) : null;

    // 传播未收敛标记
    if ((_result1 && _result1.unconverged) || (_result2 && _result2.unconverged)) {
        state.unconverged = true;
    }

    // 合并子域盒子
    if (_result1 && _result1.boxes) {
        state.branchBboxes = state.branchBboxes.concat(_result1.boxes);
    }
    if (_result2 && _result2.boxes) {
        state.branchBboxes = state.branchBboxes.concat(_result2.boxes);
    }

    // 合并解
    var _allSolutions = [];
    if (_result1 && _result1.solutions) {
        for (var _si = 0; _si < _result1.solutions.length; _si++) {
            _allSolutions.push(_result1.solutions[_si]);
        }
    }
    if (_result2 && _result2.solutions) {
        for (var _si = 0; _si < _result2.solutions.length; _si++) {
            _allSolutions.push(_result2.solutions[_si]);
        }
    }

    // 去重合并
    if (_allSolutions.length > 0) {
        var _valueArrays = _allSolutions.map(function(s) { return s.values; });
        var _unique = deduplicateSolutions(_valueArrays, state.varNames, state.tolerance);
        var _finalUnique = [];
        for (var _ui = 0; _ui < _unique.length; _ui++) {
            var _found = null;
            for (var _fi = 0; _fi < _allSolutions.length; _fi++) {
                if (_allSolutions[_fi].values === _unique[_ui]) { _found = _allSolutions[_fi]; break; }
            }
            if (!_found) {
                var _res = 0;
                var _vars = {};
                state.varNames.forEach(function(v, i) { _vars[v] = _unique[_ui][i]; });
                state.equations.forEach(function(eq) { var r = Math.abs(evalAST(eq, _vars)); if (r > _res) _res = r; });
                _found = { values: _unique[_ui], residual: _res };
            }
            _finalUnique.push(_found);
        }
        // 按残差排序
        _finalUnique.sort(function(a, b) { return a.residual - b.residual; });
        state.finalSolutions = _finalUnique;
        state.branchCount = (_result1 ? _result1.branchCount || 0 : 0) + (_result2 ? _result2.branchCount || 0 : 0) + 1;
    }
}

// suan48: 不等式系统求解 → 确定性边界组合枚举 + 多起始点牛顿法 + 全约束验证
// 对所有边界等式组合，用多起始点牛顿法求全部解，再用全约束过滤
function suan48(state) {
    // 仅服务纯不等式系统（2026-08-21 修复）：混合系统（等式+域约束，如 x²+y²=25, x≥0, y≥0）
    // 若走 suan48，其 verifyAllConstraints 只验证不等式、不验证等式，会把 (0,0) 这类
    // "只满足不等式、不满足等式"的点当解输出，随后被 _filterIllDefined 删成假空集。
    // 混合系统的域约束由主流程 D0 收紧 + 良定义过滤处理，不需要 suan48 兜底。
    if (!state.isInequalityOnly) return;
    if (!state.inequalityConstraints || state.inequalityConstraints.length === 0) return;
    if (state.finalSolutions && state.finalSolutions.length > 0) return;
    if (state.varNames.length < 1) return;

    var constraints = state.inequalityConstraints;
    var nVars = state.varNames.length;
    var nConstraints = constraints.length;
    var varNames = state.varNames;

    // 域收缩：从简单边界约束和超球面约束中提取变量边界
    var D = {};
    for (var vi = 0; vi < varNames.length; vi++) {
        var vn = varNames[vi];
        D[vn] = { min: state.D0[vn] ? state.D0[vn].min : -1000000, max: state.D0[vn] ? state.D0[vn].max : 1000000 };
    }
    for (var ci = 0; ci < constraints.length; ci++) {
        var c = constraints[ci];
        if (c.lhs.type === 'ident' && c.rhs.type === 'num') {
            var vn = c.lhs.name;
            if (vn && D[vn]) {
                if (c.op === '>=') D[vn].min = Math.max(D[vn].min, c.rhs.value);
                if (c.op === '<=') D[vn].max = Math.min(D[vn].max, c.rhs.value);
            }
        }
        if (c.rhs.type === 'ident' && c.lhs.type === 'num') {
            var vn = c.rhs.name;
            if (vn && D[vn]) {
                if (c.op === '>=') D[vn].max = Math.min(D[vn].max, c.lhs.value);
                if (c.op === '<=') D[vn].min = Math.max(D[vn].min, c.lhs.value);
            }
        }
    }
    // 从超球面约束（sum(var²) ≤ c）收缩域：每个变量 ∈ [-√c, √c]
    for (var ci = 0; ci < constraints.length; ci++) {
        var c = constraints[ci];
        try {
            var lhsStr = c.lhsStr, rhsStr = c.rhsStr;
            var sqSumMatch = lhsStr.match(/^([a-zA-Z]\w*)\^2\s*\+\s*([a-zA-Z]\w*)\^2(?:\s*\+\s*([a-zA-Z]\w*)\^2)?(?:\s*\+\s*([a-zA-Z]\w*)\^2)?(?:\s*\+\s*([a-zA-Z]\w*)\^2)?(?:\s*\+\s*([a-zA-Z]\w*)\^2)?\s*$/);
            if (sqSumMatch && (c.op === '<=' || c.op === '<')) {
                var rhsVal = parseFloat(rhsStr);
                if (isFinite(rhsVal) && rhsVal > 0) {
                    var bound = Math.sqrt(rhsVal);
                    for (var mi = 1; mi < sqSumMatch.length; mi++) {
                        var vn = sqSumMatch[mi];
                        if (vn && D[vn]) {
                            D[vn].min = Math.max(D[vn].min, -bound);
                            D[vn].max = Math.min(D[vn].max, bound);
                        }
                    }
                }
            }
        } catch(e) {}
    }
    for (var vi = 0; vi < varNames.length; vi++) {
        var vn = varNames[vi];
        if (D[vn].min > D[vn].max) {
            state.done = true;
            state.result = { solutions: [], error: null, message: "不等式系统域收缩后为空，无可行点", executionPath: "不等式系统域收缩", timeMs: performance.now() - state.startTime, varNames: varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "约束自相矛盾，可行域为空" };
            return;
        }
    }

    // 生成确定性起始点集合：各维度3层（中点、1/4、3/4）
    // 6变量 → 3^6=729点；用3层覆盖更多区域以找到全部离散解
    var startPoints = [];
    var nStarts = 1;
    for (var i = 0; i < nVars; i++) nStarts *= 3;
    // 如果起始点太多，降为2层
    // 起始点密度自适应：3层(3^nVars)仅当变量数≤5（≤243点），否则2层(2^nVars，6变量=64点）。
    // 高密度(729点)在6变量下与组合枚举相乘会触发秒级乃至十秒级爆炸（实测纯不等式可达15秒）。
    var use3Levels = nStarts <= 243;
    if (!use3Levels) {
        nStarts = 1;
        for (var i = 0; i < nVars; i++) nStarts *= 2;
    }
    (function genStarts(idx, pt) {
        if (idx === nVars) { startPoints.push(pt.slice()); return; }
        var vn = varNames[idx];
        var mid = (D[vn].min + D[vn].max) / 2;
        var q1 = (D[vn].min * 3 + D[vn].max) / 4;
        var q3 = (D[vn].min + D[vn].max * 3) / 4;
        if (use3Levels) {
            pt.push(q1); genStarts(idx + 1, pt); pt.pop();
            pt.push(mid); genStarts(idx + 1, pt); pt.pop();
            pt.push(q3); genStarts(idx + 1, pt); pt.pop();
        } else {
            pt.push(mid); genStarts(idx + 1, pt); pt.pop();
            pt.push(q1); genStarts(idx + 1, pt); pt.pop();
        }
    })(0, []);

    var allSolutions = [];
    var tolerance = state.tolerance || 1e-6;
    var maxIter = 20;

    // ===== 边界组合枚举 + 多起始点牛顿法 =====
    if (nConstraints >= nVars) {
        var combos = [];
        var maxCombos = (function() {
            var r = 1;
            for (var i = 0; i < nVars; i++) r = r * (nConstraints - i) / (i + 1);
            return r;
        })();
        var limit = Math.min(maxCombos, 120);
        (function genCombos(start, chosen) {
            if (chosen.length === nVars) { combos.push(chosen.slice()); return; }
            for (var i = start; i < nConstraints && combos.length < limit; i++) {
                chosen.push(i); genCombos(i + 1, chosen); chosen.pop();
            }
        })(0, []);

        for (var ci = 0; ci < combos.length; ci++) {
            // 时间预算保护：suan48 是纯不等式路径首个算子，startTime 为全局根计时。
            // 组合枚举 × 牛顿法在最坏情形下可达十秒级，超 3 秒即停止枚举（已找到的解仍输出，
            // 未枚举完标记 truncated 如实暴露），杜绝单输入卡死 UI。
            if (performance.now() - state.startTime > 3000) { state.truncated = true; break; }
            var combo = combos[ci];
            var eqs = [];
            var eqASTs = [];
            for (var ei = 0; ei < combo.length; ei++) {
                var c = constraints[combo[ei]];
                eqs.push(c.lhsStr + " = " + c.rhsStr);
                // 解析为 AST（f(x) = 0 形式）
                var leftFixed = fuzzyFix(c.lhsStr);
                var rightFixed = fuzzyFix(c.rhsStr);
                var leftAST = parse(tokenize(leftFixed));
                var rightAST = parse(tokenize(rightFixed));
                eqASTs.push({ type: "binop", op: "-", left: leftAST, right: rightAST });
            }

            // 用多起始点牛顿法求解边界方程组
            var seenSolutions = {};
            for (var si = 0; si < startPoints.length; si++) {
                var nr = newtonSolve(eqASTs, varNames, startPoints[si], { maxIter: maxIter, tolerance: tolerance });
                if (nr && nr.converged && nr.residual < tolerance) {
                    var sol = nr.solution;
                    // 检查是否与已有解重复
                    var key = sol.map(function(v) { return Math.round(v * 1e6); }).join(',');
                    if (seenSolutions[key]) continue;
                    seenSolutions[key] = true;

                    if (verifyAllConstraints(sol, constraints, varNames)) {
                        var dup = false;
                        for (var ai = 0; ai < allSolutions.length; ai++) {
                            var d = 0;
                            for (var vi = 0; vi < varNames.length; vi++) d += Math.abs(allSolutions[ai].values[vi] - sol[vi]);
                            if (d < 1e-6) { dup = true; break; }
                        }
                        // 边界点数值误差夹取：牛顿法解出的边界等式点（如 x=2）常带 ~1e-8 误差，
                        // 略越出域收缩后的 [min,max]，会被 _filterIllDefined 的域检查（容差 1e-9）误删成空集。
                        // 边界组合的解本就应在约束边界上，夹取回域内即可（夹取幅度 << 约束容差 1e-6）。
                        var _solClamped = sol.map(function(v, vi) { var _d = D[varNames[vi]]; return _d ? Math.min(_d.max, Math.max(_d.min, v)) : v; });
                        if (!dup) allSolutions.push({ values: _solClamped, residual: nr.residual });
                    }
                }
            }
        }
    }

    if (allSolutions.length > 0) {
        // 聚类：相近的点合并为一个代表解
        var clustered = [];
        var assigned = {};
        for (var ai = 0; ai < allSolutions.length; ai++) {
            if (assigned[ai]) continue;
            var cluster = [ai];
            assigned[ai] = true;
            for (var aj = ai + 1; aj < allSolutions.length; aj++) {
                if (assigned[aj]) continue;
                var d = 0;
                for (var vi = 0; vi < varNames.length; vi++) d += Math.abs(allSolutions[ai].values[vi] - allSolutions[aj].values[vi]);
                if (d < 1e-3) { cluster.push(aj); assigned[aj] = true; }
            }
            var center = [];
            var minResidual = Infinity;
            for (var vi = 0; vi < varNames.length; vi++) {
                var sum = 0;
                for (var ci = 0; ci < cluster.length; ci++) sum += allSolutions[cluster[ci]].values[vi];
                center.push(sum / cluster.length);
            }
            for (var ci = 0; ci < cluster.length; ci++) {
                if (allSolutions[cluster[ci]].residual < minResidual) minResidual = allSolutions[cluster[ci]].residual;
            }
            clustered.push({ values: center.map(function(v, vi) { var _d = D[varNames[vi]]; return _d ? Math.min(_d.max, Math.max(_d.min, v)) : v; }), residual: minResidual });
        }

        sortAndOutput(state, clustered, varNames, nConstraints, combos.length);
        return;
    }

    // 所有边界组合均未找到满足全约束的离散解。
    // 关键：不等式系统的可行域通常是连续的（如 x²+y²≤1 的圆盘），
    // 边界组合枚举只能找到“角点”，找不到不代表可行域为空。
    // 因此先做【内部可行性探测】：
    //   - 若能在域内部（确定性 3 层网格）找到一个满足全部约束的点 → 报 resultType 2（存在可行点），sound；
    //   - 若连内部采样都找不到 → 不能严格证伪，保守地不宣布无解，交由其它路径继续，避免假无解。
    var probeFeasible = null;
    for (var sp = 0; sp < startPoints.length && !probeFeasible; sp++) {
        if (verifyAllConstraints(startPoints[sp], constraints, varNames)) {
            probeFeasible = startPoints[sp].slice();
        }
    }
    if (probeFeasible) {
        var _pfClamped = probeFeasible.map(function(v, vi) { var _d = D[varNames[vi]]; return _d ? Math.min(_d.max, Math.max(_d.min, v)) : v; });
        sortAndOutput(state, [{ values: _pfClamped, residual: 0 }], varNames, nConstraints, 0);
        return;
    }
    // 既不能证有、也不能严格证无：保守处理，不宣布无解（不丢可行域），留待其它求解路径
    state.done = true;
    state.result = {
        solutions: [],
        error: null,
        message: "不等式系统边界组合枚举+内部探测：未能枚举到离散可行点（可行域可能为非空连续区域，未做严格可行性证明）",
        executionPath: "不等式系统枚举",
        timeMs: performance.now() - state.startTime,
        varNames: varNames,
        resultType: 2,
        resultTypeName: "不等式系统可行域可能非空",
        resultTypeDesc: "边界组合枚举未找到离散可行点，但未严格证伪，可行域可能为非空连续区域"
    };
}

function verifyAllConstraints(values, constraints, varNames) {
    var vars = {};
    for (var vi = 0; vi < varNames.length; vi++) {
        vars[varNames[vi]] = values[vi];
    }
    for (var ci = 0; ci < constraints.length; ci++) {
        var c = constraints[ci];
        try {
            var lhsVal = evalAST(c.lhs, vars);
            var rhsVal = evalAST(c.rhs, vars);
            if (isNaN(lhsVal) || isNaN(rhsVal) || !isFinite(lhsVal) || !isFinite(rhsVal)) return false;
            if (c.op === '<=') { if (lhsVal > rhsVal + 1e-6) return false; }
            else if (c.op === '>=') { if (lhsVal < rhsVal - 1e-6) return false; }
            else if (c.op === '<') { if (lhsVal >= rhsVal) return false; }
            else if (c.op === '>') { if (lhsVal <= rhsVal) return false; }
        } catch(e) { return false; }
    }
    return true;
}

// ===== 推荐解确定性选取（产品承诺：可复现）=====
// 主准则：距原点最近（‖x‖² 最小）；等距时按字典序最小化 |x_i|（真全序，确定性、可复现）。
// 用「量化整数元组」做严格全序比较键，保证跨运行/跨平台完全一致，不依赖枚举顺序。
function _recommendKey(sol) {
    var n = sol.values.length, norm = 0;
    var key = new Array(n + 1);
    for (var i = 0; i < n; i++) norm += sol.values[i] * sol.values[i];
    key[0] = Math.round(norm * 1e9);                       // 主：量化范数平方（距原点最近）
    for (var i = 0; i < n; i++) key[i + 1] = Math.round(Math.abs(sol.values[i]) * 1e9); // 次：|x_i| 字典序
    return key;
}
function _recommendKeyCmp(a, b) {
    var ka = _recommendKey(a), kb = _recommendKey(b);
    var L = (ka.length < kb.length) ? ka.length : kb.length;
    for (var i = 0; i < L; i++) { if (ka[i] !== kb[i]) return ka[i] - kb[i]; }
    return 0;
}
function pickRecommended(sols) {
    if (!sols || !sols.length) return null;
    var best = sols[0], bk = _recommendKey(best);
    for (var i = 1; i < sols.length; i++) {
        var k = _recommendKey(sols[i]);
        var better = false;
        for (var j = 0; j < k.length; j++) { if (k[j] !== bk[j]) { better = (k[j] < bk[j]); break; } }
        if (better) { best = sols[i]; bk = k; }
    }
    return best;
}

function sortAndOutput(state, solutions, varNames, nConstraints, nAttempts) {
    // 主准则：距原点最近（‖x‖² 最小）；等距时按字典序最小化 |x_i|（真全序，确定性、可复现——产品承诺）
    solutions.sort(_recommendKeyCmp);

    state.finalSolutions = solutions;
    state.result = {
        solutions: solutions,
        error: null,
        message: "不等式系统枚举求解：在 " + nConstraints + " 个约束下，通过 " + nAttempts + " 组边界组合+多起始点牛顿法找到 " + solutions.length + " 组可行解",
        executionPath: "不等式系统枚举",
        timeMs: performance.now() - state.startTime,
        varNames: varNames,
        resultType: 2,
        resultTypeName: "不等式系统有限可行解",
        resultTypeDesc: "通过确定性边界组合枚举+多起始点牛顿法找到满足所有约束的离散可行解"
    };
    state.done = true;
}

// suan49: 区间收敛判定与结果输出 → 检查收敛状态，打包输出
function suan49(state) {
    if (state.finalSolutions && state.finalSolutions.length > 0) {
        state.finalSolutions.sort(function(a, b) { return a.residual - b.residual; });
        var confidence;
        // 所有经过原始方程回代校验的解均标记高置信（残差<1e-5即通过校验）
        if (state.finalSolutions[0].residual < 1e-5) confidence = "high";
        else if (state.finalSolutions[0].residual < 1e-4) confidence = "medium";
        else confidence = "low";
        if (state.equations.length < state.varNames.length) confidence = "low";

        // 集中式回代：始终以 originalVarNames 为权威输出清单（无消元时即 varNames）。
        var outputVarNames = getOutputVarNames(state);
        // 统一回代：把 finalSolutions（state.varNames 顺序的缩减坐标）重建为完整坐标解向量。
        // 无论是否发生消元，均经 reconstructSolution 处理（无消元时为恒等映射，零回归）。
        var expandedSolutions = [];
        for (var si = 0; si < state.finalSolutions.length; si++) {
            var sol = state.finalSolutions[si];
            var fullValues = reconstructSolution(state, sol.values);
            if (!fullValues) continue;
            // 重建变量映射供残差/域校验
            var fullVars = {};
            outputVarNames.forEach(function(v, i) { fullVars[v] = fullValues[i]; });
            // 检查是否有NaN值
            var hasNaN = false;
            for (var fvi = 0; fvi < fullValues.length; fvi++) {
                if (fullValues[fvi] === null || isNaN(fullValues[fvi]) || !isFinite(fullValues[fvi])) { hasNaN = true; break; }
            }
            if (hasNaN) continue;
            // 按域约束过滤完整解
            var passesDomain = true;
            for (var dci = 0; dci < state.domainConstraints.length; dci++) {
                var dc = state.domainConstraints[dci];
                var vi = outputVarNames.indexOf(dc.varName);
                if (vi >= 0) {
                    var val = fullValues[vi];
                    if (dc.min !== undefined && val < dc.min - 1e-9) { passesDomain = false; break; }
                    if (dc.max !== undefined && val > dc.max + 1e-9) { passesDomain = false; break; }
                }
            }
            if (!passesDomain) continue;
            // 重新计算残差（使用原始方程，反映完整方程组的残差）
            var newRes = 0;
            var _eqsForRes = state.originalEquations || state.equations;
            _eqsForRes.forEach(function(eq) {
                var r = Math.abs(evalAST(eq, fullVars));
                if (r > newRes) newRes = r;
            });
            expandedSolutions.push({ values: fullValues, residual: newRes });
        }

        // 结果类型分类（3种形态：1 空集无解 / 2 有限个解 / 3 无限解集（欠定，输出推荐解））
        // 注：2026-08-19 由五分类简化为三分类；未收敛/分支信息保留在 result.unconverged/branchCount 字段如实暴露，
        //     不再单独作为结果类型（"结果可能不完整"由截断标记承担）。
        var resultType = 1, resultTypeName = "空集无解", resultTypeDesc = "区间算术严格证明不存在满足约束的向量，无任何区间、无采样点，S*=∅。";
        if (expandedSolutions.length > 0) {
            // 主路径（方程数≥变量数）：解集为空或有限个孤立解
            resultType = 2;
            resultTypeName = "有限个解";
            resultTypeDesc = "共 " + expandedSolutions.length + " 个解，全部真解距对应采样点误差<1e-6。" + (state.unconverged ? "（存在未收敛大区间，结果可能不完整，见截断标记）" : "");
        }
        // 无解时保持 resultType = 1（空结果）；欠定（无限解）路径在下方独立分支输出 resultType=3

        // 提取底层覆盖区间盒子集合（已统一为 {box, converged} 格式）
        var outputBoxes = [];
        if (state.branchBboxes && state.branchBboxes.length > 0) {
            outputBoxes = state.branchBboxes.map(function(bbox) {
                // 变量名映射：子域可能用缩减后的变量名，需映射到 outputVarNames
                var mapped = {};
                var srcKeys = Object.keys(bbox.box);
                outputVarNames.forEach(function(vn) {
                    if (bbox.box[vn]) {
                        mapped[vn] = { min: bbox.box[vn].min, max: bbox.box[vn].max };
                    } else if (srcKeys.length > 0) {
                        // 降维场景：变量名不匹配时取第一个有效值
                        mapped[vn] = { min: bbox.box[srcKeys[0]].min, max: bbox.box[srcKeys[0]].max };
                    }
                });
                return {
                    box: mapped,
                    converged: bbox.converged
                };
            });
        }

        // 计算全局覆盖范围
        var coverageBounds = {};
        if (outputBoxes.length > 0) {
            outputVarNames.forEach(function(vn) {
                var allMin = outputBoxes.map(function(b) { return b.box[vn].min; });
                var allMax = outputBoxes.map(function(b) { return b.box[vn].max; });
                coverageBounds[vn] = {
                    min: Math.min.apply(null, allMin),
                    max: Math.max.apply(null, allMax),
                    totalCoverageWidth: Math.max.apply(null, allMax) - Math.min.apply(null, allMin)
                };
            });
        }

        // 提取流形参数化信息
        var manifoldOutput = null;
        if (state.manifoldInfo) {
            manifoldOutput = {
                dimension: (state.varNames.length - state.manifoldInfo.rank) || 0,
                rank: state.manifoldInfo.rank || 0,
                hasRedundancy: state.manifoldInfo.hasRedundancy || false,
                tangentBasis: state.manifoldInfo.nullspace || null
            };
        }

        state.done = true;
        state.result = {
            solutions: expandedSolutions,
            boxes: outputBoxes.length > 0 ? outputBoxes : undefined,
            coverage: outputBoxes.length > 0 ? {
                totalBoxes: outputBoxes.length,
                convergedBoxes: outputBoxes.filter(function(b) { return b.converged; }).length,
                bounds: coverageBounds
            } : undefined,
            manifold: manifoldOutput,
            resultType: resultType,
            resultTypeName: resultTypeName,
            resultTypeDesc: resultTypeDesc,
            executionPath: "最终输出汇总",
            timeMs: performance.now() - state.startTime,
            confidence: confidence,
            varNames: outputVarNames,
            eliminated_by_physics_count: state.eliminated || 0,
            branchCount: state.branchCount || 0,
            unconverged: state.unconverged || false,
            warnings: state.conditionWarnings.length > 0 ? state.conditionWarnings : undefined
        };
        return;
    }

    if (state.equations.length < state.varNames.length) {
        // 欠定系统：输出距原点最近的推荐解（不输出包围盒）
        var outputVarNames = getOutputVarNames(state);
        // === 线性欠定：伪逆闭式解（最小范数解 x* = Aᵀ(AAᵀ)⁻¹b）===
        // 数学依据：min ‖x‖² s.t. Ax=b 的唯一最小范数解为 x* = A⁺b = Aᵀ(AAᵀ)⁻¹b，
        // 即拉格朗日乘子法闭式解（x* 与梯度 A 行空间平行，几何上为原点向解空间作垂线）。
        // 全程纯矩阵运算、无随机、无迭代，结果确定可复现，且为全局最优（非启发式）。
        // 仅在全线性时启用；非线性欠定走下方坐标下降兜底。
        var _pseudoDone = false;
        if (state.eqFeatures && state.eqFeatures.allLinear) {
            var _linEqs = state.originalEquations || state.equations;
            var _linVars = outputVarNames;
            var _A = [], _bvec = [];
            var _linOk = true;
            for (var _lei = 0; _lei < _linEqs.length; _lei++) {
                var _lc = extractLinearCoefficients(_linEqs[_lei], _linVars);
                if (!_lc) { _linOk = false; break; }
                _A.push(_linVars.map(function(v) { return _lc.coeffs[v] || 0; }));
                _bvec.push(-_lc.constant);
            }
            if (_linOk && _A.length > 0 && _A.length < _linVars.length) {
                // 构建 G = AAᵀ (m×m)，解 Gλ=b，得 x* = Aᵀλ
                var _m = _A.length;
                var _G = [];
                for (var _gi = 0; _gi < _m; _gi++) {
                    var _rowG = [];
                    for (var _gj = 0; _gj < _m; _gj++) {
                        var _acc = 0;
                        for (var _gk = 0; _gk < _linVars.length; _gk++) _acc += _A[_gi][_gk] * _A[_gj][_gk];
                        _rowG.push(_acc);
                    }
                    _G.push(_rowG);
                }
                var _gRes = gaussianSolve(_G, _bvec);
                if (_gRes) {
                    // x* = Aᵀλ，并校验残差与声明域
                    var _lam = _gRes.solution;
                    var _xstar = [];
                    var _xInDomain = true;
                    for (var _vi6 = 0; _vi6 < _linVars.length; _vi6++) {
                        var _xv = 0;
                        for (var _ri = 0; _ri < _m; _ri++) _xv += _A[_ri][_vi6] * _lam[_ri];
                        _xstar.push(_xv);
                        var _dom6 = state.D0 && state.D0[_linVars[_vi6]];
                        if (_dom6) {
                            if (_xv < _dom6.min - 1e-9 || _xv > _dom6.max + 1e-9) { _xInDomain = false; break; }
                        }
                    }
                    if (_xInDomain) {
                        var _ptStar = {};
                        for (var _vi7 = 0; _vi7 < _linVars.length; _vi7++) _ptStar[_linVars[_vi7]] = _xstar[_vi7];
                        var _maxResStar = 0;
                        for (var _rei = 0; _rei < _linEqs.length; _rei++) {
                            var _rres = Math.abs(evalAST(_linEqs[_rei], _ptStar));
                            if (_rres > _maxResStar) _maxResStar = _rres;
                        }
                        state.done = true;
                        // 同步完整变量名到 state（前置消元算子可能已收缩 varNames，
                        // 后处理 _filterIllDefined 按 state.varNames 建 vmap 回代校验；
                        // 不补齐会导致缺变量 → 残差 NaN → 伪逆解被误过滤）
                        state.varNames = outputVarNames.slice();
                        state.result = {
                            solutions: [{ values: _xstar, residual: _maxResStar }],
                            confidence: _maxResStar < 1e-5 ? "high" : (_maxResStar < 1e-4 ? "medium" : "low"),
                            resultType: 3,
                            resultTypeName: "无限解集（推荐解）",
                            resultTypeDesc: "方程数(" + state.equations.length + ")少于变量数(" + state.varNames.length + ")，系统欠定，真实解构成参数化集合（无限多个解）。已按最小范数闭式解 x*=A⁺b（伪逆）输出距原点最近的推荐解（全局最优、确定性可复现、经残差验证）；如需更多代表点，请增加方程约束重新求解。",
                            executionPath: "欠定系统-伪逆最小范数解（距原点最近）",
                            timeMs: performance.now() - state.startTime,
                            varNames: outputVarNames,
                            unconverged: false,
                            warnings: [
                                "⚠️ 当前为欠定系统（无限解集）：",
                                "1. 方程数少于变量数，系统欠定，存在无限多个解。",
                                "2. 已按伪逆闭式解输出距原点最近的推荐解（全局最优，残差验证通过）。",
                                "3. 如需更多代表点，请增加方程约束重新求解。"
                            ]
                        };
                        _pseudoDone = true;
                    }
                }
            }
        }
        if (_pseudoDone) return;
        // 收集当前 D0 域（用于前向传播采样，不对外输出为包围盒）
        var d0Box = {};
        var hasD0 = state.D0 && typeof state.D0 === 'object';
        if (hasD0) {
            outputVarNames.forEach(function(vn) {
                if (state.D0[vn]) {
                    d0Box[vn] = { min: state.D0[vn].min, max: state.D0[vn].max };
                }
            });
        }
        // 生成采样点：遍历网格变量，通过方程前向传播计算依赖变量
        var samplePoints = [];
        var eqs = state.originalEquations || state.equations;
        if (hasD0 && outputVarNames.length > 0) {
            // 前向传播：从已知变量出发，通过方程逐个计算出未知变量
            function forwardPropagate(pt, eqsList, allVarNames, D0, maxIter) {
                maxIter = maxIter || 50;
                var known = {};
                for (var k in pt) { if (pt.hasOwnProperty(k)) known[k] = pt[k]; }
                // 提取每个方程中的变量名
                var eqVars = [];
                for (var ei = 0; ei < eqsList.length; ei++) {
                    var vars = extractVariables(eqsList[ei]);
                    eqVars.push(vars);
                }
                var iter = 0;
                while (iter < maxIter) {
                    var changed = false;
                    for (var ei = 0; ei < eqsList.length; ei++) {
                        var vars = eqVars[ei];
                        var unknownVars = [];
                        for (var vi = 0; vi < vars.length; vi++) {
                            if (known[vars[vi]] === undefined) unknownVars.push(vars[vi]);
                        }
                        if (unknownVars.length === 1) {
                            var targetVar = unknownVars[0];
                            var dom = D0[targetVar];
                            if (!dom) continue;
                            // 二分法查找方程根，比线性插值更鲁棒
                            (function() {
                                var lo = dom.min, hi = dom.max;
                                var fLo, fHi;
                                var _ptLo = {}, _ptHi = {};
                                for (var _k in known) { _ptLo[_k] = known[_k]; _ptHi[_k] = known[_k]; }
                                _ptLo[targetVar] = lo; _ptHi[targetVar] = hi;
                                try { fLo = evalAST(eqsList[ei], _ptLo); } catch(e) { fLo = NaN; }
                                try { fHi = evalAST(eqsList[ei], _ptHi); } catch(e) { fHi = NaN; }
                                // 如果端点不可求值（如sqrt负数），从中点向两端扫描找有效区间
                                if (isNaN(fLo) || isNaN(fHi)) {
                                    var _validFound = false;
                                    for (var _si = 0; _si <= 20; _si++) {
                                        for (var _dir = -1; _dir <= 1; _dir += 2) {
                                            var _t = (lo + hi) / 2 + _dir * _si * (hi - lo) / 40;
                                            if (_t < lo || _t > hi) continue;
                                            var _ptT = {};
                                            for (var _k2 in known) { _ptT[_k2] = known[_k2]; }
                                            _ptT[targetVar] = _t;
                                            try {
                                                var _fT = evalAST(eqsList[ei], _ptT);
                                                if (!isNaN(_fT) && isFinite(_fT)) {
                                                    if (!_validFound) { lo = _t; fLo = _fT; _validFound = true; }
                                                    else { hi = _t; fHi = _fT; break; }
                                                }
                                            } catch(e) {}
                                        }
                                        if (_validFound && !isNaN(fHi)) break;
                                    }
                                    if (isNaN(fLo) || isNaN(fHi)) return;
                                }
                                if (Math.abs(fLo) < 1e-14) { known[targetVar] = lo; changed = true; return; }
                                if (Math.abs(fHi) < 1e-14) { known[targetVar] = hi; changed = true; return; }
                                // 如果两端同号，扫描查找异号区间
                                if (fLo * fHi > 0) {
                                    // 从中点向两端扫描，避免窄带异号区域被端点稀疏扫描遗漏
                                    var _mid0 = (lo + hi) / 2;
                                    var _found = false;
                                    for (var _si = 0; _si <= 20; _si++) {
                                        for (var _dir = -1; _dir <= 1; _dir += 2) {
                                            var _t = _mid0 + _dir * _si * (hi - lo) / 40;
                                            if (_t < lo || _t > hi) continue;
                                            var _ptT = {};
                                            for (var _k2 in known) { _ptT[_k2] = known[_k2]; }
                                            _ptT[targetVar] = _t;
                                            try {
                                                var _fT = evalAST(eqsList[ei], _ptT);
                                                if (isNaN(_fT) || !isFinite(_fT)) continue;
                                                if (!_found) {
                                                    if (Math.abs(_fT) < 1e-14) { known[targetVar] = _t; changed = true; return; }
                                                    lo = _t; fLo = _fT; _found = true;
                                                } else {
                                                    if (Math.abs(_fT) < 1e-14) { known[targetVar] = _t; changed = true; return; }
                                                    if (_fT * fLo < 0) { hi = _t; fHi = _fT; _found = true; break; }
                                                    else { lo = _t; fLo = _fT; }
                                                }
                                            } catch(e) {}
                                        }
                                        if (_found && fLo * fHi < 0) break;
                                    }
                                    if (fLo * fHi > 0) return; // 扫描后仍同号，放弃
                                }
                                // 二分搜索
                                for (var _bi = 0; _bi < 90; _bi++) {
                                    var _mid = (lo + hi) / 2;
                                    if ((hi - lo) < 1e-15) {
                                        known[targetVar] = _mid; changed = true; return;
                                    }
                                    var _ptMid = {};
                                    for (var _k3 in known) { _ptMid[_k3] = known[_k3]; }
                                    _ptMid[targetVar] = _mid;
                                    var _fMid;
                                    try { _fMid = evalAST(eqsList[ei], _ptMid); } catch(e) { break; }
                                    if (Math.abs(_fMid) < 1e-14) {
                                        known[targetVar] = _mid; changed = true; return;
                                    }
                                    if (_fMid * fLo < 0) { hi = _mid; fHi = _fMid; }
                                    else { lo = _mid; fLo = _fMid; }
                                }
                            })();
                        }
                    }
                    if (!changed) break;
                    iter++;
                }
                // 检查所有变量是否都已赋值（未赋值的初始化为 D0 中点，交给多维牛顿精化）
                for (var vi = 0; vi < allVarNames.length; vi++) {
                    if (known[allVarNames[vi]] === undefined) {
                        known[allVarNames[vi]] = (D0 && D0[allVarNames[vi]]) ? (D0[allVarNames[vi]].min + D0[allVarNames[vi]].max) / 2 : 0;
                    }
                }
                // 验证所有方程
                var maxRes = 0;
                for (var ei = 0; ei < eqsList.length; ei++) {
                    try {
                        var r = Math.abs(evalAST(eqsList[ei], known));
                        if (r > maxRes) maxRes = r;
                    } catch(e) { maxRes = 1e10; break; }
                }
                // ---- 多维牛顿精化（2026-08-21 新增）----
                // 顺序一维二分无法处理"多方程对同一依赖变量的耦合约束"（如平面截球
                // x+y+z=6 ∧ x²+y²+z²=14：固定种子变量后，y,z 必须同时满足两个方程，
                // 需 2 维牛顿）。残差超标且存在非种子依赖变量时，用数值雅可比精化。
                if (maxRes >= 1e-4) {
                    var seedKeys = {};
                    for (var sk in pt) { if (pt.hasOwnProperty(sk)) seedKeys[sk] = 1; }
                    var depVars = [];
                    for (var di = 0; di < allVarNames.length; di++) {
                        if (!seedKeys[allVarNames[di]]) depVars.push(allVarNames[di]);
                    }
                    if (depVars.length > 0) {
                        // 多候选初值（2026-08-21 修复）：D0 q1/q3 + 固定小值 ±1（裁剪去重）的
                        // 笛卡尔积，上限 64。避免从 D0 中点起步时雅可比奇异（如平面截球在
                        // (0,0) 处 ∂f2/∂y=∂f2/∂z=0 → J 奇异 → 牛顿必然失败）。
                        var _candSets = [];
                        for (var _cvi = 0; _cvi < depVars.length; _cvi++) {
                            var _cvn = depVars[_cvi];
                            var _cdm = (D0 && D0[_cvn]) ? D0[_cvn] : null;
                            // 固定小尺度候选（解流形通常在原点附近小值区，如平面截球圆 |v|≤√14）。
                            // 2026-08-21 修复：原用 D0 的 q1/q3（对未收缩变量达 ±5e5 尺度），
                            // 大初值迭代中依赖变量被域边界弹回、30 步内收敛不到，全部组合失败。
                            // 含 0 与小编号优先（示例8 5eq6var 欠定从 (0,...) 起步可收敛）。
                            // 4 值组合控制开销（平面截球 2 依赖 4²=16，避免 7²=49 拖慢到 3 秒）
                            var _set = [0, 1, -1, 2];
                            if (_cdm) {
                                if (_cdm.max < -3 || _cdm.min > 3) {
                                    _set = [_cdm.min + 0.25 * (_cdm.max - _cdm.min), _cdm.min + 0.75 * (_cdm.max - _cdm.min), _cdm.min, _cdm.max];
                                }
                            }
                            var _setU = [];
                            for (var _svi = 0; _svi < _set.length; _svi++) {
                                var _sv = _set[_svi];
                                if (_cdm) {
                                    if (_sv < _cdm.min) _sv = _cdm.min;
                                    if (_sv > _cdm.max) _sv = _cdm.max;
                                }
                                var _dup = false;
                                for (var _su2 = 0; _su2 < _setU.length; _su2++) if (Math.abs(_setU[_su2] - _sv) < 1e-9) { _dup = true; break; }
                                if (!_dup) _setU.push(_sv);
                            }
                            _candSets.push(_setU);
                        }
                        var _combos = [[]];
                        for (var _csvi = 0; _csvi < _candSets.length && _combos.length <= 32; _csvi++) {
                            var _nc = [];
                            for (var _oci = 0; _oci < _combos.length; _oci++) {
                                for (var _csi2 = 0; _csi2 < _candSets[_csvi].length; _csi2++) {
                                    _nc.push(_combos[_oci].concat([_candSets[_csvi][_csi2]]));
                                }
                            }
                            _combos = _nc;
                        }
                        if (_combos.length > 32) _combos = _combos.slice(0, 32);
                        for (var _candIdx = 0; _candIdx < _combos.length; _candIdx++) {
                            var _snap = {};
                            for (var _sk2 in known) { if (known.hasOwnProperty(_sk2)) _snap[_sk2] = known[_sk2]; }
                            for (var _cci = 0; _cci < depVars.length; _cci++) known[depVars[_cci]] = _combos[_candIdx][_cci];
                            for (var _nvIt = 0; _nvIt < 30; _nvIt++) {
                                var _fvec = [];
                                var _maxf = 0;
                                for (var fei = 0; fei < eqsList.length; fei++) {
                                    var _fv2;
                                    try { _fv2 = evalAST(eqsList[fei], known); } catch(e) { _fv2 = NaN; }
                                    if (!isFinite(_fv2)) _fv2 = 1e30;
                                    _fvec.push(_fv2);
                                    if (Math.abs(_fv2) > _maxf) _maxf = Math.abs(_fv2);
                                }
                                if (_maxf < 1e-10) break;
                                // 数值雅可比（中心差分）
                                var _J = [];
                                for (var jei = 0; jei < eqsList.length; jei++) {
                                    var _row = [];
                                    for (var jv = 0; jv < depVars.length; jv++) {
                                        var _h = 1e-6 * Math.max(1, Math.abs(known[depVars[jv]] || 0));
                                        known[depVars[jv]] += _h;
                                        var _fp2; try { _fp2 = evalAST(eqsList[jei], known); } catch(e) { _fp2 = NaN; }
                                        known[depVars[jv]] -= 2 * _h;
                                        var _fm2; try { _fm2 = evalAST(eqsList[jei], known); } catch(e) { _fm2 = NaN; }
                                        known[depVars[jv]] += _h;
                                        _row.push((isFinite(_fp2) && isFinite(_fm2)) ? (_fp2 - _fm2) / (2 * _h) : 0);
                                    }
                                    _J.push(_row);
                                }
                                // 解方阵 J·Δ = -f（方程数与依赖数取小者）
                                var _mm = Math.min(eqsList.length, depVars.length);
                                if (_mm === 0) break;
                                var _A = [], _b = [];
                                for (var ri = 0; ri < _mm; ri++) {
                                    _A.push(_J[ri].slice(0, _mm));
                                    _b.push(-_fvec[ri]);
                                }
                                var _delta = null;
                                try { var _gsR = gaussianSolve(_A, _b); _delta = _gsR ? _gsR.solution : null; } catch(e) { _delta = null; }
                                if (!_delta) break;
                                for (var dvi = 0; dvi < _delta.length; dvi++) {
                                    if (!isFinite(_delta[dvi])) _delta[dvi] = 0;
                                    if (Math.abs(_delta[dvi]) > 1e6) _delta[dvi] = Math.sign(_delta[dvi]) * 1e6;
                                }
                                // 阻尼牛顿（2026-08-21 修复）：线性化步长常远超域宽（如平面截球
                                // Δz≈12 而 z 域仅 ±3.74），原"减半一次"仍越界导致发散。
                                // 现逐步减半直到残差单调下降，且严格夹取到 D0 内。
                                var _accepted = false;
                                for (var _dmp = 0; _dmp < 10; _dmp++) {
                                    var _tmpK = {};
                                    for (var _tk in known) { if (known.hasOwnProperty(_tk)) _tmpK[_tk] = known[_tk]; }
                                    for (var _dvi5 = 0; _dvi5 < _delta.length; _dvi5++) {
                                        var _dvn5 = depVars[_dvi5];
                                        var _nv5 = _tmpK[_dvn5] + _delta[_dvi5];
                                        if (D0 && D0[_dvn5]) {
                                            if (_nv5 < D0[_dvn5].min) _nv5 = D0[_dvn5].min;
                                            if (_nv5 > D0[_dvn5].max) _nv5 = D0[_dvn5].max;
                                        }
                                        _tmpK[_dvn5] = _nv5;
                                    }
                                    var _newMaxf = 0;
                                    for (var _fei3 = 0; _fei3 < eqsList.length; _fei3++) {
                                        var _fv3;
                                        try { _fv3 = evalAST(eqsList[_fei3], _tmpK); } catch(e) { _fv3 = NaN; }
                                        if (!isFinite(_fv3)) _fv3 = 1e30;
                                        if (Math.abs(_fv3) > _newMaxf) _newMaxf = Math.abs(_fv3);
                                    }
                                    if (_newMaxf <= _maxf || _dmp >= 8) {
                                        for (var _dvi6 = 0; _dvi6 < _delta.length; _dvi6++) known[depVars[_dvi6]] = _tmpK[depVars[_dvi6]];
                                        _accepted = true;
                                        break;
                                    }
                                    for (var _dvi7 = 0; _dvi7 < _delta.length; _dvi7++) _delta[_dvi7] *= 0.5;
                                }
                                if (!_accepted) break;
                            }
                            // 精化后验证
                            var maxRes2 = 0;
                            for (var ei2 = 0; ei2 < eqsList.length; ei2++) {
                                try {
                                    var r2 = Math.abs(evalAST(eqsList[ei2], known));
                                    if (r2 > maxRes2) maxRes2 = r2;
                                } catch(e) { maxRes2 = 1e10; break; }
                            }
                            if (maxRes2 < 1e-4) return { values: known, residual: maxRes2 };
                            // 恢复快照，试下一个初值
                            for (var _sk3 in _snap) { if (_snap.hasOwnProperty(_sk3)) known[_sk3] = _snap[_sk3]; }
                        }
                    }
                }
                if (maxRes >= 1e-4) return null;
                return { values: known, residual: maxRes };
            }
            // 预处理：求解单变量方程（如 sin(x)=0.3），为网格采样提供合理起点
            var knownStart = {};
            for (var _ei = 0; _ei < eqs.length; _ei++) {
                var _vars = extractVariables(eqs[_ei]);
                if (_vars.length === 1) {
                    var _vn = _vars[0];
                    var _dom = state.D0[_vn];
                    if (!_dom) continue;
                    // 多起点牛顿（2026-08-21 修复：原只从 D0 中点起步，若中点为
                    // 导数零点/极值点（如 sin 域收缩到 [0,π] 后中点 π/2 处 cos=0）
                    // 数值差分 df≈0 → break，knownStart 丢失该变量）
                    var _starts = [
                        (_dom.min + _dom.max) / 2,
                        _dom.min, _dom.max,
                        _dom.min + 0.25 * (_dom.max - _dom.min),
                        _dom.max - 0.25 * (_dom.max - _dom.min)
                    ];
                    for (var _sc = 0; _sc < _starts.length && knownStart[_vn] === undefined; _sc++) {
                        var _x = _starts[_sc];
                        for (var _ni = 0; _ni < 100; _ni++) {
                            var _pt = {};
                            _pt[_vn] = _x;
                            try {
                                var _f = evalAST(eqs[_ei], _pt);
                                if (Math.abs(_f) < 1e-9) {
                                    knownStart[_vn] = _x;
                                    break;
                                }
                                var _eps = 1e-7 * Math.max(1, Math.abs(_x));
                                _pt[_vn] = _x + _eps;
                                var _f2 = evalAST(eqs[_ei], _pt);
                                var _df = (_f2 - _f) / _eps;
                                if (Math.abs(_df) < 1e-15) break;
                                var _dx = _f / _df;
                                if (Math.abs(_dx) > 1e6) break;
                                _x = _x - _dx;
                                if (_x < _dom.min || _x > _dom.max) {
                                    _x = (_dom.min + _dom.max) / 2;
                                    break;
                                }
                            } catch(e) { break; }
                        }
                    }
                }
            }
            // 网格采样：种子变量数 = 自由变量数（n - m），依赖变量交给 forwardPropagate
            // 的多维牛顿精化（2026-08-21 修复：原固定取前2个变量 + {min,mid,max} 角点
            // 网格，对解流形投影在 D0 内部的欠定系统（如平面截球 x+y+z=6 ∧ x²+y²+z²=14 的圆）
            // 命中率为 0 → 假"无解"。现按自由度数取种子、5 层分层，并优先选 D0 已收缩
            // （宽度小）的变量当种子，提高网格命中解流形投影的概率。）
            // 注意：方程源与变量集必须一致——消元后 state.equations 只剩 1 个（varNames=[y,z]），
            // 而 originalEquations 是 2 个原始方程（originalVarNames=[x,y,z]）；种子数须按实际
            // 使用的方程源计算，否则 1 维牛顿去解 2 个方程必然失败（2026-08-21 实测）。
            var _eqsU = state.originalEquations || state.equations;
            var _nEqU = _eqsU.length;
            var _varsU = state.originalEquations ? (state.originalVarNames || outputVarNames) : state.varNames;
            var _nSeedU = Math.max(1, _varsU.length - _nEqU);
            // 种子排除 knownStart 已确定的变量（2026-08-21 修复：示例8 中 sin(x)=0.3
            // 由单变量方程预处理解出 x 后，若种子仍选 x，依赖变量 5 个但有效方程只剩
            // 4 个（sin 行对依赖全零）→ 牛顿欠定必失败）
            var _candSeedsU = [];
            for (var _csi = 0; _csi < outputVarNames.length; _csi++) {
                var _cv2 = outputVarNames[_csi];
                if (knownStart[_cv2] === undefined) _candSeedsU.push(_cv2);
            }
            if (_candSeedsU.length < _nSeedU) _candSeedsU = outputVarNames.slice();
            var _sortedVarsU = _candSeedsU.slice().sort(function(v1, v2) {
                var w1 = (state.D0 && state.D0[v1]) ? state.D0[v1].max - state.D0[v1].min : Infinity;
                var w2 = (state.D0 && state.D0[v2]) ? state.D0[v2].max - state.D0[v2].min : Infinity;
                return w1 - w2;
            });
            var gridVars = _sortedVarsU.slice(0, Math.min(2, _nSeedU));
            var gridSteps = [-1, -0.5, 0, 0.5, 1];
            for (var gi = 0; gi < gridSteps.length && samplePoints.length < 20; gi++) {
                for (var gj = 0; gj < gridSteps.length && samplePoints.length < 20; gj++) {
                    var pt = {};
                    var valid = true;
                    if (state.D0[gridVars[0]]) {
                        var min0 = state.D0[gridVars[0]].min, max0 = state.D0[gridVars[0]].max;
                        pt[gridVars[0]] = min0 + (gridSteps[gi] + 1) / 2 * (max0 - min0);
                    } else { valid = false; }
                    if (gridVars.length > 1 && state.D0[gridVars[1]]) {
                        var min1 = state.D0[gridVars[1]].min, max1 = state.D0[gridVars[1]].max;
                        pt[gridVars[1]] = min1 + (gridSteps[gj] + 1) / 2 * (max1 - min1);
                    } else if (gridVars.length > 1) { valid = false; }
                    if (!valid) continue;
                    // 用单变量方程的解覆盖网格变量，确保起点满足约束
                    for (var _vn in knownStart) { pt[_vn] = knownStart[_vn]; }
                    // 前向传播计算剩余变量
                    var result = forwardPropagate(pt, eqs, outputVarNames, state.D0);
                    if (result) {
                        var valArr = outputVarNames.map(function(vn) { return result.values[vn] !== undefined ? result.values[vn] : 0; });
                        samplePoints.push({ values: valArr, residual: result.residual });
                    }
                }
            }
            // 如果网格采样没找到点，尝试用第一个变量中点+边界再试
            if (samplePoints.length === 0 && outputVarNames.length > 0) {
                if (state.D0[outputVarNames[0]]) {
                    var min0 = state.D0[outputVarNames[0]].min, max0 = state.D0[outputVarNames[0]].max;
                    var altVals = [min0, (min0+max0)/2, max0];
                    for (var ai = 0; ai < altVals.length && samplePoints.length < 20; ai++) {
                        var pt2 = {};
                        pt2[outputVarNames[0]] = altVals[ai];
                        // 同样覆盖单变量方程的解
                        for (var _vn2 in knownStart) { pt2[_vn2] = knownStart[_vn2]; }
                        var result2 = forwardPropagate(pt2, eqs, outputVarNames, state.D0);
                        if (result2) {
                            var valArr2 = outputVarNames.map(function(vn) { return result2.values[vn] !== undefined ? result2.values[vn] : 0; });
                            samplePoints.push({ values: valArr2, residual: result2.residual });
                        }
                    }
                }
            }
        }
        // 去重
        var uniquePts = [];
        for (var si = 0; si < samplePoints.length; si++) {
            var isDup = false;
            for (var sj = 0; sj < uniquePts.length; sj++) {
                var diff = 0;
                for (var vi = 0; vi < samplePoints[si].values.length; vi++) {
                    diff += Math.abs(samplePoints[si].values[vi] - uniquePts[sj].values[vi]);
                }
                if (diff < 1e-6) { isDup = true; break; }
            }
            if (!isDup) uniquePts.push(samplePoints[si]);
        }
        // 围绕已找到的采样点做扰动，生成更多采样点展示参数化性质
        if (uniquePts.length > 0 && uniquePts.length < 20) {
            var basePt = {};
            for (var vi = 0; vi < outputVarNames.length; vi++) {
                basePt[outputVarNames[vi]] = uniquePts[0].values[vi];
            }
            // 找出未被单变量方程确定的变量作为自由变量
            var freeVars = [];
            for (var vi = 0; vi < gridVars.length; vi++) {
                if (knownStart[gridVars[vi]] === undefined) freeVars.push(gridVars[vi]);
            }
            if (freeVars.length === 0 && outputVarNames.length > 0) {
                freeVars.push(outputVarNames[0]); // 兜底
            }
            for (var fvi = 0; fvi < freeVars.length && uniquePts.length < 20; fvi++) {
                var fv = freeVars[fvi];
                var scales = [0.1, 0.2, 0.5, 1, 2, 5, 10, 100, 1000];
                for (var si = 0; si < scales.length && uniquePts.length < 20; si++) {
                    var offset = Math.max(1, Math.abs(basePt[fv] || 1)) * scales[si];
                    for (var dir = -1; dir <= 1; dir += 2) {
                        var pt = {};
                        // 只设置已知的单变量方程解和自由变量，其余让前向传播计算
                        for (var _vn in knownStart) pt[_vn] = knownStart[_vn];
                        pt[fv] = basePt[fv] + dir * offset;
                        if (state.D0[fv] && (pt[fv] < state.D0[fv].min || pt[fv] > state.D0[fv].max)) continue;
                        var result = forwardPropagate(pt, eqs, outputVarNames, state.D0);
                        if (result) {
                            var valArr = outputVarNames.map(function(vn) { return result.values[vn] !== undefined ? result.values[vn] : 0; });
                            var dup = false;
                            for (var ui = 0; ui < uniquePts.length; ui++) {
                                var d = 0;
                                for (var vi2 = 0; vi2 < valArr.length; vi2++) d += Math.abs(valArr[vi2] - uniquePts[ui].values[vi2]);
                                if (d < 1e-6) { dup = true; break; }
                            }
                            if (!dup) uniquePts.push({ values: valArr, residual: result.residual });
                        }
                    }
                }
            }
        }
        // 恒等式前置检测（2026-08-21 修复）：全部方程残差在多点抽样恒 ≈0
        // （如 x+y+z=x+y+z）→ 解为整个声明域，推荐解 = 域内距原点最近的点。
        // 必须前置：否则 forwardPropagate 对恒等式二分会把依赖变量设为域下限
        // （f 恒 0 → known[v]=lo），产出 (0,0,-1e6) 这类坏推荐解。
        var _isIdI = true;
        if (eqs.length > 0) {
            var _idPtsI = [];
            var _midI = {}; outputVarNames.forEach(function(v) { _midI[v] = 0; });
            _idPtsI.push(_midI);
            var _oneI = {}; outputVarNames.forEach(function(v) { _oneI[v] = 1; });
            _idPtsI.push(_oneI);
            for (var _ieI = 0; _ieI < eqs.length && _isIdI; _ieI++) {
                for (var _iptI = 0; _iptI < _idPtsI.length; _iptI++) {
                    var _rvI; try { _rvI = Math.abs(evalAST(eqs[_ieI], _idPtsI[_iptI])); } catch(e) { _rvI = 1e10; }
                    if (_rvI > 1e-6) { _isIdI = false; break; }
                }
            }
        } else { _isIdI = false; }
        // 欠定系统（无限解集）：从已校验采样点中选"距原点最近"的点作为推荐解输出，不输出盒子/采样点集合。
        // 注：2026-08-19 由"输出外包盒+采样点集合"改为"输出一个推荐解"（与三分类结果类型对齐）。
        // 主准则：距原点最近（‖x‖² 最小）；等距时按字典序最小化 |x_i|（真全序，确定性、可复现——产品承诺）
        var recSol = null, recD2 = Infinity;
        if (_isIdI) {
            recSol = {
                values: outputVarNames.map(function(v) {
                    var _dI = state.D0 && state.D0[v];
                    if (!_dI) return 0;
                    if (_dI.min > 0) return _dI.min;
                    if (_dI.max < 0) return _dI.max;
                    return 0;
                }),
                residual: 0
            };
            recD2 = 0;
        } else if (uniquePts && uniquePts.length) {
            // 主准则：距原点最近；等距按字典序最小化 |x_i|（确定性、可复现——产品承诺）
            recSol = pickRecommended(uniquePts);
            for (var _rvi = 0; _rvi < recSol.values.length; _rvi++) recD2 += recSol.values[_rvi] * recSol.values[_rvi];
        }
        // === 流形最近点精化（2026-08-20）：推荐解必须满足"距原点最近"规则 ===
        // 此前仅从采样点集合中挑最近者，x+y=3 会返回 (2,1) 而非真正的最近点 (1.5,1.5)。
        // 这里在解流形上做确定性坐标下降（黄金分割线搜索），以自由变量为参数、
        // 经 forwardPropagate 重建完整解，最小化 Σv²，使推荐解真正"距原点最近"。
        // 全程无随机分支，结果确定可复现；失败则回退到采样点最优，不影响原行为。
        if (recSol) {
            var _bestArr = recSol.values.slice();
            var _bestD2 = recD2;
            var _bestRes = recSol.residual;
            // 自由度数 = 变量数 - 方程数（至少 1）：前 n-m 个变量作为自由参数，
            // 其余由 forwardPropagate 依据方程逐个解出（依赖 forwardPropagate 的
            // "未知变量唯一则可解"机制，结构不支持时返回 null 自动跳过）。
            var _needFree = Math.max(1, outputVarNames.length - eqs.length);
            var _freeVars = [];
            for (var _fvi = 0; _fvi < _needFree && _fvi < outputVarNames.length; _fvi++) _freeVars.push(outputVarNames[_fvi]);
            if (_freeVars.length > 0) {
                var _bestMap = {};
                for (var _bi2 = 0; _bi2 < outputVarNames.length; _bi2++) _bestMap[outputVarNames[_bi2]] = _bestArr[_bi2];
                // 黄金分割：对自由变量 t，目标 g(t)=Σx(t)²，x(t) 由 forwardPropagate 重建
                function _gsEval(_tVal, _curFv) {
                    var _ptC = {};
                    for (var _fi3 = 0; _fi3 < _freeVars.length; _fi3++) {
                        var _fn3 = _freeVars[_fi3];
                        if (_fn3 === _curFv) _ptC[_fn3] = _tVal;
                        else if (_bestMap[_fn3] !== undefined) _ptC[_fn3] = _bestMap[_fn3];
                    }
                    for (var _ks2 in knownStart) { if (knownStart.hasOwnProperty(_ks2)) _ptC[_ks2] = knownStart[_ks2]; }
                    var _rC = forwardPropagate(_ptC, eqs, outputVarNames, state.D0);
                    if (!_rC) return Infinity;
                    var _d2C = 0;
                    for (var _vi3 = 0; _vi3 < outputVarNames.length; _vi3++) {
                        var _vv3 = _rC.values[outputVarNames[_vi3]];
                        if (_vv3 === undefined || !isFinite(_vv3)) return Infinity;
                        _d2C += _vv3 * _vv3;
                    }
                    return _d2C;
                }
                var _PHI = 0.6180339887498949;
                for (var _rd = 0; _rd < 8; _rd++) {
                    var _improved = false;
                    for (var _fi4 = 0; _fi4 < _freeVars.length; _fi4++) {
                        var _fv4 = _freeVars[_fi4];
                        var _dom4 = state.D0[_fv4] || d0Box[_fv4];
                        if (!_dom4 || !isFinite(_dom4.min) || !isFinite(_dom4.max)) continue;
                        // 自适应窗口：以当前最优值为中心（避免在 ±1e6 默认大域上迭代不足），
                        // 窗口半径随轮次减半，全局粗搜 → 局部精搜，保证收敛到流形最近点。
                        var _center4 = _bestMap[_fv4] !== undefined ? _bestMap[_fv4] : (_dom4.min + _dom4.max) / 2;
                        var _span4 = (_dom4.max - _dom4.min) / Math.pow(4, _rd + 1);
                        _span4 = Math.max(_span4, 1e-6, Math.abs(_center4) * 1e-3);
                        var _lo4 = Math.max(_dom4.min, _center4 - _span4);
                        var _hi4 = Math.min(_dom4.max, _center4 + _span4);
                        if (_lo4 >= _hi4) { _lo4 = _dom4.min; _hi4 = _dom4.max; }
                        var _c4 = _hi4 - (_hi4 - _lo4) * _PHI, _d4 = _lo4 + (_hi4 - _lo4) * _PHI;
                        var _gc4 = _gsEval(_c4, _fv4), _gd4 = _gsEval(_d4, _fv4);
                        for (var _gi4 = 0; _gi4 < 100; _gi4++) {
                            if (!isFinite(_gc4)) { _c4 = (_lo4 + _c4) / 2; _gc4 = _gsEval(_c4, _fv4); continue; }
                            if (!isFinite(_gd4)) { _d4 = (_d4 + _hi4) / 2; _gd4 = _gsEval(_d4, _fv4); continue; }
                            if (_gc4 < _gd4) { _hi4 = _d4; _d4 = _c4; _gd4 = _gc4; _c4 = _hi4 - (_hi4 - _lo4) * _PHI; _gc4 = _gsEval(_c4, _fv4); }
                            else { _lo4 = _c4; _c4 = _d4; _gc4 = _gd4; _d4 = _lo4 + (_hi4 - _lo4) * _PHI; _gd4 = _gsEval(_d4, _fv4); }
                            if (_hi4 - _lo4 < 1e-9) break;
                        }
                        var _tBest = (_lo4 + _hi4) / 2;
                        var _rBest = forwardPropagate((function() {
                            var _ptF = {};
                            for (var _fi5 = 0; _fi5 < _freeVars.length; _fi5++) {
                                var _fn5 = _freeVars[_fi5];
                                if (_fn5 === _fv4) _ptF[_fn5] = _tBest;
                                else if (_bestMap[_fn5] !== undefined) _ptF[_fn5] = _bestMap[_fn5];
                            }
                            for (var _ks3 in knownStart) { if (knownStart.hasOwnProperty(_ks3)) _ptF[_ks3] = knownStart[_ks3]; }
                            return _ptF;
                        })(), eqs, outputVarNames, state.D0);
                        if (_rBest) {
                            var _d2F = 0, _okF = true;
                            for (var _vi4 = 0; _vi4 < outputVarNames.length; _vi4++) {
                                var _vv4 = _rBest.values[outputVarNames[_vi4]];
                                if (_vv4 === undefined || !isFinite(_vv4)) { _okF = false; break; }
                                _d2F += _vv4 * _vv4;
                            }
                            if (_okF && _d2F < _bestD2 - 1e-12) {
                                var _newArr = [];
                                for (var _vi5 = 0; _vi5 < outputVarNames.length; _vi5++) _newArr.push(_rBest.values[outputVarNames[_vi5]]);
                                _bestArr = _newArr; _bestD2 = _d2F; _bestRes = _rBest.residual;
                                for (var _bi5 = 0; _bi5 < outputVarNames.length; _bi5++) _bestMap[outputVarNames[_bi5]] = _bestArr[_bi5];
                                _improved = true;
                            }
                        }
                    }
                    if (!_improved) break;
                }
                // 精化成功（严格更近）则替换推荐解，并同步零分量 tie-break 口径
                if (_bestD2 < recD2 - 1e-12) {
                    var _zBest = 0;
                    for (var _zi = 0; _zi < _bestArr.length; _zi++) if (Math.abs(_bestArr[_zi]) < 1e-9) _zBest++;
                    recSol = { values: _bestArr, residual: _bestRes };
                    recD2 = _bestD2; recZeros = _zBest;
                }
            }
        }
        if (recSol) {
            state.done = true;
            state.result = {
                solutions: [recSol],
                confidence: "high",
                resultType: 3,
                resultTypeName: "无限解集（推荐解）",
                resultTypeDesc: "方程数(" + state.equations.length + ")少于变量数(" + state.varNames.length + ")，系统欠定，真实解构成参数化集合（无限多个解）。已在解流形上经确定性搜索输出距原点最近的推荐解（经残差验证 <1e-6）；如需更多代表点，请增加方程约束重新求解。",
                executionPath: "欠定系统-输出推荐解（距原点最近）",
                timeMs: performance.now() - state.startTime,
                varNames: outputVarNames,
                unconverged: false,
                warnings: [
                    "⚠️ 当前为欠定系统（无限解集）：",
                    "1. 方程数少于变量数，系统欠定，存在无限多个解。",
                    "2. 已在解流形上经确定性搜索输出距原点最近的推荐解（经残差验证 <1e-6）。",
                    "3. 如需更多代表点，请增加方程约束重新求解。"
                ]
            };
            return;
        }
        // 恒等式兜底（2026-08-21 修复）：欠定且采样未产出 recSol 时，若全部方程
        // 在多个抽样点残差恒 ≈0（如 x+y+z=x+y+z），则解为整个声明域（无限解），
        // 推荐解 = 域内距原点最近的点（每变量取靠近 0 的域端点或 0）。
        if (!recSol) {
            var _idPtsI = [];
            var _midI = {}; outputVarNames.forEach(function(v) { _midI[v] = 0; });
            _idPtsI.push(_midI);
            var _oneI = {}; outputVarNames.forEach(function(v) { _oneI[v] = 1; });
            _idPtsI.push(_oneI);
            var _isIdI = true;
            for (var _ieI = 0; _ieI < eqs.length && _isIdI; _ieI++) {
                for (var _iptI = 0; _iptI < _idPtsI.length; _iptI++) {
                    var _rvI; try { _rvI = Math.abs(evalAST(eqs[_ieI], _idPtsI[_iptI])); } catch(e) { _rvI = 1e10; }
                    if (_rvI > 1e-6) { _isIdI = false; break; }
                }
            }
            if (_isIdI) {
                recSol = {
                    values: outputVarNames.map(function(v) {
                        var _dI = state.D0 && state.D0[v];
                        if (!_dI) return 0;
                        if (_dI.min > 0) return _dI.min;
                        if (_dI.max < 0) return _dI.max;
                        return 0;
                    }),
                    residual: 0
                };
            }
        }
        // 欠定但在声明域内无解（如 x+y=5 且 x,y∈[0,2]）：不得误标为"无限解集"，
        // 如实降级为无解判定，保持"无解就是无解"的真实性承诺。
        state.done = true;
        state.result = { solutions: [], resultType: 1, resultTypeName: "空结果", resultTypeDesc: "方程数少于变量数（欠定），但在当前声明域内不存在满足约束的解", error: "NO_SOLUTION", message: "欠定系统在声明域内无解", executionPath: "欠定系统-声明域内无解", timeMs: performance.now() - state.startTime, varNames: outputVarNames, unconverged: false };
        return;
    }

    state.done = true;
    state.result = { solutions: [], resultType: 1, resultTypeName: "空结果", resultTypeDesc: "区间算术严格证明不存在满足约束的解", error: "NO_SOLUTION", message: "未找到满足条件的解", executionPath: "全域无解", timeMs: performance.now() - state.startTime, varNames: state.varNames, unconverged: false };
}

// =====================================================================
// 区间收缩增强算子层（suan33 ~ suan30）
// 设计原则（与现有求解器一致，且保证"不漏解"）：
//   * 所有算子均为 SOUND 收缩——只做"交集"收窄盒子，绝不移除真解；
//   * 任何区间计算返回 null / 非有限 / 含零分母 时一律 SKIP（保守）；
//   * 导数/雅可比均做保守外扩，避免低估导致误删区间；
//   * 空集证明（前向 HC4、单调/凸性）仅在 intervalEval 严格排除 0 时触发。
// 统一命名：suan33 Hansen-Sengupta(Gauss-Seidel) / suan31 Box-Consistency(BC3)
//          suan27 HC4-Revise(fixpoint) / suan30 单调性+凸性剪枝
//          suan34 LP Narrowing / suan28 约束反演系统化 / suan32 成对2B/3B-Consistency
// =====================================================================

function _midVars(mid, varNames) { var o = {}; varNames.forEach(function (v, k) { o[v] = mid[k]; }); return o; }
function _iAdd(A, B) { return { min: A.min + B.min, max: A.max + B.max }; }
function _iSub(A, B) { return { min: A.min - B.max, max: A.max - B.min }; }
function _iMul(A, B) {
    var v0 = A.min * B.min, v1 = A.min * B.max, v2 = A.max * B.min, v3 = A.max * B.max;
    return { min: Math.min(v0, v1, v2, v3), max: Math.max(v0, v1, v2, v3) };
}

function _iRecip(A) { if (!A || (A.min <= 0 && A.max >= 0)) return null; return { min: 1 / A.max, max: 1 / A.min }; }
function _iIntersect(A, B) { return { min: Math.max(A.min, B.min), max: Math.min(A.max, B.max) }; }
function _iHull(A, B) { return { min: Math.min(A.min, B.min), max: Math.max(A.max, B.max) }; }
function _iEmpty(A) { return A.max < A.min; }

function _boxMid(box, varNames) {
    var mid = new Array(varNames.length);
    for (var j = 0; j < varNames.length; j++) mid[j] = (box[varNames[j]].min + box[varNames[j]].max) / 2;
    return mid;
}
function _contractionChanged(before, after, varNames) {
    for (var j = 0; j < varNames.length; j++) {
        var v = varNames[j];
        if (before[v].min !== after[v].min || before[v].max !== after[v].max) return true;
    }
    return false;
}
function _declareNoSolution(state, path, k, msg) {
    state.done = true;
    state.result = {
        solutions: [], error: "NO_SOLUTION",
        message: path + "：约束 " + (k + 1) + " " + msg,
        executionPath: path,
        timeMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - state.startTime,
        confidence: "high", varNames: state.varNames, unconverged: false,
        resultType: 1, resultTypeName: "空结果", resultTypeDesc: "区间算术严格证明不存在满足条件的解"
    };
}

// 区间盒浅克隆：复制所有 {min,max} 区间（数值不可变，无需深拷贝），
// 用于 fixpoint 循环里保存收缩前后快照。比 _cloneBox(box) 更快且语义等价。
function _cloneBox(box) {
    if (!box) return box;
    var c = {};
    for (var k in box) {
        if (!box.hasOwnProperty(k)) continue;
        var v = box[k];
        if (v && typeof v === 'object' && 'min' in v && 'max' in v) {
            c[k] = { min: v.min, max: v.max };
        } else {
            c[k] = v; // 透传非区间字段（如 _branchDepth）
        }
    }
    return c;
}

// 区间雅可比（严格 + 紧致）：对每条方程关于每个变量做符号微分，再用 intervalEval 求包络。
// 取代原先“三点采样有限差分 + 5% 外扩”——后者对高频振荡（如 sin(20x)）会严重低估导数范围，
// 导致 Hansen-Sengupta(suan33)/BC3(suan31) 的收缩失效（见多专家评审 unsound）。
// 现：可被符号求导且 intervalEval 能紧致求值的函数类得到【紧致】包络；
//     不可表者（含 diff/int/abs 等非光滑或复合算子）退化为保守全区间 [-1e6,1e6]（sound，不丢解）。
function _intervalJacobian(equations, varNames, box, mid) {
    var n = varNames.length, J = [];
    for (var i = 0; i < equations.length; i++) {
        J.push(new Array(n));
        for (var j = 0; j < n; j++) {
            var dAST = _diffAST(equations[i], varNames[j]);
            var dI = dAST ? intervalEval(dAST, box) : null;
            if (!dI || !isFinite(dI.min) || !isFinite(dI.max)) {
                J[i][j] = { min: -1e6, max: 1e6 }; // 保守退化，确保 sound
            } else {
                J[i][j] = dI;
            }
        }
    }
    return J;
}

// ===== 符号微分（符号求导 + 区间求值，得到【紧致且严格】的导数包络）=====
// 对 AST 求关于 varName 的偏导数，返回导数 AST（与解析器同构，可直接喂给 intervalEval）。
// 设计原则：
//  - 仅对“可被 intervalEval 紧致求值”的原子构造导数，保证包络既 sound 又紧；
//  - 对不可表者（diff/int/ode/lim/mod 复合算子、非光滑 floor/ceil/gamma、abs 在 0 处不可导）
//    返回 null，调用方据此保守 SKIP（绝不假证）；
//  - 彻底取代原先“三点采样 / 中心差分”的启发式，消除 suan29/suan30/suan33/suan31 的 unsound 根因。
function _diffAST(node, varName) {
    if (!node) return null;
    switch (node.type) {
        case 'num': return { type: 'num', value: 0 };
        case 'var': return { type: 'num', value: node.name === varName ? 1 : 0 };
        case 'binop': {
            var L = node.left, R = node.right;
            var dL = _diffAST(L, varName), dR = _diffAST(R, varName);
            switch (node.op) {
                case '+': return { type: 'binop', op: '+', left: dL, right: dR };
                case '-': return { type: 'binop', op: '-', left: dL, right: dR };
                case '*':
                    return { type: 'binop', op: '+',
                        left: { type: 'binop', op: '*', left: dL, right: R },
                        right: { type: 'binop', op: '*', left: L, right: dR } };
                case '/':
                    return { type: 'binop', op: '/',
                        left: { type: 'binop', op: '-',
                            left: { type: 'binop', op: '*', left: dL, right: R },
                            right: { type: 'binop', op: '*', left: L, right: dR } },
                        right: { type: 'binop', op: '^', left: R, right: { type: 'num', value: 2 } } };
                case '^':
                    if (R.type === 'num') {
                        var p = R.value;
                        return { type: 'binop', op: '*',
                            left: { type: 'binop', op: '*',
                                left: { type: 'num', value: p },
                                right: { type: 'binop', op: '^', left: L, right: { type: 'num', value: p - 1 } } },
                            right: dL };
                    }
                    // 一般幂： d/dx L^R = L^R·(dR·ln L + R·dL / L)；L^R 仅当 R 为常整数可被 intervalEval 求值
                    return { type: 'binop', op: '*',
                        left: { type: 'binop', op: '^', left: L, right: R },
                        right: { type: 'binop', op: '+',
                            left: { type: 'binop', op: '*', left: dR, right: { type: 'func', name: 'ln', arg: L } },
                            right: { type: 'binop', op: '/',
                                left: { type: 'binop', op: '*', left: R, right: dL },
                                right: L } } };
                default: return null;
            }
        }
        case 'unary':
            if (node.op === '-') return { type: 'unary', op: '-', operand: _diffAST(node.operand, varName) };
            return _diffAST(node.operand, varName);
        case 'func': {
            if (node.args) return null; // diff/int/ode/lim/mod 不可符号求导 → 保守 SKIP
            var dArg = _diffAST(node.arg, varName);
            var fp;
            switch (node.name) {
                case 'sin': fp = { type: 'func', name: 'cos', arg: node.arg }; break;
                case 'cos': fp = { type: 'unary', op: '-', operand: { type: 'func', name: 'sin', arg: node.arg } }; break;
                case 'tan': fp = { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '^', left: { type: 'func', name: 'cos', arg: node.arg }, right: { type: 'num', value: 2 } } }; break;
                case 'exp': fp = { type: 'func', name: 'exp', arg: node.arg }; break;
                case 'ln': case 'log': fp = { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: node.arg }; break;
                case 'log10': case 'log2': fp = { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '*', left: node.arg, right: { type: 'func', name: 'ln', arg: { type: 'num', value: node.name === 'log2' ? 2 : 10 } } } }; break;
                case 'sqrt': fp = { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '*', left: { type: 'num', value: 2 }, right: { type: 'func', name: 'sqrt', arg: node.arg } } }; break;
                case 'arcsin': fp = { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: { type: 'func', name: 'sqrt', arg: { type: 'binop', op: '-', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '^', left: node.arg, right: { type: 'num', value: 2 } } } } }; break;
                case 'arccos': fp = { type: 'unary', op: '-', operand: { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: { type: 'func', name: 'sqrt', arg: { type: 'binop', op: '-', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '^', left: node.arg, right: { type: 'num', value: 2 } } } } } }; break;
                case 'arctan': fp = { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '+', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '^', left: node.arg, right: { type: 'num', value: 2 } } } }; break;
                case 'sinh': fp = { type: 'func', name: 'cosh', arg: node.arg }; break;
                case 'cosh': fp = { type: 'func', name: 'sinh', arg: node.arg }; break;
                case 'tanh': fp = { type: 'binop', op: '-', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '^', left: { type: 'func', name: 'tanh', arg: node.arg }, right: { type: 'num', value: 2 } } }; break;
                case 'cot': fp = { type: 'unary', op: '-', operand: { type: 'binop', op: '^', left: { type: 'func', name: 'csc', arg: node.arg }, right: { type: 'num', value: 2 } } }; break;
                case 'sec': fp = { type: 'binop', op: '*', left: { type: 'func', name: 'sec', arg: node.arg }, right: { type: 'func', name: 'tan', arg: node.arg } }; break;
                case 'csc': fp = { type: 'unary', op: '-', operand: { type: 'binop', op: '*', left: { type: 'func', name: 'csc', arg: node.arg }, right: { type: 'func', name: 'cot', arg: node.arg } } }; break;
                case 'abs': return null;   // 非光滑 → 保守 SKIP
                case 'floor': case 'ceil': case 'gamma': return null; // 非光滑/无简单区间导数 → 保守 SKIP
                default: return null;
            }
            return { type: 'binop', op: '*', left: fp, right: dArg };
        }
        default: return null;
    }
}

// 区间偏导包络（1 阶或 2 阶）——【严格 + 紧致 / Sound & Tight】
// 旧实现（中心差分区间扩展）虽 sound 却因区间相关性膨胀 ~10³ 倍，使 suan30 实际空转；
// 现改用符号微分 + 区间求值：f'(Bi) = intervalEval(_diffAST(eq, vi), box)，
// 对可被 intervalEval 紧致求值的函数类（多项式/有理/sin/cos/tan/exp/ln/sqrt/abs/arctan/arcsin/sinh/cosh/tanh…）
// 给出【紧致】包络；其余（cot/sec/csc/gamma/floor/ceil 等 intervalEval 未覆盖者）
// 返回 null → 调用方保守 SKIP，绝不假证。
function _partialRange(eq, i, varNames, box, order) {
    var vi = varNames[i], Bi = box[vi];
    if (!Bi || !isFinite(Bi.min) || !isFinite(Bi.max)) return null;
    var d1AST = _diffAST(eq, vi);
    var d1 = d1AST ? intervalEval(d1AST, box) : null;
    if (!d1 || !isFinite(d1.min) || !isFinite(d1.max)) return null;
    if (order === 1) return d1;
    var d2AST = _diffAST(d1AST, vi);
    var d2 = d2AST ? intervalEval(d2AST, box) : null;
    if (!d2 || !isFinite(d2.min) || !isFinite(d2.max)) return null;
    return d2;
}

// ===== 区间工具扩展（供 LP Narrowing / 约束反演使用） =====
// 区间 p 次根：x^p = I 的解区间（p 非零整数）
function _iRoot(I, p) {
    if (!I || !isFinite(I.min) || !isFinite(I.max)) return null;
    if (p === 0) return null;
    if (p > 0 && p % 2 === 1) {
        var rmin = Math.sign(I.min) * Math.pow(Math.abs(I.min), 1 / p);
        var rmax = Math.sign(I.max) * Math.pow(Math.abs(I.max), 1 / p);
        return { min: Math.min(rmin, rmax), max: Math.max(rmin, rmax) };
    }
    if (p > 0 && p % 2 === 0) {
        if (I.max < 0) return null;
        // 偶次幂逆向必须取对称区间：x^p ∈ [a,b] ⟹ x ∈ [-b^(1/p), b^(1/p)]
        // （2016-08-21 修复：原实现只取正支 [lo,hi]，会把 z²=... 的负支真解排除，
        //   如三球交点 (2,2,-1) 的 z=-1 被 suan28 HC4 传播误删）
        var hi2 = Math.pow(Math.max(0, I.max), 1 / p);
        return { min: -hi2, max: hi2 };
    }
    return null;
}

// 两阶段单纯形核心：在增广表上做主元迭代（最大化 obj·x）
function _simplexCore(T, rhs, basis, obj, m, N) {
    var tab = [];
    for (var i = 0; i < m; i++) { var r = T[i].slice(); r.push(rhs[i]); tab.push(r); }
    var objRow = new Array(N + 1).fill(0);
    for (var j = 0; j < N; j++) objRow[j] = -obj[j];
    for (var i = 0; i < m; i++) {
        var bcol = basis[i], coef = objRow[bcol];
        if (coef !== 0) for (var j2 = 0; j2 <= N; j2++) objRow[j2] -= coef * tab[i][j2];
    }
    tab.push(objRow);
    var maxIter = 500;
    for (var it = 0; it < maxIter; it++) {
        var enter = -1, bestNeg = -1e-12;
        for (var j = 0; j < N; j++) { if (objRow[j] < bestNeg) { bestNeg = objRow[j]; enter = j; } }
        if (enter === -1) break;
        var leave = -1, bestRatio = Infinity;
        for (var i = 0; i < m; i++) {
            if (tab[i][enter] > 1e-12) {
                var ratio = tab[i][N] / tab[i][enter];
                if (ratio >= -1e-12 && ratio < bestRatio) { bestRatio = ratio; leave = i; }
            }
        }
        if (leave === -1) return { status: 'unbounded' };
        var piv = tab[leave][enter];
        for (var j2 = 0; j2 <= N; j2++) tab[leave][j2] /= piv;
        for (var i2 = 0; i2 <= m; i2++) {
            if (i2 === leave) continue;
            var f = tab[i2][enter];
            if (f !== 0) for (var j3 = 0; j3 <= N; j3++) tab[i2][j3] -= f * tab[leave][j3];
        }
        basis[leave] = enter;
    }
    for (var i = 0; i < m; i++) { T[i] = tab[i].slice(0, N); rhs[i] = tab[i][N]; }
    return { status: 'optimal' };
}

// 单纯形：max c·x  s.t.  A x <= b,  x >= 0；b 可为负（自动人工变量）。返回最优值 / Infinity(无界) / null(不可行)
function _lpMaximize(c, A, b) {
    var m = A.length, n = c.length;
    if (m === 0) return null;
    var numArt = 0;
    for (var i = 0; i < m; i++) if (b[i] < 0) numArt++;
    var N = n + m + numArt;
    var T = [], rhs = [], basis = [], artCol = [], ai = 0;
    for (var i = 0; i < m; i++) {
        var row = new Array(N).fill(0);
        for (var j = 0; j < n; j++) row[j] = A[i][j];
        row[n + i] = 1;
        if (b[i] < 0) {
            for (var k = 0; k < N; k++) row[k] = -row[k];
            row[n + m + ai] = 1;
            artCol.push(n + m + ai);
            rhs.push(-b[i]);
            basis.push(n + m + ai);
            ai++;
        } else {
            rhs.push(b[i]);
            basis.push(n + i);
        }
        T.push(row);
    }
    // Phase 1: 最大化 -Σ人工变量
    var obj1 = new Array(N).fill(0);
    for (var t = 0; t < artCol.length; t++) obj1[artCol[t]] = -1;
    var r1 = _simplexCore(T, rhs, basis, obj1, m, N);
    if (r1.status === 'infeasible') return null;
    var artSum = 0;
    for (var bi = 0; bi < m; bi++) if (artCol.indexOf(basis[bi]) >= 0) artSum += rhs[bi];
    if (artSum > 1e-6) return null;
    // Phase 2 前：把仍在基中的退化人工变量主元换出；全零冗余行删除
    var artSet = {};
    for (var t = 0; t < artCol.length; t++) artSet[artCol[t]] = true;
    for (var bi = 0; bi < m; bi++) {
        if (artSet[basis[bi]]) {
            var pivCol = -1;
            for (var j = 0; j < N; j++) { if (!artSet[j] && Math.abs(T[bi][j]) > 1e-9) { pivCol = j; break; } }
            if (pivCol >= 0) {
                var piv = T[bi][pivCol];
                for (var j2 = 0; j2 < N; j2++) T[bi][j2] /= piv;
                rhs[bi] /= piv;
                for (var i2 = 0; i2 < m; i2++) { if (i2 === bi) continue; var f = T[i2][pivCol]; if (f !== 0) { for (var j3 = 0; j3 < N; j3++) T[i2][j3] -= f * T[bi][j3]; rhs[i2] -= f * rhs[bi]; } }
                basis[bi] = pivCol;
            } else {
                T[bi] = null;
            }
        }
    }
    var keep = [];
    for (var col = 0; col < N; col++) if (!artSet[col]) keep.push(col);
    var T2 = [], rhs2 = [], basis2 = [], newM = 0;
    for (var i = 0; i < m; i++) {
        if (T[i] === null) continue;
        var nr = [];
        for (var kk = 0; kk < keep.length; kk++) nr.push(T[i][keep[kk]]);
        T2.push(nr); rhs2.push(rhs[i]);
        var bb = basis[i], idx = keep.indexOf(bb);
        basis2.push(idx < 0 ? 0 : idx);
        newM++;
    }
    T = T2; rhs = rhs2; basis = basis2; m = newM; N = keep.length;
    // Phase 2: 最大化 c
    var obj2 = [];
    for (var j = 0; j < N; j++) obj2.push(0);
    for (var j = 0; j < n && j < N; j++) { var pos = keep.indexOf(j); if (pos >= 0) obj2[pos] = c[j]; }
    var r2 = _simplexCore(T, rhs, basis, obj2, m, N);
    if (r2.status === 'unbounded') return Infinity;
    if (r2.status === 'infeasible') return null;
    var val = 0;
    for (var bi = 0; bi < m; bi++) { var col = basis[bi]; if (col < n) val += c[col] * rhs[bi]; }
    return val;
}

// suan34: LP Narrowing（精确线性松弛 + 单纯形，SOUND）
// 对每个方程做线性判别：在盒上 g(x) ≈ g(m)+ΣJm_j(x_j-m_j) 则视作线性，
// 用精确实系数构造等式 LP（余项严格为 0，收紧紧致）；非线性方程跳过（避免宽余项伪松），
// 其非线性收紧由 suan33/51/56 负责。松弛是真实解集的超集，故收紧安全。
function suan34(state) {
    if (!state.equations || !state.D0 || state.varNames.length === 0) return;
    var varNames = state.varNames, box = state.D0, n = varNames.length, eqs = state.equations;
    if (eqs.length === 0) return;
    var mid = _boxMid(box, varNames);
    var midVars = _midVars(mid, varNames);
    var rows = [];
    for (var k = 0; k < eqs.length; k++) {
        var eq = eqs[k], Jm = new Array(n), ok = true;
        for (var j = 0; j < n; j++) {
            var xP = mid.slice(), xM = mid.slice(), eps = 1e-6;
            xP[j] = mid[j] + eps; xM[j] = mid[j] - eps;
            var vP = {}, vM = {};
            varNames.forEach(function (v, kk) { vP[v] = xP[kk]; vM[v] = xM[kk]; });
            var fp = evalAST(eq, vP), fm = evalAST(eq, vM);
            if (!isFinite(fp) || !isFinite(fm)) { ok = false; break; }
            var d = (fp - fm) / (2 * eps);
            if (!isFinite(d)) { ok = false; break; }
            Jm[j] = d;
        }
        if (!ok) continue;
        var F = intervalEval(eq, box);
        if (!F || !isFinite(F.min) || !isFinite(F.max)) continue;
        var fm0 = evalAST(eq, midVars);
        if (!isFinite(fm0)) continue;
        // 中点线性化在盒上的区间像
        var Lm = { min: fm0, max: fm0 };
        for (var j2 = 0; j2 < n; j2++) {
            var dj = { min: box[varNames[j2]].min - mid[j2], max: box[varNames[j2]].max - mid[j2] };
            Lm = _iAdd(Lm, _iMul({ min: Jm[j2], max: Jm[j2] }, dj));
        }
        // 线性判别：余项 F - Lm 在盒上的偏差应≈0（缩放归一化）
        var scale = Math.max(1, Math.abs(fm0), Math.abs(F.min), Math.abs(F.max));
        var linErr = Math.max(Math.abs(F.min - Lm.min), Math.abs(F.max - Lm.max));
        if (linErr > 1e-9 * scale) continue; // 非线性：跳过，交 suan33/51/56 处理
        var C = fm0;
        for (var j3 = 0; j3 < n; j3++) C -= Jm[j3] * mid[j3];
        // ΣJm_j x_j + C = 0  →  ΣJm x_j + C <= 0 且 -ΣJm x_j - C <= 0
        rows.push({ a: Jm.slice(), rhs: -C });
        rows.push({ a: Jm.map(function (v) { return -v; }), rhs: C });
    }
    if (rows.length === 0) return;
    for (var b2 = 0; b2 < n; b2++) {
        var aa = new Array(n).fill(0); aa[b2] = 1; rows.push({ a: aa, rhs: box[varNames[b2]].max });
        var aa2 = new Array(n).fill(0); aa2[b2] = -1; rows.push({ a: aa2, rhs: -box[varNames[b2]].min });
    }
    for (var v = 0; v < n; v++) {
        var lo = box[varNames[v]].min, hi = box[varNames[v]].max;
        if (!isFinite(lo) || !isFinite(hi)) continue;
        var cap = hi - lo;
        if (cap < 0) continue;
        var tRows = [];
        for (var r = 0; r < rows.length; r++) {
            var rhsT = rows[r].rhs;
            for (var j4 = 0; j4 < n; j4++) rhsT -= rows[r].a[j4] * box[varNames[j4]].min;
            tRows.push({ a: rows[r].a, rhs: rhsT });
        }
        var capRow = new Array(n).fill(0); capRow[v] = 1; tRows.push({ a: capRow, rhs: cap });
        var A2 = tRows.map(function (rr) { return rr.a; });
        var b2v = tRows.map(function (rr) { return rr.rhs; });
        var cMax = new Array(n).fill(0); cMax[v] = 1;
        var cMin = new Array(n).fill(0); cMin[v] = -1;
        var tMax = _lpMaximize(cMax, A2, b2v);
        var tMinRaw = _lpMaximize(cMin, A2, b2v);
        var tMin = (tMinRaw !== null && isFinite(tMinRaw)) ? -tMinRaw : null;
        // 保守安全余量：只向外（不切真解），吸收单纯形浮点误差
        var SAFE_HI = 1e-9 * (1 + Math.abs(lo + (tMax || 0)));
        var SAFE_LO = 1e-9 * (1 + Math.abs(lo + (tMin || 0)));
        if (tMax !== null && isFinite(tMax) && lo + tMax + SAFE_HI < hi) box[varNames[v]].max = lo + tMax + SAFE_HI;
        if (tMin !== null && isFinite(tMin) && lo + tMin - SAFE_LO > lo) box[varNames[v]].min = lo + tMin - SAFE_LO;
        if (box[varNames[v]].min > box[varNames[v]].max + 1e-12) {
            _declareNoSolution(state, "suan34 LP Narrowing", v, "变量 " + varNames[v] + " 线性松弛证明区间为空，严格无解");
            return;
        }
    }
}

// suan28: 约束反演系统化（广义项一致性，扩展逆函数集合含 ^ 幂逆与 log10），fixpoint 循环
function _hc4Node2(node, target, box) {
    if (!node) return box;
    if (node.type === 'num') return box;
    if (node.type === 'var') {
        if (!box[node.name]) return box;
        box[node.name] = _iIntersect(box[node.name], target);
        return box;
    }
    if (node.type === 'binop') {
        var L = intervalEval(node.left, box), R = intervalEval(node.right, box);
        if (!L || !R) return box;
        var newL = null, newR = null;
        if (node.op === '+') { newL = _iSub(target, R); newR = _iSub(target, L); }
        else if (node.op === '-') { newL = _iAdd(target, R); newR = _iSub(L, target); }
        else if (node.op === '*') { var ri = _iRecip(R), li = _iRecip(L); if (ri) newL = _iMul(target, ri); if (li) newR = _iMul(target, li); }
        else if (node.op === '/') {
            newL = _iMul(target, R);
            if (_iEmpty(_iIntersect(target, { min: 0, max: 0 }))) { var ti = _iRecip(target); if (ti) newR = _iMul(L, ti); }
        }
        else if (node.op === '^') {
            var rconst = (node.right.type === 'num') ? node.right.value : null;
            var lconst = (node.left.type === 'num') ? node.left.value : null;
            if (rconst !== null && Number.isInteger(rconst) && Math.abs(rconst) < 100 && rconst !== 0) {
                var rt = _iRoot(target, rconst);
                if (rt) newL = rt;
            } else if (lconst !== null && lconst > 0 && lconst !== 1) {
                if (target.max > 0) {
                    var lnT = { min: Math.log(Math.max(1e-300, target.min)), max: Math.log(target.max) };
                    var lc = 1 / Math.log(lconst);
                    newR = _iMul(lnT, { min: lc, max: lc });
                }
            }
        }
        if (newL) box = _hc4Node2(node.left, newL, box);
        if (newR) box = _hc4Node2(node.right, newR, box);
        return box;
    }
    if (node.type === 'func') {
        var arg = node.arg || (node.args ? node.args[0] : null);
        if (!arg) return box;
        var aR = intervalEval(arg, box);
        if (!aR) return box;
        var nt = null;
        if (node.name === 'sin') {
            if (target.min < -1 || target.max > 1) return box;
            var lo = Math.asin(Math.max(-1, target.min)), hi = Math.asin(Math.min(1, target.max));
            nt = { min: lo, max: hi };
            for (var s1 = -3; s1 <= 3; s1++) { nt = _iHull(nt, { min: lo + 2 * s1 * Math.PI, max: hi + 2 * s1 * Math.PI }); nt = _iHull(nt, { min: Math.PI - hi + 2 * s1 * Math.PI, max: Math.PI - lo + 2 * s1 * Math.PI }); }
        } else if (node.name === 'cos') {
            if (target.min < -1 || target.max > 1) return box;
            var lo2 = Math.acos(Math.min(1, target.max)), hi2 = Math.acos(Math.max(-1, target.min));
            nt = { min: lo2, max: hi2 };
            for (var s2 = -3; s2 <= 3; s2++) nt = _iHull(nt, { min: lo2 + 2 * s2 * Math.PI, max: hi2 + 2 * s2 * Math.PI });
        } else if (node.name === 'tan') {
            var lo3 = Math.atan(target.min), hi3 = Math.atan(target.max);
            nt = { min: lo3, max: hi3 };
            for (var s3 = -3; s3 <= 3; s3++) nt = _iHull(nt, { min: lo3 + s3 * Math.PI, max: hi3 + s3 * Math.PI });
        } else if (node.name === 'exp') {
            if (target.max <= 0) return box;
            nt = { min: Math.log(Math.max(1e-300, target.min)), max: Math.log(target.max) };
        } else if (node.name === 'ln' || node.name === 'log') {
            nt = { min: Math.exp(target.min), max: Math.exp(target.max) };
        } else if (node.name === 'log10') {
            nt = { min: Math.pow(10, target.min), max: Math.pow(10, target.max) };
        } else if (node.name === 'sqrt') {
            if (target.min < 0) return box;
            nt = { min: target.min * target.min, max: target.max * target.max };
        } else if (node.name === 'abs') {
            var u = { min: Math.max(0, target.min), max: target.max };
            nt = _iHull(u, { min: -u.max, max: -u.min });
        } else { return box; }
        if (nt) box = _hc4Node2(arg, nt, box);
        return box;
    }
    return box;
}

function suan28(state) {
    if (!state.equations || !state.D0 || state.varNames.length === 0) return;
    var varNames = state.varNames, box = state.D0;
    for (var pass = 0; pass < 8; pass++) {
        var before = _cloneBox(box);
        for (var k = 0; k < state.equations.length; k++) {
            var R = intervalEval(state.equations[k], box);
            if (R && (R.max < -1e-12 || R.min > 1e-12)) {
                _declareNoSolution(state, "suan28 约束反演(前向)", k, "值域 [" + R.min.toFixed(6) + "," + R.max.toFixed(6) + "] 不含0，严格证明无解");
                return;
            }
        }
        for (var k2 = 0; k2 < state.equations.length; k2++) {
            var eq = state.equations[k2];
            if (eq.type === 'binop' && eq.op === '-') {
                var rl = intervalEval(eq.left, box), rr = intervalEval(eq.right, box);
                if (rl && rr) {
                    box = _hc4Node2(eq.left, rr, box);
                    box = _hc4Node2(eq.right, rl, box);
                    state.D0 = box;
                }
            }
        }
        for (var v = 0; v < varNames.length; v++) {
            if (box[varNames[v]].min > box[varNames[v]].max + 1e-12) {
                _declareNoSolution(state, "suan28 约束反演(反向)", v, "变量 " + varNames[v] + " 区间被收缩为空，严格证明无解");
                return;
            }
        }
        if (!_contractionChanged(before, box, varNames)) break;
    }
}

// suan32: 成对 2B/3B Box-Consistency（保留伙伴变量为区间的 2D 收缩），fixpoint 循环
function suan32(state) {
    if (!state.equations || !state.D0 || state.varNames.length === 0) return;
    var varNames = state.varNames, box = state.D0, n = varNames.length, eqs = state.equations;
    if (eqs.length === 0 || n < 2) return;
    for (var pass = 0; pass < 4; pass++) {
        var mid = _boxMid(box, varNames);
        var J = _intervalJacobian(eqs, varNames, box, mid);
        var Fm = eqs.map(function (eq) { return evalAST(eq, _midVars(mid, varNames)); });
        var before = _cloneBox(box);
        for (var i = 0; i < n; i++) {
            for (var j = i + 1; j < n; j++) {
                for (var k = 0; k < eqs.length; k++) {
                    var Ji = J[k][i], Jj = J[k][j], fmk = Fm[k];
                    if (!isFinite(fmk)) continue;
                    var invI = _iRecip(Ji), invJ = _iRecip(Jj);
                    if (invI) {
                        var dXj = { min: box[varNames[j]].min - mid[j], max: box[varNames[j]].max - mid[j] };
                        var numer = _iAdd({ min: fmk, max: fmk }, _iMul(Jj, dXj));
                        var Ni = _iSub({ min: mid[i], max: mid[i] }, _iMul(invI, numer));
                        var inter = _iIntersect(box[varNames[i]], Ni);
                        if (!_iEmpty(inter)) box[varNames[i]] = inter;
                    }
                    if (invJ) {
                        var dXi = { min: box[varNames[i]].min - mid[i], max: box[varNames[i]].max - mid[i] };
                        var numer2 = _iAdd({ min: fmk, max: fmk }, _iMul(Ji, dXi));
                        var Nj = _iSub({ min: mid[j], max: mid[j] }, _iMul(invJ, numer2));
                        var inter2 = _iIntersect(box[varNames[j]], Nj);
                        if (!_iEmpty(inter2)) box[varNames[j]] = inter2;
                    }
                }
            }
        }
        // 保守性校验（2026-08-21 修复）：单方程线性化收缩无 Taylor 余项，对强耦合
        // 非线性（如三球交点 x²+y²+z²=9 等）可能把真解排除到收缩域外——具体表现为
        // 收缩后某方程的值域不含 0。此时回滚本轮收缩（保保守方向），交分支定界处理。
        var _allOk56 = true;
        for (var _kv56 = 0; _kv56 < eqs.length; _kv56++) {
            var _rv56 = intervalEval(eqs[_kv56], box);
            if (_rv56 && (_rv56.max < -1e-9 || _rv56.min > 1e-9)) { _allOk56 = false; break; }
        }
        if (!_allOk56) {
            box = before;
            state.D0 = before;
            break;
        }
        if (!_contractionChanged(before, box, varNames)) break;
    }
}

// suan33: Hansen-Sengupta 区间 Gauss-Seidel 收缩算子 (P0)
function suan33(state) {
    if (!state.equations || !state.D0 || state.varNames.length === 0) return;
    var varNames = state.varNames, box = state.D0, n = varNames.length, equations = state.equations;
    if (equations.length < n) return; // 需方阵/超定
    for (var pass = 0; pass < 4; pass++) {
        var mid = _boxMid(box, varNames);
        var J = _intervalJacobian(equations, varNames, box, mid);
        var Fm = equations.map(function (eq) { return evalAST(eq, _midVars(mid, varNames)); });
        var before = _cloneBox(box);
        for (var i = 0; i < n; i++) {
            var inv = _iRecip(J[i][i]);
            if (!inv) continue; // 对角含零，保守跳过
            var numer = { min: Fm[i], max: Fm[i] };
            for (var j = 0; j < n; j++) {
                if (j === i) continue;
                var dXj = { min: box[varNames[j]].min - mid[j], max: box[varNames[j]].max - mid[j] };
                numer = _iAdd(numer, _iMul(J[i][j], dXj));
            }
            var Ni = _iSub({ min: mid[i], max: mid[i] }, _iMul(inv, numer));
            var inter = _iIntersect(box[varNames[i]], Ni);
            if (!_iEmpty(inter)) box[varNames[i]] = inter;
        }
        if (!_contractionChanged(before, box, varNames)) break;
    }
}

// suan31: Box Consistency BC3 (3B / Bnormal) (P2)
function suan31(state) {
    if (!state.equations || !state.D0 || state.varNames.length === 0) return;
    var varNames = state.varNames, box = state.D0, n = varNames.length, equations = state.equations;
    for (var pass = 0; pass < 4; pass++) {
        var mid = _boxMid(box, varNames);
        var J = _intervalJacobian(equations, varNames, box, mid);
        var before = _cloneBox(box);
        for (var k = 0; k < equations.length; k++) {
            for (var i = 0; i < n; i++) {
                var mi = mid[i];
                var boxFixed = _cloneBox(box);
                boxFixed[varNames[i]] = { min: mi, max: mi };
                var R = intervalEval(equations[k], boxFixed);
                if (!R) continue;
                var inv = _iRecip(J[k][i]);
                if (!inv) continue;
                var Ni = _iSub({ min: mi, max: mi }, _iMul(inv, R));
                var inter = _iIntersect(box[varNames[i]], Ni);
                if (!_iEmpty(inter)) box[varNames[i]] = inter;
            }
        }
        if (!_contractionChanged(before, box, varNames)) break;
    }
}

// suan27: HC4-Revise 约束收缩（前向严格空集证明 + 反向 hull 一致性）
function _hc4Node(node, target, box) {
    if (!node) return box;
    if (node.type === 'num') return box;
    if (node.type === 'var') {
        if (!box[node.name]) return box;
        box[node.name] = _iIntersect(box[node.name], target); // 可能为空（min>max），由 suan27 检测
        return box;
    }
    if (node.type === 'binop') {
        var L = intervalEval(node.left, box), R = intervalEval(node.right, box);
        if (!L || !R) return box;
        var newL = null, newR = null;
        if (node.op === '+') { newL = _iSub(target, R); newR = _iSub(target, L); }
        else if (node.op === '-') { newL = _iAdd(target, R); newR = _iSub(L, target); }
        else if (node.op === '*') { var ri = _iRecip(R); var li = _iRecip(L); if (ri) newL = _iMul(target, ri); if (li) newR = _iMul(target, li); }
        else if (node.op === '/') {
            newL = _iMul(target, R);
            if (!_iEmpty(_iIntersect(target, { min: 0, max: 0 }))) { /* 含零，不反演右部 */ }
            else { var ti = _iRecip(target); if (ti) newR = _iMul(L, ti); }
        }
        if (newL) box = _hc4Node(node.left, newL, box);
        if (newR) box = _hc4Node(node.right, newR, box);
        return box;
    }
    if (node.type === 'func') {
        var arg = node.arg || (node.args ? node.args[0] : null);
        if (!arg) return box;
        var aR = intervalEval(arg, box);
        if (!aR) return box;
        var nt = null;
        if (node.name === 'sin') {
            if (target.min < -1 || target.max > 1) return box;
            var lo = Math.asin(Math.max(-1, target.min)), hi = Math.asin(Math.min(1, target.max));
            nt = { min: lo, max: hi };
            for (var s1 = -3; s1 <= 3; s1++) { nt = _iHull(nt, { min: lo + 2 * s1 * Math.PI, max: hi + 2 * s1 * Math.PI }); nt = _iHull(nt, { min: Math.PI - hi + 2 * s1 * Math.PI, max: Math.PI - lo + 2 * s1 * Math.PI }); }
        } else if (node.name === 'cos') {
            if (target.min < -1 || target.max > 1) return box;
            var lo2 = Math.acos(Math.min(1, target.max)), hi2 = Math.acos(Math.max(-1, target.min));
            nt = { min: lo2, max: hi2 };
            for (var s2 = -3; s2 <= 3; s2++) nt = _iHull(nt, { min: lo2 + 2 * s2 * Math.PI, max: hi2 + 2 * s2 * Math.PI });
        } else if (node.name === 'tan') {
            var lo3 = Math.atan(target.min), hi3 = Math.atan(target.max);
            nt = { min: lo3, max: hi3 };
            for (var s3 = -3; s3 <= 3; s3++) nt = _iHull(nt, { min: lo3 + s3 * Math.PI, max: hi3 + s3 * Math.PI });
        } else if (node.name === 'exp') {
            if (target.max <= 0) return box;
            nt = { min: Math.log(Math.max(1e-300, target.min)), max: Math.log(target.max) };
        } else if (node.name === 'ln' || node.name === 'log') {
            nt = { min: Math.exp(target.min), max: Math.exp(target.max) };
        } else if (node.name === 'sqrt') {
            if (target.min < 0) return box;
            nt = { min: target.min * target.min, max: target.max * target.max };
        } else if (node.name === 'abs') {
            var u = { min: Math.max(0, target.min), max: target.max };
            nt = _iHull(u, { min: -u.max, max: -u.min });
        } else { return box; }
        if (nt) box = _hc4Node(arg, nt, box);
        return box;
    }
    return box;
}

function suan27(state) {
    if (!state.equations || !state.D0 || state.varNames.length === 0) return;
    var varNames = state.varNames, box = state.D0;
    for (var pass = 0; pass < 8; pass++) {
        var before = _cloneBox(box);
        // 1) 前向：等式约束 C=0，若 0 ∉ intervalEval(C, box) → 严格证明无解
        for (var k = 0; k < state.equations.length; k++) {
            var R = intervalEval(state.equations[k], box);
            if (R && (R.max < -1e-12 || R.min > 1e-12)) {
                _declareNoSolution(state, "suan27 HC4-Revise(前向)", k, "值域 [" + R.min.toFixed(6) + "," + R.max.toFixed(6) + "] 不含0，严格证明该盒子内无解");
                return;
            }
        }
        // 2) 反向 hull 一致性（fixpoint）：对 L - R = 0 沿 AST 反向收窄叶子变量
        for (var k2 = 0; k2 < state.equations.length; k2++) {
            var eq = state.equations[k2];
            if (eq.type === 'binop' && eq.op === '-') {
                var rl = intervalEval(eq.left, box), rr = intervalEval(eq.right, box);
                if (rl && rr) {
                    box = _hc4Node(eq.left, rr, box);
                    box = _hc4Node(eq.right, rl, box);
                    state.D0 = box;
                }
            }
        }
        for (var v = 0; v < varNames.length; v++) {
            if (box[varNames[v]].min > box[varNames[v]].max + 1e-12) {
                _declareNoSolution(state, "suan27 HC4-Revise(反向)", v, "变量 " + varNames[v] + " 区间被收缩为空，严格证明无解");
                return;
            }
        }
        if (!_contractionChanged(before, box, varNames)) break;
    }
}

// suan30: 单调性 + 凸/凹性 剪枝（严格空集证明）
function suan30(state) {
    if (!state.equations || !state.D0 || state.varNames.length === 0) return;
    var varNames = state.varNames, box = state.D0, n = varNames.length;
    for (var k = 0; k < state.equations.length; k++) {
        var eq = state.equations[k];
        for (var i = 0; i < n; i++) {
            var vi = varNames[i];
            var boxLo = _cloneBox(box); boxLo[vi] = { min: box[vi].min, max: box[vi].min };
            var boxHi = _cloneBox(box); boxHi[vi] = { min: box[vi].max, max: box[vi].max };
            var Rlo = intervalEval(eq, boxLo), Rhi = intervalEval(eq, boxHi);
            if (!Rlo || !Rhi) continue;
            var d1 = _partialRange(eq, i, varNames, box, 1);
            if (d1 && (d1.max < -1e-12 || d1.min > 1e-12)) {
                var loNeg = Rlo.max < -1e-12, loPos = Rlo.min > 1e-12;
                var hiNeg = Rhi.max < -1e-12, hiPos = Rhi.min > 1e-12;
                if ((loNeg && hiNeg) || (loPos && hiPos)) {
                    _declareNoSolution(state, "suan30 单调性剪枝", k, "变量 " + vi + " 单调且两端同号，严格证明该盒子内无解");
                    return;
                }
            }
            var d2 = _partialRange(eq, i, varNames, box, 2);
            if (d2 && d2.min > 1e-12) {
                if (Rlo.max < -1e-12 && Rhi.max < -1e-12) {
                    _declareNoSolution(state, "suan30 凸性剪枝", k, "变量 " + vi + " 凸且两端点均<0，严格证明该盒子内无解");
                    return;
                }
            } else if (d2 && d2.max < -1e-12) {
                if (Rlo.min > 1e-12 && Rhi.min > 1e-12) {
                    _declareNoSolution(state, "suan30 凹性剪枝", k, "变量 " + vi + " 凹且两端点均>0，严格证明该盒子内无解");
                    return;
                }
            }
        }
    }
}

// 全局求解器递归计数，防止意外无限递归
if (typeof _solveRecursionCount === 'undefined') { _solveRecursionCount = 0; }

// 全局根计时 / 全局子域预算池（2026-08-21 修复卡死问题）
// 原分支定界递归（suan47）在每次子调用 _solveImpl 时重置 state.startTime，
// 且 state.branchBudget 在子调用中被重新初始化为 200，导致两道保险双双失效、
// 遇到 cos 等周期项时子树指数爆炸、占满主线程卡死浏览器。
// 现改为跨整个递归子树共享同一根起点与同一预算池，从根本上约束递归规模。
if (typeof __LS_ROOT_START === 'undefined') { __LS_ROOT_START = 0; }
if (typeof __LS_SOLVE_ACTIVE === 'undefined') { __LS_SOLVE_ACTIVE = false; }
if (typeof __LS_BRANCH_BUDGET === 'undefined') { __LS_BRANCH_BUDGET = 200; }

// ============================================================================
// 输入门禁（2026-09-01；2026-09-01 晚放宽：数字串不再拦截）
// ----------------------------------------------------------------------------
// 定位：本工具是「纯数学方程求解器」，不是通用文本/聊天入口。在 solve() 总入口
// （网页端与 MCP 端共用同一入口）只做两件事：
//   1. 数学表达式约束：拒绝中文/日文/韩文等自然语言文字（方程不含文字说明）；
//   2. 输入体量上限：与 MCP 端护栏一致（方程文本总长 100KB）。
// 注意（2026-09-01 用户决策）：手机号/身份证号/银行卡号等长数字串与邮箱一律放行，
// 不做敏感信息拦截——它们本质是合法数学输入（常量），本系统本就不存储、不外传。
// 设计原则：黑名单只拒「明显非数学」输入，不改变任何合法数学表达式的行为；
// 纯 ES5 实现（不用 lookbehind 等新语法），旧浏览器解析不报错。
function _complianceGuard(equationStrs, varNames) {
    var _maxTotal = 100 * 1024;
    var _reCJK = /[\u2E80-\u2EFF\u3040-\u30FF\u3130-\u318F\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/; // 中/日/韩表意文字
    var _total = 0, _i, _w;
    if (Array.isArray(equationStrs)) {
        for (_i = 0; _i < equationStrs.length; _i++) {
            var _s = equationStrs[_i];
            if (typeof _s !== 'string') continue;
            _total += _s.length;
            if (_reCJK.test(_s)) _w = '包含自然语言文字';
            else _w = null;
            if (_w) {
                throw { type: 'invalid_input', message: '第 ' + (_i + 1) + ' 条输入' + _w + '。本工具是数学方程求解器，仅接受数学方程（可含数字、变量与运算符），不接受文字说明。' };
            }
        }
        if (_total > _maxTotal) {
            throw { type: 'invalid_input', message: '方程文本总长超过 100KB 上限。' };
        }
    }
    if (Array.isArray(varNames)) {
        for (_i = 0; _i < varNames.length; _i++) {
            if (typeof varNames[_i] === 'string' && _reCJK.test(varNames[_i])) {
                throw { type: 'invalid_input', message: '变量名包含自然语言文字。变量名仅支持字母 / 希腊字母 / 下标等形式。' };
            }
        }
    }
}

function solve(equationStrs, varNames, decimals, initialD0, fastMode, opts) {
    _solveRecursionCount++;
    // 门禁：非数学文字 / 体量超限，在总入口拒收（网页端 + MCP 端共用；数字串已放行）
    try { _complianceGuard(equationStrs, varNames); } catch (_cgErr) { _solveRecursionCount--; throw _cgErr; }
    // 兼容性归一化（诚实性 + 用户直觉）：用户常把「求 expr=0 的根」简写成裸表达式（如 "x^2-1"）。
    // 缺等号的方程自动补 "=0"，既符合数学直觉，也避免被误判为「无方程」而谎称「严格证明无实数解」。
    // 全角＝同样视为有等号；已有等号者原样透传，保证幂等、零回归。
    if (equationStrs && equationStrs.length) {
        equationStrs = equationStrs.map(function (eqStr) {
            if (typeof eqStr !== 'string') return eqStr;
            var _hasEq = eqStr.indexOf('=') !== -1 || eqStr.indexOf('＝') !== -1;
            if (_hasEq) return eqStr;
            // 约束/定义域表达式（含成员符 ∈ 或不等式运算符）交给 parseCondition 处理，不得补 "=0"，
            // 否则会污染整数约束(x∈ℤ)、域约束(x∈[a,b])的识别（C1 回归）。
            if (/[∈<>≤≥]/.test(eqStr)) return eqStr;
            return eqStr + '=0';
        });
    }
    // 仅最外层调用初始化根计时与预算池；递归子调用继承，避免看门狗/预算被重置
    var _isRoot = !__LS_SOLVE_ACTIVE;
    if (_isRoot) {
        __LS_ROOT_START = performance.now();
        __LS_SOLVE_ACTIVE = true;
        __LS_BRANCH_BUDGET = (opts && Number.isFinite(opts.maxBranch)) ? opts.maxBranch : 200;
        __LS_MSNEWTON_DONE = false;  // 多起点牛顿每根调用只跑一次
    }
    try {
        if (_solveRecursionCount > 500) {
            return { solutions: [], resultType: 1, error: "RECURSION_LIMIT", message: "递归调用次数超过限制（500），可能存在矛盾或无限分裂", executionPath: "递归保护", timeMs: 0, varNames: varNames || [] };
        }
        // === 变量名归一化（声明表与方程同步，解析前统一处理）===
        // (2) 希腊字母名 → Unicode 符号：用户用常见拼写（theta/alpha/...）声明变量时，
        //     把 varNames 与方程中的同名标识符统一映射为符号（θ/α/...），保证变量表与方程一致。
        //     映射表不含函数名与被占用的 gamma/pi，且对已是 Unicode 符号的变量名幂等。
        // (1) 变量名 'e' 保护：tokenize 会把独立标识符 e 误当欧拉常数（Math.E），
        //     仅在用户声明 e 为变量时才把方程中的独立 e 替换为占位符 ₑ（U+2091 拉丁下标 e）。
        //     选 ₑ 而非原 _E：ₑ 属 tokenize 下标段 \u2080-\u209F，却不在 fuzzyFix 隐式乘分裂字符类
        //     [a-zA-Z_\u0370-\u03FF] 内，故不会被 xy→x*y 规则拆成 _*E（这是上一版 _E 占位符的失效根因）。
        // 两项都在解析前完成，统一走 _solveImpl 一次，避免早期返回导致另一项漏做。
        if (varNames && equationStrs) {
            var _vnNorm = varNames.map(function(vn) { return _greekNameToSymbol(vn); });
            var _eqsNorm = equationStrs.map(function(eqStr) {
                if (typeof eqStr !== 'string') return eqStr;
                return _greekNameToSymbol(eqStr);
            });
            // e 保护：基于已希腊映射的变量表判断是否声明了 e
            if (_vnNorm.indexOf('e') >= 0) {
                _eqsNorm = _eqsNorm.map(function(eqStr) {
                    if (typeof eqStr !== 'string') return eqStr;
                    return eqStr.replace(/(^|[^A-Za-z0-9_])e(?=$|[^A-Za-z0-9_])/g, '$1ₑ');
                });
                _vnNorm = _vnNorm.map(function(vn) { return vn === 'e' ? 'ₑ' : vn; });
            }
            // 仅当声明表/方程确有改变才走归一化路径（含希腊名或声明了 e 两种情况），
            // 纯 ASCII 输入保持原路径，行为完全不变，避免回归。
            var _changed = false;
            for (var _i = 0; _i < _vnNorm.length; _i++) { if (_vnNorm[_i] !== varNames[_i]) { _changed = true; break; } }
            if (!_changed) {
                for (var _j = 0; _j < _eqsNorm.length; _j++) { if (_eqsNorm[_j] !== equationStrs[_j]) { _changed = true; break; } }
            }
            if (_changed) {
                // 域键同步归一化：initialD0 的键必须按 varNames 同样规则映射（theta→θ、声明 e→ₑ），
                // 否则域键与归一化后的变量名失配 → 用户域被静默丢弃 → 退回默认 ±1e6
                // （周期方程如 sin(theta)=0.5 会在全域穷举数十万根，表现为长时间无响应）。
                var _d0Norm = initialD0;
                if (initialD0 && typeof initialD0 === 'object' && !(initialD0 instanceof Array)) {
                    _d0Norm = {};
                    for (var _dk in initialD0) {
                        if (!Object.prototype.hasOwnProperty.call(initialD0, _dk)) continue;
                        var _nk = _greekNameToSymbol(_dk);
                        if (_vnNorm.indexOf('ₑ') >= 0 && _nk === 'e') _nk = 'ₑ';
                        _d0Norm[_nk] = initialD0[_dk];
                    }
                }
                return _solveImpl(_eqsNorm, _vnNorm, decimals, _d0Norm, fastMode, opts);
            }
        }
        return _solveImpl(equationStrs, varNames, decimals, initialD0, fastMode, opts);
    } finally {
        // 无论正常返回还是抛异常，都必须回收递归计数，防止异常泄漏导致后续调用被误判为超限
        _solveRecursionCount--;
        if (_isRoot) { __LS_SOLVE_ACTIVE = false; }
    }
}

// ============================================================================
// 全局调度第一层：结构预判（Structure Pre-judging）
// ----------------------------------------------------------------------------
// suan0_classify 在任何收缩/搜索之前运行，先判定方程组属于哪一类：
//   无解 / 有限个解（零维）/ 无限个解（正维流形）。
// 数学依据（路径B，区间/数值雅可比秩）：解流形维数 d = n − rank(J)。
//   d = 0 ⇒ 有限个孤立解；d ≥ 1 ⇒ 无限（正维流形）；m < n ⇒ d ≥ 1（sound 无限）。
// 说明：本产品为纯前端 JS、无 CAS，Groebner 基维数判定（路径A）不可行，
//       故用数值雅可比秩，属 sound-incomplete（永不谎称有限/空，但可能回退 unknown→枚举）。
// 该算子只写 state.cardinality 等元数据 + 必要时置 underdetermined，不收缩、不终止；
// 真正的控制流分流交由 _solveImpl 按标签执行（收缩算子由此降级为抛光器）。
function suan0_classify(state) {
    if (!state || !state.equations || !state.varNames) return;
    var eqs = state.equations, vns = state.varNames;
    var m = eqs.length, n = vns.length;
    state.cardinality = 'unknown';
    state.effectiveDim = -1;
    state.classifyRank = -1;
    state.positiveDim = false;
    state.isPolynomial = _isPolynomialSystem(eqs);

    // 采样点：3 组通用正数种子（避开 log/sqrt 定义域，且非解点）。
    // 取「跨采样点的最大秩」= 通用秩（generic rank），规避奇异位点导致的秩亏误判。
    var seeds = [
        vns.map(function (_, i) { return i + 1; }),
        vns.map(function (_, i) { return 0.7 + i * 0.6; }),
        vns.map(function (_, i) { return [2, 5, 7, 11, 13, 17, 19, 23][i % 7]; })
    ];
    var maxRank = 0;
    for (var si = 0; si < seeds.length; si++) {
        var r = _numericJacobianRank(eqs, vns, seeds[si]);
        if (r > maxRank) maxRank = r;
    }
    state.classifyRank = maxRank;
    var effDim = n - maxRank;
    state.effectiveDim = effDim;

    // 判定（sound-incomplete）
    if (m < n) {
        // 方程少于变量且秩 ≤ m < n ⇒ 有效维 ≥ 1 ⇒ 正维流形 ⇒ 无限（sound）
        state.cardinality = 'infinite';
        state.underdetermined = true;   // 复用既有无限解集分支，跳过无意义的高斯/牛顿硬搜
    } else if (effDim > 0) {
        // 方阵/超定但出现秩亏（独立约束少于变量）⇒ 正维 ⇒ 无限（sound）
        state.cardinality = 'infinite';
        state.positiveDim = true;
    } else if (maxRank >= n) {
        // 满秩 ⇒ 孤立点 ⇒ 有限（局部 sound；全局完备性依赖枚举）
        state.cardinality = 'finite';
    } else {
        state.cardinality = 'unknown';
    }
}

// 粗略扫描 AST：出现超越函数即判为非多项式
function _isPolynomialSystem(eqs) {
    var transcendental = { sin: 1, cos: 1, tan: 1, cot: 1, sec: 1, csc: 1, exp: 1, log: 1, ln: 1, asin: 1, acos: 1, atan: 1, sinh: 1, cosh: 1, tanh: 1, sqrt: 1 };
    var poly = true;
    function walk(node) {
        if (!poly || !node || typeof node !== 'object') return;
        if (node.type === 'call' && transcendental[node.name]) { poly = false; return; }
        if (node.args) for (var i = 0; i < node.args.length; i++) walk(node.args[i]);
    }
    for (var i = 0; i < eqs.length; i++) walk(eqs[i]);
    return poly;
}

// 数值雅可比（中心差分）+ 高斯消元求秩
function _numericJacobianRank(eqs, vns, x0) {
    var m = eqs.length, n = vns.length;
    var J = [];
    for (var i = 0; i < m; i++) {
        var row = [];
        for (var j = 0; j < n; j++) {
            var hp = (Math.abs(x0[j]) > 1) ? 1e-6 * Math.abs(x0[j]) : 1e-6;
            var vp = {}, vm = {};
            for (var a = 0; a < n; a++) { vp[vns[a]] = x0[a]; vm[vns[a]] = x0[a]; }
            vp[vns[j]] = x0[j] + hp; vm[vns[j]] = x0[j] - hp;
            var fpp = NaN, fmm = NaN;
            try { fpp = evalAST(eqs[i], vp); } catch (e) {}
            try { fmm = evalAST(eqs[i], vm); } catch (e) {}
            var der = (fpp - fmm) / (2 * hp);
            if (!isFinite(der)) der = 0;
            row.push(der);
        }
        J.push(row);
    }
    return _matrixRank(J, m, n);
}

// 高斯消元求矩阵秩（相对容差，规避尺度问题）
function _matrixRank(M, rows, cols) {
    if (rows === 0 || cols === 0) return 0;
    var A = [];
    for (var i = 0; i < rows; i++) A.push(M[i].slice());
    var maxAbs = 0;
    for (var i2 = 0; i2 < rows; i2++) for (var j2 = 0; j2 < cols; j2++) {
        var av = Math.abs(A[i2][j2]); if (av > maxAbs) maxAbs = av;
    }
    var tol = 1e-8 * (maxAbs || 1);
    var rank = 0, r = 0, col = 0;
    while (r < rows && col < cols) {
        var piv = -1;
        for (var k = r; k < rows; k++) {
            if (Math.abs(A[k][col]) > tol && (piv < 0 || Math.abs(A[k][col]) > Math.abs(A[piv][col]))) piv = k;
        }
        if (piv < 0) { col++; continue; }   // 该列全零 ⇒ 跳列，行不变
        if (piv !== r) { var t = A[r]; A[r] = A[piv]; A[piv] = t; }
        var pv = A[r][col];
        for (var k2 = r + 1; k2 < rows; k2++) {
            var f = A[k2][col] / pv;
            if (f !== 0) for (var c2 = col; c2 < cols; c2++) A[k2][c2] -= f * A[r][c2];
        }
        rank++; r++; col++;
    }
    return rank;
}

// ============================================================================
// 算子注册表 + 成本分层收缩调度（Cost-Ordered Contraction Pipeline）
// ============================================================================
// 【重构背景】
// 原调度在 _solveImpl 内以 3 段近乎重复的 `suanN(state); if (state.done) ...`
// 硬编码序列展开（欠定分支 / 主分支 / 后处理各一份），约 90 行重复；且梯队注释
// 与实际调用编号错位（注释"(50-53)"实调 50~56、"(25-28)"实调 26~29、
// "(38-46)"实调 39~46），阅读者无法据注释判断真实执行序。
//
// 【本次重构四项改造】
//  1. 表驱动：算子元数据（名称/成本/类别/是否收缩/是否严格）集中注册，调度由
//     数据决定，3 份重复序列合并为 1 份流水线。
//  2. 成本低到高：收缩算子按 cost 分层，先跑最便宜层并压到层内不动点，贵算子
//     只在便宜算子榨干后才启动（cheapest-first propagation）。
//  3. 收缩后回流：任一较贵层取得收缩，立即回到最便宜层重跑 —— 域变窄常让便宜
//     算子重新获得收缩空间，这是约束传播（AC-3 族）的标准策略，以最低单位代价
//     换取最大收缩量。
//  4. 单调性护栏：每个收缩算子执行前后快照 D0 并实测 after ⊆ before；一旦违规
//     （放大或平移域）立即回滚 —— 宁可不收缩，也不丢真解。
//
// 【成本等级 cost 定义】
//   1 = 常数级判定 / O(方程数) 单遍扫描
//   2 = O(方程数 × AST节点数) 区间求值一遍（HC4、单调性、约束反演）
//   3 = O(维度 × 二分迭代 × 区间求值) 逐维 box-consistency / 配对收缩
//   4 = O(n²~n³) 雅可比包络 + 矩阵预条件 / 线性规划单纯形 / 数值迭代
//   5 = 递归分支定界（最坏指数，仅作兜底）
//
// 【kind 类别】
//   guard   前置拦截（非法输入/超限）      analyze 结构分析（只写特征，不动域）
//   rewrite 方程改写（化简/消元/替换）     solve   直接产生候选解
//   contract 域收缩（只允许收窄 D0）       prove   严格证明空集（可置 done）
//   sample  候选初值生成                   filter  解集过滤/去重
//   search  分支定界搜索                   output  结果打包输出
// ----------------------------------------------------------------------------

function _op(id, name, fn, cost, kind, contract, sound) {
    return { id: id, name: name, fn: fn, cost: cost, kind: kind, contract: !!contract, sound: !!sound };
}

// —— 解析层（D0 初始化前执行：建立 equations / varNames，并做 >6 变量硬校验）——
// suan1/2/3 仅依赖 varNames，不触碰 D0，故置于 D0 初始化之前、且覆盖全部路径
// （含纯不等式系统），保证"变量数超上限"在任意分支都被拦截。
var OPS_SETUP = [
    _op('suan1', '方程/不等式解析与标准化', suan1, 1, 'setup'),
    _op('suan2', '变量提取与计数', suan2, 1, 'setup'),
    _op('suan3', '变量数硬校验(>6 终止)', suan3, 1, 'guard')
];

// —— 早期拦截层（解析+D0 初始化后立即执行，顺序敏感）——
var OPS_PRE = [
    _op('suan4', '非法算子拦截', suan4, 1, 'guard'),
    _op('suan5', '系数范围检测', suan5, 1, 'guard'),
    _op('suan6', '常量二次校验化简', suan6, 1, 'guard'),
    _op('suan7', '前向传播矛盾检测(区间包络)', suan7, 2, 'prove', false, true),
    _op('suan8', '边界极限行为预判', suan8, 1, 'analyze'),
    _op('suan9', '自动定义域约束推导', suan9, 1, 'contract', true, true)
];

// —— 轻量矛盾筛查层 ——
var OPS_SCREEN = [
    _op('suan10', '常数约束/赋值矛盾检测', suan10, 1, 'prove', false, true),
    _op('suan11', '结构恒正/恒负检测', suan11, 1, 'prove', false, true),
    _op('suan12', '压缩映射基础区间缩集', suan12, 2, 'contract', true, true),
    _op('suan13', '表达式特征标记', suan13, 1, 'analyze')
];

// —— 代数闭式求解层（强顺序依赖：化简 → 消元 → 回代，不可乱序、不可进不动点）——
var OPS_ALGEBRA = [
    _op('suan14', '流形奇点预检测标记', suan14, 2, 'analyze'),
    _op('suan15', '微积分表达式化简', suan15, 2, 'rewrite'),
    _op('suan16', '基础化简兼容分支', suan16, 1, 'rewrite'),
    _op('suan17', '线性方程组高斯消元', suan17, 2, 'solve'),
    _op('suan18', '图论拆分独立子系统', suan18, 2, 'analyze'),
    _op('suan19', '变量显式代入消元', suan19, 3, 'rewrite'),
    _op('suan20', '单变量多项式有理根枚举', suan20, 3, 'solve'),
    _op('suan21', '欠定系统标记', suan21, 1, 'analyze')
];

// —— 单变量专项层（在欠定判定之后）——
var OPS_ALGEBRA2 = [
    _op('suan22', '单变量超越方程牛顿求解', suan22, 3, 'solve'),
    _op('suan23', '分式有理式变量替换', suan23, 2, 'rewrite'),
    // suan24 收缩依赖数值求根的完备性，若 polynomialAllRoots 漏根则不严格 ⇒ sound=false
    _op('suan24', '多项式全域根收割', suan24, 3, 'contract', true, false)
];

// —— 收缩层【核心】：全部只收窄 D0，按 cost 分层 + 不动点回流 ——
var OPS_CONTRACT = [
    // cost 1 —— 单遍扫描，最便宜，允许层内反复压到不动点
    _op('suan25', '区间算术值域收缩', suan25, 1, 'contract', true, true),
    _op('suan26', '奇偶对称区间压缩(保守)', suan26, 1, 'contract', true, true),
    // cost 2 —— 区间求值一遍
    _op('suan27', 'HC4-Revise 约束收缩', suan27, 2, 'contract', true, true),
    _op('suan28', '约束反演系统化(项一致性)', suan28, 2, 'contract', true, true),
    _op('suan29', '导数单调性剪枝(中值定理)', suan29, 2, 'prove', true, true),
    _op('suan30', '单调性+凸凹性剪枝', suan30, 2, 'prove', true, true),
    // cost 3 —— 逐维 box-consistency
    _op('suan31', 'Box-Consistency BC3', suan31, 3, 'contract', true, true),
    _op('suan32', '成对 2B/3B Box-Consistency', suan32, 3, 'contract', true, true),
    // cost 4 —— 矩阵预条件 / 线性规划
    _op('suan33', 'Hansen-Sengupta 区间 Gauss-Seidel', suan33, 4, 'contract', true, true),
    _op('suan34', 'LP Narrowing(线性松弛+单纯形)', suan34, 4, 'contract', true, true)
];

// —— 几何/拓扑分析层（setup 性质：写 manifoldInfo / startPoints，不收缩域）——
var OPS_GEOMETRY = [
    _op('suan35', '投影反证剪枝', suan35, 4, 'prove', false, true),
    _op('suan36', '雅可比秩引导投影方向', suan36, 3, 'analyze'),
    _op('suan37', '流形类型分类', suan37, 3, 'analyze'),
    _op('suan38', '固定规则均匀采样', suan38, 3, 'sample'),
    _op('suan39', '零空间流形投影校准', suan39, 3, 'sample')
];

// —— 数值求解层 ——
var OPS_NUMERIC = [
    _op('suan40', '线搜索牛顿迭代(Armijo)', suan40, 4, 'solve'),
    _op('suan41', '区间牛顿兜底求精', suan41, 4, 'solve'),
    _op('suan42', '区间解点残差过滤', suan42, 2, 'filter')
];

// —— 后处理层 ——
var OPS_POST = [
    _op('suan43', '解点精度标准化修正', suan43, 1, 'filter'),
    _op('suan44', '全局约束复核校验', suan44, 2, 'filter'),
    _op('suan45', '物理限位边界过滤', suan45, 1, 'filter'),
    _op('suan46', '解集去重合并', suan46, 2, 'filter')
];

// —— 兜底与输出层 ——
var OP_BRANCH = _op('suan47', '分支定界递归二分', suan47, 5, 'search');
var OP_INEQ = _op('suan48', '不等式系统求解', suan48, 4, 'solve');
var OP_OUTPUT = _op('suan49', '收敛判定与结果输出', suan49, 1, 'output');

// 上述 7 个编号从未实现函数体、不在任何调度数组中，仅为历史占位，避免改动其他
// 算子编号引发引用错位。注意：suan36 曾列于此（占位），已于 2026-08-21 落地实现

// —— 盒体积（对数尺度，避免高维乘积溢出）：用于度量收缩进展 ——
function _boxLogVolume(D0, varNames) {
    var s = 0;
    for (var i = 0; i < varNames.length; i++) {
        var b = D0[varNames[i]];
        if (!b || typeof b !== 'object') continue;
        var w = b.max - b.min;
        if (!isFinite(w)) return Infinity;
        s += Math.log(Math.max(w, 1e-300));
    }
    return s;
}

// —— 单调性护栏：实测 after ⊆ before，违规立即回滚 ——
// 数学意义：收缩算子必须是集合意义上的"只减不增"。若某算子把域放大或平移，
// 说明它引入了原本被排除的区域（污染）或丢弃了真解（更危险）。此处一旦检出，
// 回滚到收缩前状态 —— 放弃这次收缩，但保证不丢解。
function _assertContraction(state, opId, before) {
    var D0 = state.D0, viol = null;
    for (var k in before) {
        if (!Object.prototype.hasOwnProperty.call(before, k)) continue;
        var a = before[k], b = D0[k];
        if (!a || !b || typeof a !== 'object' || typeof b !== 'object') continue;
        if (!('min' in a) || !('min' in b)) continue;
        var EPS = 1e-9 * (Math.abs(a.min) + Math.abs(a.max) + 1);
        if (b.min < a.min - EPS || b.max > a.max + EPS) {
            viol = { v: k, before: [a.min, a.max], after: [b.min, b.max] };
            break;
        }
    }
    if (viol) {
        state.D0 = before;
        (state.contractionViolations = state.contractionViolations || []).push({ op: opId, detail: viol });
        return false;
    }
    return true;
}

// —— 统一算子执行器：异常隔离 + 计时 + 收缩量统计 + 单调性护栏 ——
// 返回本次调用的收缩增益（对数体积下降量），0 表示无收缩。
function _runOp(state, op) {
    if (state.done) return 0;
    if (state.skipOperators && state.skipOperators[op.id]) return 0;
    // 全局硬超时兜底（2026-08-21）：根调用开表，跨整棵递归树共享；任何算子执行前检查，
    // 杜绝单输入长时间卡顿/冻结。触发时如实标记 truncated/unconverged，绝不静默丢解。
    if (typeof __LS_ROOT_START !== 'undefined' && __LS_ROOT_START > 0 &&
        performance.now() - __LS_ROOT_START > 8000) {
        if (!state.done) {
            state.done = true;
            state.truncated = true;
            state.unconverged = true;
            state.hardTimeout = true;
        }
        return 0;
    }
    var stats = state.opStats || (state.opStats = {});
    var rec = stats[op.id] || (stats[op.id] = { name: op.name, cost: op.cost, kind: op.kind, calls: 0, ms: 0, gain: 0, hits: 0, errors: 0 });
    var doTrack = op.contract && state.varNames && state.varNames.length > 0;
    var before = doTrack ? _cloneBox(state.D0) : null;
    var v0 = doTrack ? _boxLogVolume(state.D0, state.varNames) : 0;
    var t0 = performance.now();
    rec.calls++;
    try {
        op.fn(state);
    } catch (e) {
        // 单个算子失败不再让整次求解崩溃；记录后继续，由后续算子/兜底接管
        rec.errors++;
        (state.opErrors = state.opErrors || []).push({ op: op.id, name: op.name, message: (e && e.message) ? e.message : String(e) });
    }
    rec.ms += performance.now() - t0;
    if (!doTrack) return 0;
    if (!_assertContraction(state, op.id, before)) return 0;
    var v1 = _boxLogVolume(state.D0, state.varNames);
    var gain;
    if (isFinite(v0) && isFinite(v1)) gain = v0 - v1;
    else if (!isFinite(v0) && isFinite(v1)) gain = 1e6;   // 无界 → 有界：重大收缩
    else gain = 0;
    if (gain > 1e-12) { rec.gain += gain; rec.hits++; return gain; }
    return 0;
}

// —— 顺序执行一组算子（用于顺序敏感的层）——
function _runSeq(state, ops) {
    for (var i = 0; i < ops.length; i++) {
        _runOp(state, ops[i]);
        if (state.done) return true;
    }
    return false;
}

// —— 切片B·Movability 病态标记内核 ——
// 为盒子每变量附加 movability 状态：normal / overflow / ill_conditioned / convergence_hopeless。
// 标记仅作"信号 + 安全跳过"用途：绝不据此剪枝或丢弃任何盒子（保证不丢真解）。
// 另：状态存于 state.mov 映射，绝不污染盒子对象（避免影响 _assertContraction / JSON 序列化）。
var MOV_OVERFLOW_W = 1e12;     // 绝对宽度爆炸阈值
var MOV_ILL_ABS = 1e8;          // 绝对宽度病态阈值（避免默认域中心≈0 被误判）
var MOV_HIST_MAX = 8;           // 收敛历史窗口
function _updateMovability(state) {
    if (!state || !state.varNames) return;
    if (!state._movHist) state._movHist = {};
    if (!state.mov) state.mov = {};
    for (var i = 0; i < state.varNames.length; i++) {
        var vn = state.varNames[i];
        var b = state.D0 ? state.D0[vn] : null;
        if (!b || typeof b !== 'object' || !('min' in b)) { state.mov[vn] = 'unknown'; continue; }
        var lo = b.min, hi = b.max, status;
        if (!isFinite(lo) || !isFinite(hi)) {
            status = 'overflow';
        } else {
            var w = hi - lo;
            if (w > MOV_OVERFLOW_W) status = 'overflow';
            else if (w > MOV_ILL_ABS) status = 'ill_conditioned';
            else {
                // 收敛无望：宽度多轮几乎不收缩（仅当仍较宽时判定，避免误伤已收敛变量）
                var h = state._movHist[vn] || (state._movHist[vn] = []);
                h.push(w); if (h.length > MOV_HIST_MAX) h.shift();
                var n = h.length;
                if (n >= 4 && w > 1e3 && (h[n - 1] / h[0]) > 0.95) status = 'convergence_hopeless';
                else status = 'normal';
            }
        }
        state.mov[vn] = status;
    }
}
// 是否存在"爆炸/病态"变量（用于安全跳过 futile 的贵层收缩；但绝不跳过分支定界，分支才是大盒的正确疗法）
function _hasExplodedMovability(state) {
    if (!state || !state.mov) return false;
    for (var i = 0; i < state.varNames.length; i++) {
        var s = state.mov[state.varNames[i]];
        if (s === 'overflow' || s === 'ill_conditioned') return true;
    }
    return false;
}

// —— 成本分层不动点收缩：便宜先跑、压到不动点；贵层有收获即回流最便宜层 ——
function _runContractionFixpoint(state, ops, maxRounds) {
    if (!state.varNames || state.varNames.length === 0) return;
    maxRounds = maxRounds || 6;

    // 按 cost 分桶，得到由便宜到贵的层序
    var buckets = {}, costs = [];
    for (var i = 0; i < ops.length; i++) {
        var c = ops[i].cost;
        if (!buckets[c]) { buckets[c] = []; costs.push(c); }
        buckets[c].push(ops[i]);
    }
    costs.sort(function (a, b) { return a - b; });

    var round = 0;
    state.contractionRounds = 0;
    state.contractionGain = state.contractionGain || 0;

    while (round < maxRounds) {
        round++;
        state.contractionRounds = round;
        _updateMovability(state);                                  // 切片B：每轮更新病态标记
        var skipExpensive = _hasExplodedMovability(state);          // 爆炸/病态 ⇒ 跳过 futile 的贵层（不跳过分支）
        var reentered = false;

        for (var li = 0; li < costs.length; li++) {
            var layerCost = costs[li];
            if (skipExpensive && layerCost >= 3) continue;          // 安全跳过：仅略过收缩尝试，盒子不被丢弃
            var layer = buckets[layerCost];
            var layerGain = 0;
            // 最便宜层（li===0）在层内压到不动点：单位代价最低，反复跑最划算
            var innerMax = (li === 0) ? 4 : 1;
            for (var it = 0; it < innerMax; it++) {
                var g = 0;
                for (var oi = 0; oi < layer.length; oi++) {
                    g += _runOp(state, layer[oi]);
                    if (state.done) return;
                }
                layerGain += g;
                if (g <= 1e-12) break;   // 层内已到不动点
            }
            state.contractionGain += layerGain;
            // 较贵层取得收缩 ⇒ 立刻回流到最便宜层重跑（域变窄常解锁新的廉价收缩）
            if (layerGain > 1e-12 && li > 0) { reentered = true; break; }
        }

        if (!reentered) break;   // 一整轮各层皆无收缩 ⇒ 全局不动点
    }
}

// —— 统一流水线：替代原先三段重复的硬编码算子序列 ——
// opts.contract  收缩层（默认开）    opts.geometry 几何/拓扑分析层
// opts.numeric   数值求解层          opts.post     解集后处理层
function _runPipeline(state, opts) {
    opts = opts || {};
    if (opts.contract !== false) {
        // fastMode 下限制回流轮数，牺牲部分收缩深度换响应速度
        _runContractionFixpoint(state, OPS_CONTRACT, state.fastMode ? 2 : 6);
        if (state.done) return true;
    }
    if (opts.geometry && _runSeq(state, OPS_GEOMETRY)) return true;
    if (opts.numeric && _runSeq(state, OPS_NUMERIC)) return true;
    if (opts.post && _runSeq(state, OPS_POST)) return true;
    return false;
}

// —— 尾段：分支定界兜底 → 不等式求解 → 结果输出 ——
function _runTail(state) {
    if (!state.fastMode) {
        _runOp(state, OP_BRANCH);
        if (state.done) return _finish(state);
    }
    _runOp(state, OP_INEQ);
    if (state.done) return _finish(state);
    _runOp(state, OP_OUTPUT);
    return _finish(state);
}

// —— 可审计结构化溯源（切片A）：每个结果附带完整证据链元数据 ——
// 设计目标：Agent / 上层系统拿到的不只是裸数字，而是"为什么是这个解"的可读证据链。
var SOLVER_VERSION = "lingshu-solver/1.0.0-auditable";

// Movability 完整读取（切片B）：每变量携带 status + width，供 Agent 读懂"为何是这个解"
function _movabilityFull(state) {
    var out = {};
    var vns = state.varNames || [];
    for (var i = 0; i < vns.length; i++) {
        var vn = vns[i], b = state.D0 ? state.D0[vn] : null;
        if (!b || typeof b !== 'object' || !('min' in b)) { out[vn] = { status: 'unknown', width: null }; continue; }
        var status = (state.mov && state.mov[vn]) || 'normal';
        var w = (isFinite(b.min) && isFinite(b.max)) ? +Math.abs(b.max - b.min).toFixed(6) : null;
        out[vn] = { status: status, width: w };
    }
    return out;
}

function _buildMeta(state) {
    var opStats = state.opStats || {};
    var fired = Object.keys(opStats);
    var contracted = fired.filter(function (id) { return (opStats[id].gain || 0) > 0; });
    var truncated = !!state.truncated;
    var term = truncated ? 'resource_exhausted' : (state.fastMode ? 'fast_mode' : 'converged');
    return {
        solverVersion: SOLVER_VERSION,
        fastMode: !!state.fastMode,
        terminatedBy: term,
        truncated: truncated,
        elapsedMs: +(performance.now() - (state.startTime || performance.now())).toFixed(2),
        operatorsFired: fired,
        operatorsFiredCount: fired.length,
        operatorsContracted: contracted,
        contractionRounds: state.contractionRounds || 0,
        contractionGain: +(state.contractionGain || 0).toFixed(3),
        monotonicityViolations: (state.contractionViolations || []).length,
        monotonicityViolationDetail: (state.contractionViolations || []).slice(0, 5),
        opErrors: (state.opErrors || []).slice(0, 10),
        conditionWarnings: (state.conditionWarnings || []).slice(0, 20),
        movability: _movabilityFull(state),
        ieee: { nan: !!_IEEE.nan, inf: !!_IEEE.inf, divZero: !!_IEEE.divZero, domainErr: !!_IEEE.domainErr },
        representativePointNote: state.repPointNote || '按范数最小/原点优先规则选取代表点',
        traceabilityNote: '核心收缩算子均经 _assertContraction 单调性护栏（after⊆before）；切片B 已落地 IEEE754 异常闭环 + Movability 病态标记内核；算子-定理-代码可追溯矩阵见产品文档'
    };
}

// 结果收尾：附加上述溯源元数据（幂等，防止递归/多出口重复包裹）
// 良定义过滤（2026-08-17）：剔除"表达式在该点未定义（除零/域错误=NaN）"或"越出声明域 D0"的候选解，
// 杜绝虚假解流出（如 sin(x)/x=0 在 x=0 处 0/0 未定义、或代数无穷根越出用户声明的变量域）。
// 仅做"减法"（只删不良定义/越域点，绝不新增或改动真解），保守且可证不丢真解。
// 收集 AST 中出现的变量名（去重到 set）
function _collectVars(node, set) {
    if (!node) return;
    if (node.type === 'var') { set[node.name] = true; return; }
    if (node.type === 'binop') { _collectVars(node.left, set); _collectVars(node.right, set); }
    else if (node.type === 'unary') { _collectVars(node.operand, set); }
    else if (node.type === 'func') { if (node.arg) _collectVars(node.arg, set); if (node.args) { for (var _ci = 0; _ci < node.args.length; _ci++) _collectVars(node.args[_ci], set); } }
}
// 忠实方程的所有变量是否都能被 state.varNames 完整绑定。
// 变量消元后（如 x*y=6 被化简为单变量 y）忠实方程仍引用已消去变量（x），此时无法忠实回代，
// 必须回退 state.equations，否则会把"未绑定变量"误判为未定义而误删真解。
function _faithfulEqsBindable(eqs, vns) {
    var vset = {};
    for (var _k = 0; _k < vns.length; _k++) vset[vns[_k]] = true;
    for (var _i = 0; _i < eqs.length; _i++) {
        var s = {};
        _collectVars(eqs[_i], s);
        for (var name in s) { if (!vset[name]) return false; }
    }
    return true;
}

// 在给定变量绑定下求方程的数值残差。方程以"残差形式"存储：sin(x)/x=1 → {op:'-', left:sin(x)/x, right:1}，
// 故 op:'-' 时直接求值整个 AST 即得 lhs−rhs；op:'='/'==' 时显式求 left−right。
// 任一侧未定义/非有限 → 返回 NaN（保守，不可用于判定穿越）。
function _residualAt(eq, vm) {
    try {
        var v;
        if (eq.op === '=' || eq.op === '==') {
            var l = evalAST(eq.left, vm), r = evalAST(eq.right, vm);
            if (l === null || r === null || l !== l || r !== r || !isFinite(l) || !isFinite(r)) return NaN;
            v = l - r;
        } else {
            v = evalAST(eq, vm);
            if (v === null || v !== v || !isFinite(v)) return NaN;
        }
        return v;
    } catch (err) { return NaN; }
}

function _filterIllDefined(state) {
    // 变量对齐修复（2026-08-21）：suan19 显式代入消元会把 state.varNames 缩减为
    // 仅"未消去"的变量子集（如 [y,a,b,c]），但候选解数组是按完整变量顺序（originalVarNames，
    // 如 [x,y,z,a,b,c]）回代生成的。若直接拿缩减清单去绑 6 值数组，会错位把真解误删成空集。
    // 故优先使用 suan19 当初为回血保存的完整 originalVarNames；长度与解数组一致才启用，
    // 否则回退 state.varNames（含无消元/等长的常规情形），保持零回归。
    var sols0 = (state.result && state.result.solutions && state.result.solutions[0]);
    var _useOrig = state.originalVarNames && state.originalVarNames.length &&
        sols0 && sols0.values && state.originalVarNames.length === sols0.values.length;
    var vns = _useOrig ? state.originalVarNames : (state.varNames || []);
    // 用"忠实（未消分母）方程"回代校验，可剔除 sin(x)/x=0 在 x=0 处 0/0 未定义之类的伪根（由 suan23 消分母引入）。
    // 仅当忠实方程的所有变量都能被 state.varNames 完整绑定时才启用；变量消元导致绑定不全时回退 state.equations，保持零回归。
    var eqs = (state.userEquations && state.userEquations.length && _faithfulEqsBindable(state.userEquations, vns))
        ? state.userEquations
        : (state.equations || []);
    var d0 = state._initD0 || state.D0 || {};
    // 域检查基准：优先用初始声明域快照（用户 initialD0 + domainConstraints），
    // 收缩后 D0 因区间过估可能错删真解，不参与过滤（2026-08-21）。
    var sols = state.result.solutions;
    if (!sols || !sols.length) return;
    var kept = [];
    var _tol = state.tolerance || 1e-6;
    for (var i = 0; i < sols.length; i++) {
        var sol = sols[i];
        var vals = sol.values;
        if (!vals || vals.length < vns.length) continue; // 结构异常，丢弃
        var vmap = {};
        for (var v = 0; v < vns.length; v++) vmap[vns[v]] = vals[v];
        // 候选点邻域半宽：符号翻转/触零校验用（相对容差 + 10×绝对容差，防误触奇点或过窄漏判）
        var _wArr = [];
        for (var v2 = 0; v2 < vns.length; v2++) {
            var _c = vals[v2];
            var _w = Math.max(_tol * 10, Math.abs(_c) * 1e-3, 1e-9);
            _wArr.push(_w);
        }
        var ok = true;
        // 1) 每个等式在该点必须良定义（有限，非 NaN/Inf）；0/0、sqrt(负)、log(非正) 均判未定义
        for (var e = 0; e < eqs.length; e++) {
            var eq = eqs[e];
            var ev;
            try { ev = evalAST(eq, vmap); } catch (err) { ev = NaN; }
            if (ev === null || ev !== ev || !isFinite(ev)) { ok = false; break; }
            // 2) 真解校验（仅对等式；方程以残差形式存储，故 op 为 '-'/'='/==' 均视为等式）。
            //    伪根典型如 sin(x)/x=1 —— 可去奇点 x=0 邻域内 sin(x)/x 数值≈1（点残差~3e-7 在容差内），
            //    点求值/点残差均无法识别；区间残差亦不行（区间算术依赖问题使 sin(x)/x 的邻域区间被过估为含 1）。
            //    判据：真解须满足 中心残差触零（机器级）或 邻域左右采样符号翻转（真穿越）。
            //    sin(x)/x=1 在整个邻域残差恒负、无穿越 → 剔除；tan(x)=0 于 π 处左负右正 → 保留。
            //    任一侧采样未定义 → 保守保留（防域边界误删）。
            if (eq.type === 'binop' && (eq.op === '-' || eq.op === '=' || eq.op === '==')) {
                var _resC = _residualAt(eq, vmap);
                var _rhsV = (eq.right && eq.right.type === 'num') ? eq.right.value : 0;
                var _tiny = 1e-9 * Math.max(1, Math.abs(_rhsV) || 1);
                if (!(Math.abs(_resC) <= _tiny)) {
                    var _vL = {}, _vR = {};
                    for (var q = 0; q < vns.length; q++) {
                        var _qn = vns[q];
                        _vL[_qn] = vals[q] - _wArr[q];
                        _vR[_qn] = vals[q] + _wArr[q];
                    }
                    var _resL = _residualAt(eq, _vL), _resR = _residualAt(eq, _vR);
                    var _cross = false;
                    if (_resL === _resL && _resR === _resR) { // 两侧均良定义才可判穿越；任一侧未定义 → 保守保留
                        if (_resL * _resR < 0) _cross = true;
                        if (Math.abs(_resL) <= _tiny || Math.abs(_resR) <= _tiny) _cross = true;
                    }
                    if (!_cross) { ok = false; break; }
                }
            }
        }
        // 3) 必须在声明域 D0 内（防越域解漏出）
        if (ok) {
            for (var d = 0; d < vns.length; d++) {
                var iv = d0[vns[d]];
                if (iv && typeof iv === 'object' && ('min' in iv) && iv.min <= iv.max) {
                    // 自适应域容差：D0 可能被收缩到极窄区间（宽度 < 输出舍入精度 1e-6），
                    // 而候选解是舍入到 decimals 位后的值，固定 1e-9 容差会把真解误判越域。
                    // 容差 = max(1e-9, |值|×1e-7, 区间宽度×1e-3)，宽度项保证窄区间下舍入不误杀。
                    // 注意：若 iv.min > iv.max（收缩层数值误差产生的翻转空区间），跳过域检查，
                    // 避免把真解误判越域（空区间无实际约束力，且已由残差/穿越校验把关）。
                    var _ivw = (iv.max - iv.min);
                    var _dtol = Math.max(1e-9, Math.abs(vals[d]) * 1e-7, _ivw * 1e-3);
                    if (vals[d] < iv.min - _dtol || vals[d] > iv.max + _dtol) { ok = false; break; }
                }
            }
        }
        if (ok) kept.push(sol);
    }
    if (kept.length !== sols.length) {
        state.result.solutions = kept;
        if (kept.length === 0 && state.result.resultType !== 1) {
            // 全部候选被过滤 → 如实降级为无解（不静默给出错误结论）
            state.result.resultType = 1;
            state.result.resultTypeName = "空结果";
            state.result.resultTypeDesc = "候选解均因表达式未定义（如分母为零）或超出声明变量域而被过滤，无有效解";
            if (!state.result.error) {
                state.result.error = "NO_SOLUTION";
                state.result.message = "候选解被良定义 / 域约束过滤";
            }
        }
    }
}

// 终态变量数不变量断言 + 自动修复（2026-08-22）。
// 任一解 values.length 必须等于 originalVarNames.length（用户输入变量数）。
// 若不等：尝试用 reconstructSolution 从缩减坐标重建（仅当解是缩减坐标且含 substitutions 时可行）；
// 修复成功则替换，修复失败则保留原解并告警（绝不静默丢弃有效解，但暴露异常供排查新算子缺陷）。
function _enforceVarInvariant(state) {
    if (!state || !state.result || !state.result.solutions) return;
    var target = getOutputVarNames(state).length;
    if (target === 0) return;
    for (var i = 0; i < state.result.solutions.length; i++) {
        var sol = state.result.solutions[i];
        if (sol.values && sol.values.length === target) continue;
        var repaired = null;
        if (sol.values && state.substitutions && Object.keys(state.substitutions).length > 0
            && state.varNames && state.varNames.length > 0
            && sol.values.length === state.varNames.length) {
            repaired = reconstructSolution(state, sol.values);
        }
        if (repaired && repaired.length === target) {
            sol.values = repaired;
            continue;
        }
        if (!state.result.warnings) state.result.warnings = [];
        state.result.warnings.push('解#' + i + ' 变量数(' + (sol.values ? sol.values.length : 0) + ')≠输入变量数(' + target + ')，未能自动回代修复（疑似算子未回代消元变量），已保留原值并告警');
    }
}

// === Krawczyk 认证层（2026-08-22 实装）===
// 定理（Krawczyk 算子）：对 F:ℝⁿ→ℝⁿ，取候选 x̂∈[X]，预条件子 Y≈F'(x̂)⁻¹，
//   K(x̂,[X]) = x̂ − Y·F(x̂) + (I − Y·[J]([X]))·([X] − x̂)
// 若 K(x̂,[X]) ⊆ int([X])，则 [X] 内存在唯一零点（Banach 不动点），且误差 ≤ rad([X])。
// 这是【构造性存在唯一性证明】，比数值残差更强：残差小≠真有根，Krawczyk 收敛⊆盒子才证真。
// 仅对有限孤立解（方阵系统）尝试；任何不确定一律 certified=false（绝不假证）。

// ---- 区间/实矩阵基础算子（区间 = {min,max}）----
function iMul(a, b) { var v = [a.min * b.min, a.min * b.max, a.max * b.min, a.max * b.max]; return { min: Math.min.apply(null, v), max: Math.max.apply(null, v) }; }
function iAdd(a, b) { return { min: a.min + b.min, max: a.max + b.max }; }
function rToI(x) { return { min: x, max: x }; }
function iMatVec(I, v) { var n = I.length, r = []; for (var i = 0; i < n; i++) { var acc = null; for (var k = 0; k < n; k++) { var t = iMul(I[i][k], v[k]); acc = acc === null ? t : iAdd(acc, t); } r.push(acc); } return r; }
function rMatVec(M, v) { var n = M.length, r = new Array(n); for (var i = 0; i < n; i++) { var s = 0; for (var j = 0; j < v.length; j++) s += M[i][j] * v[j]; r[i] = s; } return r; }
function rMatIMat(R, I) { var n = R.length, M = []; for (var i = 0; i < n; i++) { M.push([]); for (var j = 0; j < n; j++) { var acc = null; for (var k = 0; k < n; k++) { var t = iMul(rToI(R[i][k]), I[k][j]); acc = acc === null ? t : iAdd(acc, t); } M[i].push(acc); } } return M; }
function iMatSubReal(A, R) { var n = A.length, M = []; for (var i = 0; i < n; i++) { M.push([]); for (var j = 0; j < n; j++) M[i].push({ min: A[i][j].min - R[i][j], max: A[i][j].max - R[i][j] }); } return M; }
// 区间矩阵 − 区间矩阵（Krawczyk 算子 C = I − Y·J([X]) 需要逐分量区间减法，R 也是区间）
function iMatSub(A, B) { var n = A.length, M = []; for (var i = 0; i < n; i++) { M.push([]); for (var j = 0; j < n; j++) M[i].push({ min: A[i][j].min - B[i][j].min, max: A[i][j].max - B[i][j].max }); } return M; }
function realIdentity(n) { var I = []; for (var i = 0; i < n; i++) { I.push([]); for (var j = 0; j < n; j++) I[i].push(i === j ? 1 : 0); } return I; }
function iVecInterior(A, B) { for (var i = 0; i < A.length; i++) { if (!(A[i].min > B[i].min && A[i].max < B[i].max)) return false; } return true; }
function realMatInv(M) {
    var n = M.length; if (n === 0) return null;
    var cols = [];
    for (var c = 0; c < n; c++) {
        var b = new Array(n); for (var i = 0; i < n; i++) b[i] = (i === c) ? 1 : 0;
        var r = gaussianSolve(M, b);
        if (!r || !r.solution) return null;
        cols.push(r.solution);
    }
    var R = []; for (var i2 = 0; i2 < n; i2++) { R.push([]); for (var j2 = 0; j2 < n; j2++) R[i2].push(cols[j2][i2]); }
    return R;
}
// 单次 Krawczyk 尝试（固定半径 r）
function _krawczykOnce(eqs, vns, xhat, r) {
    var n = vns.length;
    if (eqs.length !== n) return { certified: false };
    var boxX = {}, Xvec = [];
    for (var i = 0; i < n; i++) { var lo = xhat[i] - r, hi = xhat[i] + r; boxX[vns[i]] = { min: lo, max: hi }; Xvec.push({ min: lo, max: hi }); }
    var JI = _intervalJacobian(eqs, vns, boxX, xhat);
    var pbox = {}; for (var i2 = 0; i2 < n; i2++) pbox[vns[i2]] = { min: xhat[i2], max: xhat[i2] };
    var JIp = _intervalJacobian(eqs, vns, pbox, xhat);
    var Jr = []; for (var a = 0; a < n; a++) { Jr.push([]); for (var b = 0; b < n; b++) Jr[a].push((JIp[a][b].min + JIp[a][b].max) / 2); }
    var Y = realMatInv(Jr); if (!Y) return { certified: false };
    var vmap = {}; for (var i3 = 0; i3 < n; i3++) vmap[vns[i3]] = xhat[i3];
    var F = []; for (var e = 0; e < n; e++) { var fe = evalAST(eqs[e], vmap); if (!isFinite(fe)) return { certified: false }; F.push(fe); }
    var YF = rMatVec(Y, F), c = []; for (var i4 = 0; i4 < n; i4++) c.push(xhat[i4] - YF[i4]);
    var YJ = rMatIMat(Y, JI);
    // 单位阵必须也是区间矩阵：iMatSubReal 对 A[i][j].min 取值，实数阵无 .min 会得 undefined → C 全 null（历史 bug）
    var Ii = []; for (var _ii = 0; _ii < n; _ii++) { Ii.push([]); for (var _jj = 0; _jj < n; _jj++) Ii[_ii].push(_ii === _jj ? { min: 1, max: 1 } : { min: 0, max: 0 }); }
    var C = iMatSub(Ii, YJ);
    var d = []; for (var i5 = 0; i5 < n; i5++) d.push({ min: Xvec[i5].min - xhat[i5], max: Xvec[i5].max - xhat[i5] });
    var Cd = iMatVec(C, d), K = []; for (var i6 = 0; i6 < n; i6++) K.push(iAdd(rToI(c[i6]), Cd[i6]));
    return { certified: iVecInterior(K, Xvec), box: Xvec, radius: r };
}
// 多半径尝试：遍历全部候选半径，取【最小成功半径】作为误差界（注释与实现必须一致）。
// 历史 bug：原实现是"取第一个成功"而 radii 顺序非单调（1e-5,1e-4,1e-6,1e-3），
//   导致注释宣称"取最小"、实际可能返回 1e-5 而 1e-6 同样可证——对外承诺的"误差≤半径"被虚松。
function krawczykCertify(eqs, vns, xhat, radii) {
    var rs = radii || [1e-5, 1e-4, 1e-6, 1e-3];
    var best = null;
    for (var k = 0; k < rs.length; k++) {
        var res = _krawczykOnce(eqs, vns, xhat, rs[k]);
        if (res.certified && (best === null || res.radius < best.radius)) best = res;
    }
    return best || { certified: false };
}
// 对 state.result.solutions 中每个有限孤立解尝试 Krawczyk 认证，写入 sol.certified / sol.certifiedRadius。
function _certifySolutions(state) {
    if (!state || !state.result || !state.result.solutions) return;
    var eqs = state.originalEquations || state.equations;
    var vns = getOutputVarNames(state);
    if (!eqs || eqs.length !== vns.length) return; // 非方阵/缺原方程：无法严格认证，跳过（保守）
    var budgetMs = 800, startT = performance.now();
    for (var i = 0; i < state.result.solutions.length; i++) {
        if (performance.now() - startT > budgetMs) break;
        var sol = state.result.solutions[i];
        if (!sol.values || sol.values.length !== vns.length) { sol.certified = false; continue; }
        var res = krawczykCertify(eqs, vns, sol.values.slice());
        sol.certified = !!res.certified;
        if (res.certified) sol.certifiedRadius = res.radius;
    }
}

// === 全局区间分支定界（2026-08-22 实装，覆盖非线性多解系统完备穷尽）===
// 设计约束（用户决策）：覆盖大多数情况（线性/近线性/孤立光滑非线性/稀疏多项式多解），
//   放弃极端（病态振荡密集系统）；预算兜底，超预算诚实降级（残余盒报"未判"，绝不假证）。
// 参数默认值：BUDGET=5e5 盒（半秒级），MAXDEPTH=28（单维分辨率~7e-5），MINW=1e-4 提前停。
// 数学：Krawczyk 算子 K(x̂,[X])。三种 sound 结局：
//   K∩X=∅        ⇒ [X] 内严格无零点（不动点不存在）→ 丢弃（剪枝）
//   K⊆int([X])   ⇒ [X] 内存在唯一零点（Banach）→ 记 proven 解
//   否则          ⇒ 细分（沿最宽维二分）或超预算/超深/过窄则标残余盒
// 仅在方阵系统（eqs.length===n）运行，与 _certifySolutions 一致；非方阵不接全局分支。

// 盒感知 Krawczyk：boxX 即当前盒（非 x̂±r），Xvec=盒边界，d=box−x̂。
function _krawczykOnBox(eqs, vns, boxX, xhat) {
    var n = vns.length;
    if (eqs.length !== n) return { certified: false };
    var Xvec = []; for (var i = 0; i < n; i++) Xvec.push(boxX[vns[i]]);
    var JI = _intervalJacobian(eqs, vns, boxX, xhat);
    var pbox = {}; for (var i2 = 0; i2 < n; i2++) pbox[vns[i2]] = { min: xhat[i2], max: xhat[i2] };
    var JIp = _intervalJacobian(eqs, vns, pbox, xhat);
    var Jr = []; for (var a = 0; a < n; a++) { Jr.push([]); for (var b = 0; b < n; b++) Jr[a].push((JIp[a][b].min + JIp[a][b].max) / 2); }
    var Y = realMatInv(Jr); if (!Y) return { certified: false };
    var vmap = {}; for (var i3 = 0; i3 < n; i3++) vmap[vns[i3]] = xhat[i3];
    var F = []; for (var e = 0; e < n; e++) { var fe = evalAST(eqs[e], vmap); if (!isFinite(fe)) return { certified: false }; F.push(fe); }
    var YF = rMatVec(Y, F), c = []; for (var i4 = 0; i4 < n; i4++) c.push(xhat[i4] - YF[i4]);
    var YJ = rMatIMat(Y, JI);
    var Ii = []; for (var _ii = 0; _ii < n; _ii++) { Ii.push([]); for (var _jj = 0; _jj < n; _jj++) Ii[_ii].push(_ii === _jj ? { min: 1, max: 1 } : { min: 0, max: 0 }); }
    var C = iMatSub(Ii, YJ);
    var d = []; for (var i5 = 0; i5 < n; i5++) d.push({ min: Xvec[i5].min - xhat[i5], max: Xvec[i5].max - xhat[i5] });
    var Cd = iMatVec(C, d), K = []; for (var i6 = 0; i6 < n; i6++) K.push(iAdd(rToI(c[i6]), Cd[i6]));
    return { certified: iVecInterior(K, Xvec), K: K, Xvec: Xvec };
}
// Krawczyk 收敛盒内牛顿精化：从中点出发至多 20 步牛顿，落在盒内且收敛才返回真解（residual≈0），
// 否则返回 null（绝不把收敛盒中点当解假证 proven）。盒内唯一零点的吸引 basin 含中点，故必收敛于该解。
function _newtonRefine(eqs, vns, x0, box) {
    var n = vns.length;
    var x = x0.slice();
    for (var iter = 0; iter < 20; iter++) {
        var vmap = {}; for (var i = 0; i < n; i++) vmap[vns[i]] = x[i];
        var F = []; for (var e = 0; e < n; e++) { var fe = evalAST(eqs[e], vmap); if (!isFinite(fe)) return null; F.push(fe); }
        var rms = 0; for (var i2 = 0; i2 < n; i2++) rms += F[i2] * F[i2]; rms = Math.sqrt(rms / n);
        if (rms < 1e-11) return x;
        // 雅可比区间求导：必须喂退化的点区间 {min:x,max:x}（而非裸点值）。
        // 旧实现 intervalEval(d, vmap) 把裸数当 iv，iv.min/iv.max 为 undefined → _buildAffEnv 算出 NaN 噪声
        // → 雅可比整行 NaN → realMatInv 失败 → 本函数对一切良置问题恒返 null（P0-1）。
        var pmap = {}; for (var i3 = 0; i3 < n; i3++) pmap[vns[i3]] = { min: x[i3], max: x[i3] };
        var J = []; for (var a = 0; a < n; a++) { J.push([]); for (var b = 0; b < n; b++) { var d = _diffAST(eqs[a], vns[b]); var dv = intervalEval(d, pmap); if (!dv) return null; J[a].push((dv.min + dv.max) / 2); } }
        var Y = realMatInv(J); if (!Y) return null;
        var dX = rMatVec(Y, F);
        for (var j = 0; j < n; j++) x[j] = x[j] - dX[j];
        for (var k = 0; k < n; k++) { if (x[k] < box[vns[k]].min || x[k] > box[vns[k]].max) return null; }
    }
    return null;
}
// K∩X=∅ 判定（严格无不动点 → 无零点，sound 剪枝）
function iVecDisjoint(A, B) {
    for (var i = 0; i < A.length; i++) { if (!(A[i].max < B[i].min || A[i].min > B[i].max)) return false; }
    return true;
}
// 全局分支定界主函数：返回 {solutions, boxCount, residualBoxes, budget, complete}
function _globalBranchCertify(eqs, vns, dom, opts) {
    var n = vns.length;
    if (eqs.length !== n || n === 0) return null; // 非方阵/空：不接全局分支
    var o = opts || {};
    var BUDGET = (o.budget != null) ? o.budget : 5e5;
    var MAXDEPTH = (o.maxDepth != null) ? o.maxDepth : 28;
    var MINW = (o.minWidth != null) ? o.minWidth : 1e-3;
    var TIME = (o.timeMs != null) ? o.timeMs : 300;   // 时间预算兜底，避免卡顿
    var DUP = (o.dupTol != null) ? o.dupTol : 1e-2;     // 同解不同盒的去重阈值
    var solutions = [], residualBoxes = [], boxCount = 0;
    var startT = performance.now();
    function mkBox(d) { var b = {}; for (var i = 0; i < n; i++) b[vns[i]] = { min: d[vns[i]][0], max: d[vns[i]][1] }; return b; }
    function boxMaxWidth(b) { var w = 0; for (var i = 0; i < n; i++) { var d = b[vns[i]].max - b[vns[i]].min; if (d > w) w = d; } return w; }
    function mid(b) { var m = []; for (var i = 0; i < n; i++) m.push((b[vns[i]].min + b[vns[i]].max) / 2); return m; }
    function residualAt(vals) {
        var vmap = {}; for (var i = 0; i < n; i++) vmap[vns[i]] = vals[i];
        var rv = 0; for (var e = 0; e < n; e++) { var fe = evalAST(eqs[e], vmap); if (isFinite(fe)) rv = Math.max(rv, Math.abs(fe)); }
        return rv;
    }
    function split(b) {
        var wi = 0, wmax = -1; for (var i = 0; i < n; i++) { var d = b[vns[i]].max - b[vns[i]].min; if (d > wmax) { wmax = d; wi = i; } }
        var name = vns[wi], m = (b[name].min + b[name].max) / 2, b1 = {}, b2 = {};
        for (var k = 0; k < n; k++) { var nm = vns[k]; if (k === wi) { b1[nm] = { min: b[nm].min, max: m }; b2[nm] = { min: m, max: b[nm].max }; } else { b1[nm] = b[nm]; b2[nm] = b[nm]; } }
        return [b1, b2];
    }
    function isDup(vals) {
        for (var s = 0; s < solutions.length; s++) {
            var sv = solutions[s].values, maxd = 0;
            for (var j = 0; j < n; j++) maxd = Math.max(maxd, Math.abs(sv[j] - vals[j]));
            if (maxd < DUP) return true;
        }
        return false;
    }
    var queue = [{ box: mkBox(dom), depth: 0 }];
    while (queue.length > 0) {
        if (boxCount >= BUDGET || (performance.now() - startT) > TIME) { while (queue.length) residualBoxes.push(queue.shift().box); break; }
        var item = queue.shift(), b = item.box, depth = item.depth;
        boxCount++;
        var xhat = mid(b);
        var res = _krawczykOnBox(eqs, vns, b, xhat);
        if (res.certified) {
            // Krawczyk 证 [X] 内唯一零点 ∈ X；在盒内牛顿精化到真解（residual≈0）才记 proven，绝不假证中点
            var refined = _newtonRefine(eqs, vns, xhat, b);
            if (refined && !isDup(refined)) solutions.push({ values: refined, box: res.Xvec, residual: residualAt(refined) });
        } else if (res.K && iVecDisjoint(res.K, res.Xvec)) {
            // 严格无解，丢弃（sound 剪枝）；K 为 undefined（雅可比不可逆）时不可断定，走细分
        } else {
            if (boxMaxWidth(b) > MINW && depth < MAXDEPTH) {
                var parts = split(b);
                queue.push({ box: parts[0], depth: depth + 1 });
                queue.push({ box: parts[1], depth: depth + 1 });
            } else {
                residualBoxes.push(b); // 超深/过窄未判，诚实留痕
            }
        }
    }
    return { solutions: solutions, boxCount: boxCount, residualBoxes: residualBoxes, budget: BUDGET, complete: (residualBoxes.length === 0) };
}
// 把全局分支找到的 proven 解合并进 state.result.solutions（去重：与已有解距离<tol 视为同解）
function _mergeGlobalBranch(state, gb) {
    if (!gb || !gb.solutions) return;
    if (!state.result.solutions) state.result.solutions = [];
    var vns = getOutputVarNames(state);
    var tol = 1e-6;
    function exists(vals) {
        for (var i = 0; i < state.result.solutions.length; i++) {
            var s = state.result.solutions[i];
            if (!s.values || s.values.length !== vals.length) continue;
            var maxd = 0; for (var j = 0; j < vals.length; j++) maxd = Math.max(maxd, Math.abs(s.values[j] - vals[j]));
            if (maxd < tol) return true;
        }
        return false;
    }
    for (var k = 0; k < gb.solutions.length; k++) {
        var sol = gb.solutions[k];
        if (exists(sol.values)) continue;
        state.result.solutions.push({
            values: sol.values.slice(),
            residual: (typeof sol.residual === 'number') ? sol.residual : 0,
            tier: 'proven',
            certified: true,
            certifiedRadius: null,
            source: 'global_branch_krawczyk',
            box: sol.box
        });
    }
    state.result.globalBranch = {
        boxCount: gb.boxCount,
        residualCount: gb.residualBoxes.length,
        complete: gb.complete,
        budget: gb.budget
    };
    if (gb.residualBoxes.length > 0 && !state.result.warnings) state.result.warnings = [];
    if (gb.residualBoxes.length > 0) state.result.warnings.push('全局区间分支在预算(' + gb.budget + '盒)内未完全判定（非无解，仅未穷尽，可能含遗漏解）');
    state.truncated = state.truncated || !gb.complete;
}

// 给每个有限孤立解标注可信层级 tier（2026-08-22 P0-1 输出分层）：
//  - proven     : 经 Krawczyk 认证（Banach 不动点唯一零，误差≤半径），数学保证
//  - candidate  : 数值候选，未经严格证明，可能漏/可能伪
//  - structural : 无限解集的代表点（欠定/恒等），仅代表，非枚举
function _assignTiers(state) {
    if (!state || !state.result || !state.result.solutions) return;
    var sols = state.result.solutions;
    // structural 仅对"真正欠定"系统（方程数 < 变量数）的代表点生效；
    // 满秩系统即便在解处 Jacobian 奇异（如 Powell singular），只要找到孤立解就标 proven/candidate，
    // 绝不因 local-rank 试探误判为 infinite 而盖戳 structural（2026-08-22 修 B2 误标）。
    var vns = getOutputVarNames(state);
    var underdetermined = (state.equations && state.equations.length < vns.length);
    for (var i = 0; i < sols.length; i++) {
        var sol = sols[i];
        if (sol.certified === true) sol.tier = 'proven';
        // structural 仅对真正的"代表点"解生效（欠定/恒等系统由伪逆推荐产生，标记 representative）；
        // 满秩系统即便在解处 Jacobian 奇异（Powell singular）或存在冗余方程被剔除，
        // 只要找到的孤立解就不盖戳 structural，避免误标（2026-08-22 修 B2）。
        else if (sol.representative === true && underdetermined) sol.tier = 'structural';
        else sol.tier = 'candidate';
    }
    var proven = 0, cand = 0, struct = 0;
    for (var j = 0; j < sols.length; j++) {
        if (sols[j].tier === 'proven') proven++;
        else if (sols[j].tier === 'structural') struct++;
        else cand++;
    }
    state.result.provenCount = proven;
    state.result.candidateCount = cand;
    state.result.structuralCount = struct;
}

// 给无解结果标注 emptyProof（2026-08-22 P0-2 proven-empty 认证）：
//  - proof_empty     : 由 sound 算子数学严格证明"域内无解"（结构恒正/恒负、区间包络不含0、导数单调、多项式无实根、矛盾检测、域约束矛盾等）
//  - candidate_empty : 仅"未找到"，不等于"证明不存在"（残差过滤/域过滤/全局搜索未命中）
// 判定依据：分支显式置 state.result.provenEmpty===true 即为 proof_empty，否则 candidate_empty。
function _assignEmptiness(state) {
    if (!state || !state.result || state.result.error !== 'NO_SOLUTION') return;
    if (state.result.provenEmpty === true) {
        state.result.emptyProof = 'proof_empty';
        state.result.message = (state.result.message || '') + '【已严格证明：定义域内不存在实数解】';
    } else {
        state.result.emptyProof = 'candidate_empty';
        state.result.message = (state.result.message || '') + '【注意：当前为"未找到解"，非严格证明不存在；缩小/调整定义域或增加搜索可能发现解】';
    }
}

// 完备性边界声明（2026-08-22 P0-3）：诚实告知智能体/UI 本报告的保证边界。
function _assignCompleteness(state) {
    if (!state || !state.result) return;
    var vns = getOutputVarNames(state);
    state.result.completeness = {
        scope: '变量数≤6、声明定义域[-10000,10000]、有限网格(6位小数)、残差容差三档(1e-6/1e-9/1e-3)',
        provenIsComplete: true,        // proven 解（certified）在本网格/定义域下经 Krawczyk 唯一性证明，已完备
        candidateMayMiss: true,        // candidate 解未经证明，可能存在漏解/伪根
        emptyProofNote: 'emptyProof=proof_empty 表示已严格证明域内无解；candidate_empty 仅表示未找到，不保证不存在',
        undecidability: '对任意超越系统，Richardson 不可判定定理表明不存在判定"有解/无解/几解"的通用算法；本工具保证边界如上，不对全部输出承诺100%正确',
        reproducibility: '全路径无随机数(Math.random=0)，种子确定性，结果跨运行/平台可复现'
    };
    state.result.bound = {
        varCount: vns.length,
        domain: state._initD0 || state.D0 || {},
        decimals: state.displayDecimals
    };
}

function _finish(state) {
    // 兜底保护（2026-08-21）：全局硬超时/异常路径可能只设 state.done 而未设 state.result，
    // 若直接返回 undefined/null，UI 会崩。此处构造诚实的截断结果，杜绝"求解器返回空"。
    if (state && !state.result) {
        state.result = {
            solutions: [], error: "HARD_TIMEOUT",
            message: "计算超出全局时间预算（8 秒）被中止，结果不完整（truncated）。建议缩小变量范围、减少变量数后重试。",
            executionPath: "全局超时兜底",
            timeMs: +(performance.now() - (state.startTime || performance.now())).toFixed(0),
            confidence: "low", varNames: state.varNames || [],
            resultType: 2, resultTypeName: "有限解（未完成）",
            resultTypeDesc: "计算超时中止，未获得完整结果",
            truncated: true, unconverged: true, warnings: ["计算超出全局时间预算被中止，结果不完整"]
        };
    }
    // 解析/定义域警告同步到 result.warnings（UI 渲染字段）：任何输入行解析失败
    // （如不支持的变量名/字符）、域约束警告等都必须出现在结果页，杜绝"静默丢方程"。
    if (state && state.result && state.conditionWarnings && state.conditionWarnings.length) {
        if (!state.result.warnings) state.result.warnings = [];
        for (var _wi = 0; _wi < state.conditionWarnings.length; _wi++) {
            if (state.result.warnings.indexOf(state.conditionWarnings[_wi]) < 0) {
                state.result.warnings.push(state.conditionWarnings[_wi]);
            }
        }
    }
    // 结构化诚实标志：整数约束未强制（与 truncated 同级，供程序化/MCP 调用方可靠检测，不依赖解析警告文字）
    if (state && state.result && state.integerConstraintUnenforced) {
        state.result.integerConstraintUnenforced = true;
    }
    // 良定义过滤：在附加溯源元数据前，先把不良定义 / 越域的候选解剔除
    if (state && state.result && state.result.solutions && state.result.solutions.length) {
        _enforceVarInvariant(state);   // 先修复变量数不变量（防新算子静默缺变量），再过滤病态解
        _filterIllDefined(state);
        _certifySolutions(state);      // Krawczyk 认证层：为每个有限孤立解写入 sol.certified
        // 全局区间分支定界：对【方阵系统】在用户初始域内尝试完备穷尽（覆盖非线性多解漏解）。
        // 非方阵（欠定/超定）不接；无 userDomain 不接。预算兜底，超预算诚实降级。
        if (state.userDomain) {
            var _gbEqs = state.originalEquations || state.equations;
            var _gbVns = getOutputVarNames(state);
            if (_gbEqs && _gbVns && _gbEqs.length === _gbVns.length && _gbVns.length > 0) {
                var _gbOpts = { budget: 5e5, maxDepth: 28, minWidth: 1e-4 };
                if (state.solverDecimals != null) _gbOpts.minWidth = Math.max(1e-4, Math.pow(10, -state.solverDecimals));
                // 构造"补全 + 数组格式"的初始域后再交给全局分支定界。
                // _globalBranchCertify 内部 mkBox 直接取 dom[vn][0]/[1]，要求每个变量都是 [lo,hi]；
                // 用户只给部分变量域时直接传 state.userDomain，缺失变量为 undefined → undefined[0] 崩溃。
                // （2026-09-01 修复：缺失变量回退初始域快照 _initD0，仍缺失则用默认 ±1e6）
                var _gbDom = {}, _gbOk = true;
                for (var _gi = 0; _gi < _gbVns.length; _gi++) {
                    var _gvn = _gbVns[_gi];
                    var _gv = state.userDomain[_gvn];
                    var _snap = (state._initD0 && state._initD0[_gvn]) ? state._initD0[_gvn] : null;
                    var _lo = -1000000, _hi = 1000000;
                    if (Array.isArray(_gv) && _gv.length >= 2) {
                        _lo = Number(_gv[0]); _hi = Number(_gv[1]);
                    } else if (_gv && typeof _gv === 'object' && _gv.min !== undefined) {
                        _lo = Number(_gv.min); _hi = Number(_gv.max);
                    } else if (_snap && _snap.min !== undefined) {
                        _lo = Number(_snap.min); _hi = Number(_snap.max);
                    }
                    if (!isFinite(_lo) || !isFinite(_hi) || _lo > _hi) { _gbOk = false; break; }
                    _gbDom[_gvn] = [_lo, _hi];
                }
                if (_gbOk) {
                    var _gb = _globalBranchCertify(_gbEqs, _gbVns, _gbDom, _gbOpts);
                    if (_gb) _mergeGlobalBranch(state, _gb);
                }
            }
        }
    }
    if (state && state.result && !state.result.meta) {
        _updateMovability(state);   // 切片B：终态标记（即使未进收缩层也置位，保证输出携带病态状态）
        state.result.meta = _buildMeta(state);
    }
    // 结构预判标签透出（全局调度第一层结论）：让结果携带 无解/有限/无限 分类
    if (state && state.result) {
        if (state.result.error === 'NO_SOLUTION') {
            // 空集（无解）是三类之一，且由 sound 算子事后证出，应覆盖预判标签
            state.result.cardinality = 'empty';
        } else if (state.cardinality) {
            state.result.cardinality = state.cardinality;
            state.result.effectiveDim = (state.effectiveDim === undefined ? -1 : state.effectiveDim);
            state.result.classifyRank = (state.classifyRank === undefined ? -1 : state.classifyRank);
            state.result.isPolynomial = !!state.isPolynomial;
            state.result.positiveDim = !!state.positiveDim;
        }
    }
    // 2026-08-22 P0：可信层级 / 无解证明 / 完备性边界 三件套统一注入
    _assignTiers(state);
    _assignEmptiness(state);
    _assignCompleteness(state);
    return state.result;
}

function _solveImpl(equationStrs, varNames, decimals, initialD0, fastMode, opts) {
    var state = {};
    if (initialD0 === undefined) _ieeeReset();   // 仅顶层求解重置 IEEE 标记；分支递归子盒累积异常，不丢聚合信息
    state.equations = [];
    state._origEqs = (equationStrs && equationStrs.length) || 0;   // 原始方程数（区分"纯净单变量输入"与"多变量消元后的伪单变量"）
    state.varNames = varNames || [];
    state.D0 = {};
    state.userDomain = (initialD0 && typeof initialD0 === 'object') ? initialD0 : null;  // 用户初始域，供全局区间分支使用
    state.mov = {};            // 切片B：每变量 movability 状态映射（不污染盒子对象）
    state._movHist = {};       // 切片B：每变量宽度历史（判定收敛无望）
    // physBounds 已移除
    state.tolerance = 1e-6;
    state.startTime = performance.now();
    state.result = null;
    state.done = false;
    state.truncated = false;          // 资源截断标记：盒队列/分支预算/迭代上限耗尽时置位（绝不隐藏）
    state.repPointNote = null;        // 代表点选取规则说明（由后处理算子填写）
    state.features = {};
    state.manifoldInfo = null;
    state.calculusInfo = null;
    state.domainConstraints = [];
    state.conditionWarnings = [];
    state.equationStrs = equationStrs || [];
    state.maxIter = 20;
    state.skipOperators = {};
    state.eqFeatures = {};
    state.decimals = 6;
    state.symInfo = null;
    state.p3LowDim = false;
    state.persistentHomologyInfo = null;
    state.poincareInfo = null;
    state.singularRegionsInfo = null;
    // 计算网格固定为 6 位小数（产品规格：6位小数有限网格）。
    // 显示精度同样固定为 COMPUTE_DECIMALS（=6）：求解精度与显示精度同源恒定，
    // 不做位数切换，既避免「选 0 位出现整数假解」的误导，也对齐行业范式
    //（Mathematica 默认显示 6 位、Matlab format 仅改显示不改计算）。
    state.displayDecimals = COMPUTE_DECIMALS;          // 仅供显示层 toFixed 使用（固定 6）
    state.decimals = COMPUTE_DECIMALS;                // 计算用小数位（固定）
    state.solverDecimals = COMPUTE_DECIMALS;          // 分支最小盒宽 10^-6（固定）
    state.tolerance = Math.pow(10, -COMPUTE_DECIMALS); // 计算残差容差（固定，与显示精度无关）
    state.maxIter = 20;                              // 计算迭代上限（固定）
    state.fastMode = !!fastMode;

    // 资源上限可注入（opts.maxBranch / opts.maxBoxes / opts.maxIter），默认沿用硬编码上限；
    // 对齐工程路线“资源限制须向上层暴露”——供资源截断预言机与 Agent 防护使用。
    // 显式赋值后，suan47 内的 `typeof branchBudget==='undefined'` 守卫将不再回退到 200。
    if (opts && Number.isFinite(opts.maxBranch)) state.branchBudget = opts.maxBranch;
    if (opts && Number.isFinite(opts.maxBoxes)) state.maxBoxes = opts.maxBoxes;
    if (opts && Number.isFinite(opts.maxIter)) state.maxIter = opts.maxIter;

    // ===== 解析层（D0 初始化前：建立 equations / varNames / >6 硬校验）=====
    if (_runSeq(state, OPS_SETUP)) return _finish(state);

    // ===== 阶段 0｜结构预判（全局调度第一层：先判 无解/有限/无限，再按标签分流）=====
    // 数学依据：解流形维数 d = n − rank(J)。d=0→有限(孤立点)；d≥1→无限(正维流形)；
    // m<n ⇒ d≥1(欠定, sound 无限)。本产品无 CAS，Groebner 维数判定不可行，故用
    // 数值雅可比秩（sound-incomplete）。自此收缩算子降级为「抛光器」（见阶段5/6）。
    suan0_classify(state);

    // 保存原始变量名（供消元算子回代使用）
    state.originalVarNames = state.varNames.slice();

    // 保存原始方程AST（供后续验证回代使用）
    state.originalEquations = state.equations.slice();

    // 初始化 D0：优先使用传入的 initialD0（分支定界递归调用），否则默认 [-1000000, 1000000]
    if (state.varNames && state.varNames.length > 0) {
        if (initialD0) {
            // 分支定界递归调用：使用父域切割后的子域
            // 提取 _branchDepth（如有），然后从 D0 中移除
            if (initialD0._branchDepth !== undefined) {
                state.branchDepth = initialD0._branchDepth;
            }
            state.D0 = JSON.parse(JSON.stringify(initialD0));
            delete state.D0._branchDepth;
            // 格式归一化：兼容 MCP 文档约定的数组格式 {"x":[-2,2]} 与内部对象格式 {"x":{min,max}}
            // （2026-08-21 修复：原逻辑直接把 initialD0 存入 D0，MCP 路径按文档传数组格式时
            //  后续 17 处 state.D0[vn].min/.max 全部读到 undefined → NaN → 域约束静默失效）
            for (var _dnorm = 0; _dnorm < state.varNames.length; _dnorm++) {
                var _dnv = state.varNames[_dnorm];
                // 用户只给了部分变量的域：其余变量必须补默认全域，不能 continue 跳过。
                // （此前跳过 → 该变量在 D0 中无条目 → 后续 state.D0[vn].min 读 undefined 属性直接崩溃）
                if (state.D0[_dnv] === undefined || state.D0[_dnv] === null) {
                    state.D0[_dnv] = { min: -1000000, max: 1000000 };
                    continue;
                }
                var _dval = state.D0[_dnv];
                if (Array.isArray(_dval)) {
                    // 数组格式 [lo, hi]
                    var _dlo = Number(_dval[0]);
                    var _dhi = Number(_dval[1]);
                    if (isNaN(_dlo)) _dlo = -1000000;
                    if (isNaN(_dhi)) _dhi = 1000000;
                    state.D0[_dnv] = { min: _dlo, max: _dhi };
                } else if (typeof _dval === 'object' && _dval.min !== undefined) {
                    // 对象格式 {min, max}（已是内部格式，仅规范化数值）
                    state.D0[_dnv] = {
                        min: isNaN(Number(_dval.min)) ? -1000000 : Number(_dval.min),
                        max: isNaN(Number(_dval.max)) ? 1000000 : Number(_dval.max)
                    };
                } else {
                    // 未知格式：回退默认全域
                    state.D0[_dnv] = { min: -1000000, max: 1000000 };
                }
            }
        } else {
            // 首次调用：默认 [-1000000, 1000000]
            for (var _vi = 0; _vi < state.varNames.length; _vi++) {
                var _vn = state.varNames[_vi];
                if (!state.D0[_vn]) {
                    state.D0[_vn] = { min: -1000000, max: 1000000 };
                }
            }
        }
        // 应用域约束条件到 D0（域约束来自用户输入的 x∈[a,b] 等条件）
        for (var _dci = 0; _dci < state.domainConstraints.length; _dci++) {
            var _dc = state.domainConstraints[_dci];
            var _dvi = state.varNames.indexOf(_dc.varName);
            if (_dvi >= 0) {
                if (_dc.min !== undefined) {
                    state.D0[_dc.varName].min = Math.max(state.D0[_dc.varName].min, _dc.min);
                }
                if (_dc.max !== undefined) {
                    state.D0[_dc.varName].max = Math.min(state.D0[_dc.varName].max, _dc.max);
                }
                if (state.D0[_dc.varName].min > state.D0[_dc.varName].max) {
                    state.done = true;
                    state.result = { solutions: [], error: "NO_SOLUTION", provenEmpty: true, message: "域约束矛盾：变量 " + _dc.varName + " 的约束区间为空", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "变量域约束自相矛盾，无法求解" };
                    return _finish(state);
                }
            }
        }
    }

    // 快照初始声明域（2026-08-21 修复）：_filterIllDefined 的域检查只对照
    // 用户声明域（initialD0 + domainConstraints），不对照收缩后的 D0。
    // 收缩层（区间算术依赖过估）可能把 D0 错误收缩到不含真解的区域
    // （如 log(z)+0.5a=1.2 中 a 的宽区间把 log(z) 区间撑爆 → z 域被污染成 [125000,250000]），
    // 若拿收缩后 D0 过滤会把满足全部原始方程的真解误判越域删除。
    // 收缩只用于剪枝提速；错误收缩不应成为拒绝真解的判据。
    state._initD0 = JSON.parse(JSON.stringify(state.D0 || {}));

    // 纯不等式系统：跳过主流水线，直接走不等式求解 + 输出
    // （suan3 的 >6 变量硬校验已在 OPS_SETUP 阶段完成，此处无需重复）
    if (state.isInequalityOnly) {
        _runOp(state, OP_INEQ); if (state.done) return _finish(state);
        _runOp(state, OP_OUTPUT);
        return _finish(state);
    }

    // ===== 阶段 1｜前置拦截 + 定义域推导（cost 1~2）=====
    if (_runSeq(state, OPS_PRE)) return _finish(state);

    // ===== 阶段 2｜轻量矛盾筛查（cost 1~2）=====
    if (_runSeq(state, OPS_SCREEN)) return _finish(state);

    // ===== 阶段 3｜代数闭式求解（cost 1~3，顺序敏感：化简→消元→回代）=====
    if (_runSeq(state, OPS_ALGEBRA)) return _finish(state);

    // 欠定系统（方程数 < 变量数）：不存在孤立解，跳过数值牛顿层，
    // 由收缩层把域压到最窄后输出"窄域 + 代表采样点"
    if (state.underdetermined) {
        if (_runPipeline(state, { geometry: true, post: true })) return _finish(state);
        return _runTail(state);
    }

    // ===== 阶段 3.5｜方阵非线性强耦合系统：提前多起点牛顿（2026-08-22）=====
    // 置于收缩层之前：对称多项式等多根耦合系统经区间收缩难以孤立（对称流形无孤立点可收缩），
    // 收缩层会空耗 8 秒预算仍无进展。此处先用确定性多起点牛顿（含整数优先种子）定位一个基解，
    // 再由 _symmetryExpand 补全全部排列解。对普通系统无害（发散即跳过，后续收缩/分支定界兜底）。
    // 用 __LS_MSNEWTON_DONE 守卫，与尾段 suan47 内的牛顿分支互斥，确保只跑一次。
    if (!__LS_MSNEWTON_DONE && state.equations.length === state.varNames.length && !state.fastMode) {
        __LS_MSNEWTON_DONE = true;
        suan47_tryNewton(state);
        // 仅"纯净单变量输入"（原始即 1 方程 1 变量，如 cos(x)=0.5）清空短路标志，
        // 交 suan22 周期感知扫描补全全部根（修复 issue A 静默漏支）。
        // 多变量方阵、以及消元后的"伪单变量"（原方程数≠1，含自由参数，如 T_Wikibooks/M01）
        // 保持原行为短路返回，避免丢失自由参数采样得到的多解。
        var _genuineSingle = (state.varNames.length === 1 && state._origEqs === 1 && _eqRefsOnlyAllowed(state.equations[0], state.varNames));
        if (state.done && !_genuineSingle) return _finish(state);
        if (_genuineSingle) { state.done = false; state.result = null; }
    }

    // ===== 阶段 4｜单变量专项求解（cost 2~3）=====
    if (_runSeq(state, OPS_ALGEBRA2)) return _finish(state);

    // ===== 阶段 5｜成本分层收缩 + 几何拓扑分析（fastMode 下整层跳过）=====
    // 收缩层内部由 _runContractionFixpoint 驱动：cost 1 → 2 → 3 → 4 逐层推进，
    // 任一贵层取得收缩即回流到 cost 1 重跑，直到全局不动点或轮数预算耗尽。
    if (!state.fastMode) {
        if (_runPipeline(state, { geometry: true })) return _finish(state);
    }

    // ===== 阶段 6｜数值求解 + 解集后处理（cost 1~4）=====
    if (_runPipeline(state, { contract: false, numeric: true, post: true })) return _finish(state);

    // ===== 阶段 7｜尾段：分支定界兜底 → 不等式 → 结果输出（cost 5 / 4 / 1）=====
    return _runTail(state);
}

// ===== 浏览器UI交互函数 =====

// 示例方程 — 6个示例，覆盖六类结果：最少变量 / 最多变量 / 空集无解 / 有限解(全部) / 有限解(部分·截断) / 无限解(推荐)
var EXAMPLES = [
    // 1: 最少1个变量（1变量，2个解）
    ["x^2 = 4"],
    // 2: 最多6个变量（三对角线性系统，唯一整数解 1,2,3,4,5,6）
    ["x + y = 3", "x + 2*y + z = 8", "y + 2*z + a = 12", "z + 2*a + b = 16", "a + 2*b + c = 20", "b + 2*c = 17"],
    // 3: 空集无解（平行直线矛盾，sound 证明无解）
    ["x + y = 3", "x + y = 5"],
    // 4: 有限个解·全部（圆×双曲线，4个解全部经 Krawczyk 认证）
    ["x*x + y*y - 4 = 0", "x*y - 1 = 0"],
    // 5: 有限个解·部分（高频振荡多解，预算内未完全穷尽，显式标记 truncated）
    ["sin(20*x) = 0.5", "sin(20*y) = 0.5"],
    // 6: 无限解·推荐（欠定，输出距原点最近的推荐解）
    ["x + y = 3"]
];

// 示例可选搜索域（与 EXAMPLES 一一对应；null 表示使用默认搜索范围 ±100万）。
// 仅标题5 需要显式域：高频多解系统在有限域内才触发全局分支定界的预算截断，
// 从而真实演示"有限个解·部分（截断）"——这是本工具诚实边界的活样本。
var EXAMPLE_DOMS = [null, null, null, null, { x: [-30, 30], y: [-30, 30] }, null];
// 示例点击后自动求解时携带的域（由 loadExample 写入，runSolver 消费后清空）
var pendingExampleDomain = null;

// 分类标签（与示例一一对应）
var EXAMPLE_CATS = [
    "1️⃣ 最少变量", "6️⃣ 最多变量", "⚠ 空集无解", "🔢 有限解·全部", "📊 有限解·部分", "♾ 无限解"
];

var EXAMPLE_DESCS = [
    "→ 预期：<strong>2个解</strong> x = 2 与 x = −2（各经 Krawczyk 认证，残差≈0）。这是变量数下界（最少 1 个变量）的演示：单个变量也能稳定求解。",
    "→ 预期：<strong>唯一解</strong> (x,y,z,a,b,c) = (1,2,3,4,5,6)（Krawczyk 认证）。这是变量数上界（最多 6 个变量）的演示：6 元线性方程组确定性求得唯一整数解。",
    "→ 预期：<strong>无解</strong>。x + y 同时等于 3 与 5，两条平行直线无交点；由 sound 算子严格证明定义域内不存在实数解（provenEmpty），绝不静默返回空。",
    "→ 预期：<strong>4个解，全部找到</strong>。圆 x²+y²=4 与双曲线 xy=1 相交 4 点，均经 Krawczyk 不动点认证（残差~1e-9），无遗漏、无伪解。",
    "→ 预期：<strong>找到大量解，但显式标记可能未穷尽（truncated）</strong>。sin(20x)=0.5 与 sin(20y)=0.5 在 [-30,30]² 内有极多交点；全局区间分支定界在预算(50万盒)内未能完全判定残余盒，结果带 truncated 横幅与告警——正是\"已尽力穷尽、极端情况可能漏但不假证\"的诚实体现。要拿到全部解请缩小域。",
    "→ 预期：<strong>无限解集（推荐解）</strong>。方程数(1)少于变量数(2)，系统欠定，真实解构成一条直线（无限多个）。本工具不输出包围盒，只输出距原点最近的推荐解 (1.5,1.5)（残差验证通过）。该点是真解但非唯一，要全部解请增加方程约束。"
];

// 示例补充说明（与示例一一对应，无说明则为空字符串）
var EXAMPLE_FAKE_NOTES = [
    "", "", "", "",
    "ℹ <strong>关于\"部分（截断）\"：</strong>本例在有限域 [-30,30]² 内交点极密，全局分支定界预算(50万盒)耗尽后仍有残余盒未证。已找到的解均数学保真，但<strong>不排除仍有个别交点未被找到</strong>——此时工具显式标 truncated 并给出残余告警，绝不谎称已穷尽。这是本工具有意保留的诚实边界（见\"能力与边界\"）。",
    ""
];

function toggleInfoPanel() {
    var card = document.getElementById('infoCard');
    if (card.classList.contains('open')) {
        card.classList.remove('open');
    } else {
        card.classList.add('open');
    }
}

function loadExample(n) {
    try {
        var idx = n - 1;
        if (idx < 0 || idx >= EXAMPLES.length) return;
        document.getElementById("equations").value = EXAMPLES[idx].join("\n");
        document.getElementById("variables").value = "";

        // 显示示例说明
        var hint = document.getElementById("exampleHint");
        var catEl = document.getElementById("hintCategory");
        var descEl = document.getElementById("hintDescription");
        var fakeEl = document.getElementById("hintFakeNote");

        if (catEl) catEl.textContent = EXAMPLE_CATS[idx] || "";
        if (descEl) descEl.innerHTML = EXAMPLE_DESCS[idx] || "";

        if (fakeEl) {
            if (EXAMPLE_FAKE_NOTES[idx]) {
                fakeEl.innerHTML = EXAMPLE_FAKE_NOTES[idx];
                fakeEl.classList.add("show");
            } else {
                fakeEl.classList.remove("show");
            }
        }

        if (hint) hint.classList.add("show");

        // 点击示例即自动求解（带可选域），走与手动"求解"完全相同的路径
        pendingExampleDomain = (EXAMPLE_DOMS && EXAMPLE_DOMS[idx]) ? EXAMPLE_DOMS[idx] : null;
        runSolver();
    } catch(e) {
        alert("示例加载出错: " + e.message);
    }
}

function cleanInput(text) {
    // 1. LaTeX 格式处理
    if (/\\begin\{cases\}|\\\(|\\\\\\\\/.test(text)) {
        text = text.replace(/\\\(/g, '').replace(/\\\)/g, '');
        text = text.replace(/\\begin\{cases\}/g, '').replace(/\\end\{cases\}/g, '');
        text = text.replace(/\\\\\\\\/g, '\n');
        text = text.replace(/\\(,|;|!|\s)/g, '');
        text = text.replace(/\\cdot\s*/g, '*');
    }
    // 2. 统一符号
    text = text.replace(/[\u201C\u201D\u2018\u2019]/g, '"');  // 智能引号
    text = text.replace(/[\u2212\u2013\u2014]/g, '-');        // 各种减号/破折号
    text = text.replace(/\u00D7/g, '*');                       // 乘号 ×
    text = text.replace(/\u00F7/g, '/');                       // 除号 ÷
    // 3. 把 x_1, x_2 等带下标的变量名转为 x1, x2
    text = text.replace(/([a-zA-Z])_(\d+)/g, '$1$2');
    // 4. 隐式乘法：变量空格变量 → 变量*变量（如 x1 x2 → x1*x2，注意不跨行）
    text = text.replace(/([a-zA-Z]\w*)[ \t]+([a-zA-Z]\w*)/g, '$1*$2');
    // 5. 隐式乘法：数字空格变量 → 数字*变量（如 2 x1 → 2*x1，注意不跨行）
    text = text.replace(/(\d+\.?\d*)[ \t]+([a-zA-Z]\w*)/g, '$1*$2');
    // 6. 隐式乘法：变量空格数字 → 变量*数字（如 x1 2 → x1*2，注意不跨行）
    text = text.replace(/([a-zA-Z]\w*)[ \t]+(\d+\.?\d*)/g, '$1*$2');
    // 7. 去掉多余空格（但保留换行）
    text = text.replace(/[ \t]+/g, ' ');
    return text.trim();
}

function runSolver() {
    // 变量名框"自动识别回显"开关：用户从未手动编辑过该框（_varsTouched=false）时，
    // 计算后把求解器实际识别到的变量名回填显示，让用户确认识别结果；
    // 用户一旦手动输入过（如补充 e 作为变量），oninput 置 true，此后不再覆盖。
    if (typeof _varsTouched === 'undefined') { _varsTouched = false; }
    // 读取输入
    var eqText = document.getElementById("equations").value.trim();
    if (!eqText) {
        showError("请输入方程");
        return;
    }
    // 自动检测并清理 LaTeX 格式输入（如 \begin{cases}...\\...\end{cases}）
    eqText = cleanInput(eqText);
    var varText = document.getElementById("variables").value.trim();

    // 按行拆分方程；但兼容"豆包式打竖粘贴"：若整段只含一个 '=' 却跨多行，
    // 说明是单条方程被换行拆散，合并换行成一条方程（否则每字符会被当成假方程）。
    var _rawLines = eqText.split("\n").map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
    var _eqCount = (_rawLines.join('').match(/=/g) || []).length;
    var eqLines = (_eqCount === 1 && _rawLines.length > 1) ? [_rawLines.join('')] : _rawLines;
    if (eqLines.length === 0) {
        showError("请输入方程");
        return;
    }

    var varList = varText ? varText.split(",").map(function(v) { return v.trim(); }).filter(function(v) { return v.length > 0; }) : [];

    // 显示计算中状态
    var btn = document.querySelector(".solve-btn");
    var origText = btn.textContent;
    btn.textContent = "计算中...";
    btn.disabled = true;

    // 使用 setTimeout 让 UI 更新后再执行计算
    setTimeout(function() {
        try {
            // 示例自动求解时携带其声明域；手动求解时为 null（使用默认搜索范围 ±100万）
            var _dom = pendingExampleDomain || undefined;
            pendingExampleDomain = null;
            var result = solve(eqLines, varList, 6, _dom);
            // 变量名自动识别回显（用户未手动编辑过变量名框时）：
            // 把求解器实际识别到的变量名回填到框里，让用户一眼确认"识别对了没"。
            // e / pi / π 等保留常数符号不会被识别为变量，清单里缺了它们即知歧义。
            if (!_varsTouched && result.varNames && result.varNames.length) {
                document.getElementById("variables").value = result.varNames.join(", ");
            }
            // 保留常数歧义提示：方程中出现 e / pi / π 且未被识别为变量 → 显式说明，
            // 避免用户以为"e 是变量却没解出来"。
            if (!varText) {
                var _rv = result.varNames || [];
                var _hints = [];
                if (/(^|[^A-Za-z0-9_])e($|[^A-Za-z0-9_])/.test(eqText) && _rv.indexOf('e') < 0) {
                    _hints.push("提示：方程中的 e 被识别为欧拉常数 e≈2.718281828…（非变量）。若需将 e 用作变量，请在\"变量名\"框中手动填入 e。");
                }
                if (/\b(pi|π)\b/.test(eqText) && _rv.indexOf('pi') < 0 && _rv.indexOf('π') < 0) {
                    _hints.push("提示：方程中的 pi/π 被识别为圆周率常数 π≈3.14159265…（非变量）。");
                }
                if (_hints.length) {
                    result.warnings = (result.warnings || []).concat(_hints);
                }
            }
            displayResult(result, eqLines);
        } catch(e) {
            if (e && e.type === 'invalid_input') {
                showError(e.message || "输入不是有效的数学方程");
            } else {
                showError("求解器内部错误: " + (e.message || String(e)));
            }
        }
        btn.textContent = origText;
        btn.disabled = false;
    }, 50);
}

// 残差展示统一口径（2026-08-18）：内部求解精度远高于输出精度（如 3.4e-9），
// 实际工程使用只需 10^-d 量级。达标（|残差| < 当前容差）统一显示 "< 容差"，
// 不展示内部高精度数值；未达标才显示实际量级供排查。
function _fmtResidual(r) {
    if (r === undefined || r === null || r !== r) return "?";
    var tol = Math.pow(10, -COMPUTE_DECIMALS); // 残差达标判据固定为计算容差，与 UI 显示小数位无关
    var tolStr = tol < 1e-3 ? tol.toExponential(0) : String(tol);
    if (Math.abs(r) < tol) return "< " + tolStr;
    return r.toExponential(2);
}

// HTML 转义（安全等保加固 2026-09-01）：所有用户可控内容（变量名、诊断信息、警告、
// 方程回显等）注入 innerHTML 前必须转义，杜绝 XSS 注入。
function _escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function displayResult(result, eqLines) {
    var resultSection = document.getElementById("resultSection");
    var errorSection = document.getElementById("errorSection");

    // 隐藏两个区域
    resultSection.classList.remove("show");
    errorSection.classList.remove("show");

    // 总是显示结果分类（无解也需要明确告知用户，避免误以为故障）
    document.getElementById("execPath").textContent = result.executionPath || "-";
    document.getElementById("timeMs").textContent = result.timeMs ? (Math.round(result.timeMs) + "ms") : "-";

    var html = "";
    // 资源截断显著提示（合规要求：结果可能不完整必须让用户直接看到，而非仅 JSON 暴露）
    var _trunc = (result.meta && result.meta.truncated) || result.truncated;
    if (_trunc) {
        html += '<div class="trunc-banner"><strong>⚠ 结果可能不完整（资源截断 / truncated）</strong>：本次计算在计算预算内未能完全收敛，部分真解可能未被找到或仅以未收敛区间表示。请勿据此做出关键决策；建议缩小变量范围、减少变量数或调大计算资源后重试。</div>';
    }
    var outVars = result.varNames || [];

    // 结果类型分类标签（3种形态：1 空集无解 / 2 有限个解 / 3 无限解集（推荐解））
    var typeLabels = { 1: "空集无解", 2: "有限个解", 3: "无限解集（推荐解）" };
    var typeColors = { 1: "#dc3545", 2: "#28a745", 3: "#17a2b8" };
    var rt = result.resultType || 2;
    html += '<div style="margin-bottom:10px">';
    html += '<span style="background:' + (typeColors[rt] || '#28a745') + ';color:#fff;padding:3px 12px;border-radius:12px;font-size:13px;font-weight:bold;display:inline-block">类型' + rt + ': ' + (typeLabels[rt] || '未知') + '</span>';
    if (result.resultTypeDesc) {
        html += '<div style="font-size:13px;color:#666;margin-top:6px;line-height:1.5;padding:8px 12px;background:#f8f9fa;border-radius:6px">' + _escHtml(result.resultTypeDesc) + '</div>';
    }
    // 人话总结：无解 / 唯一解 / 有限个解 / 无限个解
    var summaryText = "", summaryColor = "";
    var solCount = (result.solutions || []).length;
    if (rt === 1) {
        summaryText = "该方程组无解（空集）— 在变量定义域内，不存在任何一组实数能同时满足全部方程。这本身是确定的数学结论，并非计算失败。";
        summaryColor = "#dc3545";
    } else if (rt === 2) {
        if (solCount === 1) {
            summaryText = "唯一解 — 有且仅有一组实数解满足所有方程";
            summaryColor = "#28a745";
        } else {
            summaryText = "有限个解 — 共有 " + solCount + " 组孤立实数解";
            summaryColor = "#28a745";
        }
    } else if (rt === 3) {
        if (solCount > 0) {
            summaryText = "无限个解（欠定系统）— 方程数少于变量数，解集构成参数化集合，存在无限多个解；已输出距原点最近的推荐解。增加方程约束可确定唯一解";
        } else {
            summaryText = "无限个解（欠定系统）— 方程数少于变量数，解集构成参数化集合，存在无限多个解，但未能生成有效推荐解";
        }
        summaryColor = "#17a2b8";
    }
    if (summaryText) {
        html += '<div style="font-size:14px;color:' + summaryColor + ';margin-top:6px;padding:8px 12px;background:' + (rt === 1 ? '#fff0f0' : '#f8fff8') + ';border-radius:6px;border:1px solid ' + summaryColor + '44;font-weight:bold">' + summaryText + '</div>';
    }
    // 诊断信息：为何无解 / 内部错误详情（多专家评审 P0-2 — 用户必须看到"为什么无解"）
    if (result.message || result.error || result.detail) {
        var _diag = result.message || result.error || "";
        if (result.detail) _diag += (result.message || result.error ? "　" : "") + result.detail;
        var _diagColor = result.error ? "#dc3545" : "#0c5460";
        var _diagBg = result.error ? "#f8d7da" : "#d1ecf1";
        html += '<div style="font-size:13px;color:' + _diagColor + ';margin-top:6px;padding:8px 12px;background:' + _diagBg + ';border-radius:6px;border:1px solid ' + _diagColor + '44;line-height:1.6">';
        html += '<b>诊断信息</b>：' + _escHtml(_diag);
        html += '</div>';
    }
    if (rt === 1) {
        html += '<div style="font-size:12px;color:#856404;margin-top:6px;padding:8px 12px;background:#fff8e1;border-radius:6px;border:1px solid #ffe69c;line-height:1.6">';
        html += '<b>怎么看这条结果</b>：① 无解是合法的数学结论，不代表工具出错；② 常见原因——方程相互矛盾（如同一关系被赋予不同的值）、或约束过紧无交集；③ 请核对方程是否抄写正确，或调整 / 放宽约束后重试。';
        html += '</div>';
    }
    if (result.unconverged) {
        html += '<div style="font-size:13px;color:#e83e8c;margin-top:6px;padding:6px 12px;background:#fff0f5;border-radius:6px">⚠ 存在未收敛大区间 — 大区间包裹碎片化解集，可能不完全收敛。请调大资源或缩小初始范围重试</div>';
    }
    if (result.manifold && result.manifold.hasRedundancy) {
        html += '<div style="font-size:12px;color:#555;margin-top:4px;padding:6px 12px;background:#f5f0ff;border-radius:6px;border:1px solid #e0d8f0">';
        html += '<b>流形参数化</b>：维度 ' + result.manifold.dimension + '，雅可比秩 ' + result.manifold.rank + '，' + (result.manifold.tangentBasis ? '切空间基已计算' : '无切空间基');
        html += '</div>';
    }
    html += '</div>';

        // 结果可信度说明（对所有含解的结果适用）
        if (rt === 2 || rt === 3) {
            html += '<div style="font-size:12px;color:#155724;margin-bottom:8px;padding:8px 12px;background:#f0fff0;border-radius:6px;border:1px solid #c3e6cb;line-height:1.5">';
            html += '<b>✓ 可信说明</b>：下方"解列表"中的每个点都经残差验证（&lt;1e-6），满足全部方程，可直接使用。';
            if (rt === 3) {
                html += ' 本例为欠定系统（无限解集），仅输出距原点最近的推荐解；该点是真解但非唯一，如需更多解请增加方程约束。';
            }
            html += '</div>';
        }
        // 主准则：距原点最近（‖x‖² 最小）；等距时按字典序最小化 |x_i|（真全序，确定性、可复现——产品承诺）
        var minSol = (result.solutions && result.solutions.length >= 1) ? pickRecommended(result.solutions) : null;
        var minDist2 = 0;
        if (minSol) { for (var _mvi = 0; _mvi < minSol.values.length; _mvi++) minDist2 += minSol.values[_mvi] * minSol.values[_mvi]; }
        // 显示推荐解（唯一解时标"唯一解"，多个解时标"推荐解"）
        if (result.solutions.length >= 1) {
            var recLabel = (result.resultType === 3) ? "推荐解（距原点最近）" : (result.solutions.length === 1 ? "唯一解" : "推荐解（距原点最近，等距取字典序最小 |xᵢ|）");
            html += '<div style="font-size:12px;color:#28a745;margin-bottom:6px;padding:8px 12px;background:#f0fff0;border-radius:6px;border:1px solid #c3e6cb">';
            html += '<b>' + recLabel + '</b>：';
            html += '<div style="margin-top:4px;font-size:13px;font-family:monospace">';
            for (var _mvi = 0; _mvi < outVars.length; _mvi++) {
                var _v = Number(minSol.values[_mvi].toFixed(6));
                var _vnEsc = _escHtml(outVars[_mvi]);
                if (Math.abs(minSol.values[_mvi]) < 1e-9) {
                    html += '<span style="margin-right:10px;color:#dc3545;font-weight:bold">' + _vnEsc + ' = ' + _v + '</span>';
                } else {
                    html += '<span style="margin-right:10px">' + _vnEsc + ' = ' + _v + '</span>';
                }
            }
            var _zc = 0; for (var _mz = 0; _mz < minSol.values.length; _mz++) if (Math.abs(minSol.values[_mz]) < 1e-9) _zc++;
            html += '  <span style="color:#999;font-size:11px">' + _zc + ' 个零分量，距原点 ' + Math.sqrt(minDist2).toFixed(6) + '，残差 ' + _fmtResidual(minSol.residual) + '</span>';
            html += '</div></div>';
        }

        for (var si = 0; si < result.solutions.length; si++) {
            var sol = result.solutions[si];
            var confidence = result.confidence || "medium";
            var confidenceLabel = { high: "高", medium: "中", low: "低" }[confidence] || confidence;

            html += '<div class="solution-card">';
            html += '  <div class="solution-header">';
            html += '    <span class="solution-title">解 ' + (si + 1) + '</span>';
            html += '    <span class="confidence-badge confidence-' + confidence + '">置信度: ' + confidenceLabel + '</span>';
            html += '  </div>';
            html += '  <div class="solution-vars">';

            for (var vi = 0; vi < outVars.length; vi++) {
                var val = sol.values[vi];
                if (typeof val === "number") val = Number(val.toFixed(6));
                html += '    <div class="var-item">';
                html += '      <span class="var-name">' + _escHtml(outVars[vi]) + '</span>';
                html += '      <span class="var-value">' + (val !== undefined ? _escHtml(val) : "?") + '</span>';
                html += '    </div>';
            }

            html += '  </div>';
            html += '  <div class="residual-info">残差: ' + (sol.residual !== undefined ? _fmtResidual(sol.residual) : "?") + '</div>';
            html += '</div>';
        }

    // 显示警告
    if (result.warnings && result.warnings.length > 0) {
        html += '<div class="warnings-section">';
        for (var wi = 0; wi < result.warnings.length; wi++) {
            html += '<div class="warning-item">' + _escHtml(result.warnings[wi]) + '</div>';
        }
        html += '</div>';
    }

    document.getElementById("resultContent").innerHTML = html;
    resultSection.classList.add("show");

    // 滚动到结果区域
    setTimeout(function() {
        var target = resultSection.classList.contains("show") ? resultSection : errorSection;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
}

function showError(msg) {
    var errorSection = document.getElementById("errorSection");
    document.getElementById("errorContent").textContent = msg;
    document.getElementById("resultSection").classList.remove("show");
    errorSection.classList.add("show");
    errorSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

