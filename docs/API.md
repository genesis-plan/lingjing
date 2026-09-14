# API 设计文档：灵境·课室

> ⚠️ **诚实说明（2026-09-11 重大变更）**：本文档已按**当前实际实现**重写。
> 原文档里的 `finalP` / `E` / `σ²` / `P(t)` 知识状态矩阵及其更新循环，**已于 2026-09-11 全部移除**——
> 它们源头是「模型采样出的学生自评理解度」或「2-gram 文本重叠噪声判定」，是我们不可能知道的真值，
> 属于假理论。现在服务端**只报事实**（学生抛了几枚探测、你回了几个、逐条并列「他问的 / 你答的」原文），
> 「答到没」由人类使用者课后逐条对照清单自己判，机器只数词、不下结论。

## 1. 概述（当前 MVP）
- **协议**: HTTP/1.1，课堂用 **SSE（text/event-stream）** 流式推送事件
- **数据格式**: JSON（请求体 / 每个 SSE 事件的 `data:` 负载）
- **认证**: 无（本机 MVP）；LLM 密钥仅服务端环境变量 `LINGJING_OR_KEY`

## 2. HTTP 接口

### 2.1 获取页面
```
GET /            → 200 text/html  （public/classroom.html，一打开就在教室里）
GET /index.html  → 200 text/html  （public/index.html，简化体验页）
GET /api/roster  → 200 application/json  （学生名单 + LLM 状态，见 §2.4）
```

### 2.2 开始一节课（流式）
```
POST /api/class/start
Content-Type: application/json
Request:  { "lesson": "课题名::你的讲解[||概念1|概念2|概念3]" }
Response: text/event-stream  （见 §3 事件流）
```

### 2.3 每轮回答（流式）
```
POST /api/class/reply
Content-Type: application/json
Request:  { "id": "<sessionId>", "text": "你的回答（可空＝跳过）" }
Response: text/event-stream
```

### 2.4 名单与 LLM 状态
```
GET /api/roster
Response:
{
  "students": [ {"name":"小明","trait":"好奇型"}, ... ],
  "llm": { "state": "no-key" | "unverified" | "verified" | "circuit-open", "model": "..." }
}
```

## 3. SSE 事件流（每个事件一行 `data: <json>`）

| 事件 | 负载关键字段 | 说明 |
| :--- | :--- | :--- |
| `session` | `{id}` | 课堂会话 ID |
| `start` | `{lessonTitle, lessonText, students, round:1}` | 上课铃、摆学生 |
| `round_start` | `{round, teacherReply?}` | 新一轮开始 |
| `ask` | `{name, text, round}` | 某名学生抛出一条探测（原文） |
| `round_end` | `{round, canContinue, llmOk, probeCount}` | 本轮结束；`probeCount`=累计探测枚数 |
| `done` | 见 §4 | 下课，附完整课堂产物 |
| `error` | `{message}` | 出错 |

## 4. `done` 事件负载（课堂产物）

```
{
  "lessonTitle": "光合作用",
  "concepts":    ["植物用阳光作能量", ...],          // ≤5 个知识点
  "students":    [ {"name":"小明","trait":"好奇型"}, ... ],
  "rounds":      [ {"round":1, "probeCount":5}, ... ],
  "gains": {
    "points": 3, "replies": 3, "clarifying": 2,
    "probes": 20,                       // 学生共抛出探测枚数
    "probeLine": "反例 4 · 机制 4 · 边界 3 · ...",  // 探测按类型分布
    "answered": 15,                     // 你给了回答的枚数
    "open": 5                           // 你没回的枚数（答到没由你课后自己判）
  },
  "probeByConcept": [                   // 按要点归拢的原始提问文本（替代已删的 conceptCaught 比率）
    { "concept": "植物用阳光作能量",
      "asks": [ {"name":"小明","type":"counter","say":"那要是反过来呢","round":1,"answered":true}, ... ] }
  ],
  "probes": [                           // 全部探测逐条原文 + 你对应的回答（若有）
    {"round":1,"name":"小明","type":"counter","ci":0,"say":"那要是反过来呢","answer":"..."}
  ],
  "summary": {                          // 课后纪要（人话，无 mastery/conceptEnt/kl）
    "pairs": [ ["他问：…","你答：…"], ... ],   // 「他问的 / 你答的」逐条并排
    "openQ": [ "你没回的探测原文…", ... ]
  },
  "teacherReportMd": "# 这一课，你自己的收获\n...",  // 教师专属复盘（费曼/盲区/术语）
  "artifacts": 16, "teachingEdges": 5,
  "V": 0.75,                            // 互动参与度（笔记互异率，框架世界一致性指标，非学生理解度）
  "agents": 6, "usedLLM": false
}
```

## 5. 字段含义（当前）
| 字段 | 含义 |
| :--- | :--- |
| `gains.probes` / `answered` / `open` | 学生抛出 / 你回 / 你没回的探测枚数（**只数词**） |
| `probeByConcept` / `probes` | 学生提问的**真实原文**与你的回答原文，供课后逐条对照 |
| `V` | 互动参与度（笔记互异率，框架世界一致性指标） |
| `usedLLM` | 是否走了真实 LLM（false=确定性兜底） |

## 6. ⛔ Phase 2 候选接口（未实现，待拍板）
模板原案：WebSocket `/ws/{session_id}` + 音频 base64 + ASR。
- 需引入 WS 长连、音频编码、ASR 服务；与当前 HTTP/SSE 文本接口不兼容。
- 当前 MVP 不提供，待语音阶段再设计。

## 7. 诚实局限
- **已移除**：`finalP` / `E` / `σ²` / `P(t)` 知识状态矩阵及其更新循环（2026-09-11）。
  它们由「LLM 自评理解度」或「2-gram 文本重叠」推算，不是客观观测，属假理论，不再计算也不再展示。
- 当前只数「探测枚数 / 你回了几枚 / 还欠几枚」，不替使用者下「他懂了没」的结论。
- 无跨请求会话（每节课一请求即完成），无用户注册/数据库。
