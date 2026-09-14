# 灵境 LingJing

一间「课室」——**人类是学习者，AI 学生只是镜子，不评分**。

## 这是什么

灵境把「教与学」做成一间课室。你（人类教师 / 学习者）来主讲，几个 AI 学生抛出**探测式提问**逼你把概念讲清；课后你逐条看「他问的 / 你答的」，自己判断讲没讲透。

- AI 学生**不会学习**，也不评任何「理解度 / 接住率」。
- 所有「学生懂了没」的自动判定（finalP / avgR / H / completeness / resolved / caught / blindSpots / conceptCaught）**已全部移除**，判定权交还人类。
- 服务端只报事实：学生抛了几枚探测、你回了几枚原话。「答到没」由你课后逐条判。

## 怎么跑

- 依赖：Node 22+
- 启动：`node server.js`（默认端口 8080；可用 `PORT` 环境变量改端口）
- 打开 `public/index.html`，或访问 `http://localhost:8080`
- 可选 LLM：设环境变量 `LINGJING_OR_KEY`（OpenRouter 兼容）启用 AI 学生说人话；不设也能跑（走兜底文本）

## 结构

| 路径 | 作用 |
| --- | --- |
| `server.js` | HTTP 服务（`/api/roster`、`/api/class/start`、`/api/class/reply`） |
| `teacher.js` | 课堂编排：探测生成、纪要、收益统计（纯计数，非判定） |
| `teaching.js` | 已停用占位函数（不评分，留作接口占位） |
| `world.js` / `physics.js` / `rom.js` / `index.js` | 课室世界、物理/数学框架、入口 |
| `public/` | 课室前端 |
| `tools/` | 测试 |

## 合规红线

- 显著提示「在与 AI 而非自然人交互」。
- 不做情感依赖、不评学生理解度、不伪造「学生学会了」。

## 授权

见 [LICENSE](./LICENSE)。当前为保留所有权利（UNLICENSED）；如改用具体开源许可证，以 LICENSE 文件为准。
