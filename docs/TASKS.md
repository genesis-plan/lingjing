# 开发任务清单：灵境·课室

> ⚠️ **诚实说明（2026-09-11 重大变更）**：本文档已按**实际进度**重写。
> 原清单里的「评估更新 P / 知识矩阵热力图 / E/σ² 展示 / finalP」等项**已于 2026-09-11 移除**——
> 它们源头是「模型采样出的学生自评理解度」或「2-gram 噪声判定」，属假理论。现在产品只报事实、判断交还给人。

## ✅ 已完成（MVP 文本版，本机验证通过）

- [x] 框架世界 `world.js`（⟨S,R,M,T⟩ + 确定性并发合并 + JSON 持久）
- [x] 知识模型 `teaching.js`（PERSONALITIES / 知识点抽取 / 难度估计 / 性格调度；`initP/fallbackUnderstand/teachingEffect/classEntropy/addressScore/overlapScore` 保留为「已停用占位」，不在实时链路）
- [x] 课堂核心 `teacher.js`（runClassroom：5 学生按性格抛探测 + 教师回答 + 去重 + 兜底；OpenRouter 接入 + 429 降级；产物只数事实）
- [x] 极简服务 `server.js`（GET / + GET /api/roster + POST /api/class/start·reply，SSE 流式）
- [x] 网页 `public/classroom.html`（一打开就在教室；课后「他问的 / 你答的」逐条清单；`public/index.html` 简化体验页）
- [x] 浏览器原生语音输入（Web Speech API，麦克风→文字桥接，零税，不接 ASR 厂商）
- [x] 数学框架规格 `docs/classroom-framework.md`（含诚实局限：定义 2/3/4 已停用）
- [x] 本地实跑验证：GET/POST 全通；产物含 `gains{probes,answered,open}`、`probeByConcept`、`summary.pairs`，无 `finalP/E/σ²`
- [x] **2026-09-11 人判契约落地**：6 个非 HTTP 测试 + HTTP 测试全绿；2D/3D 页面与 docs 对齐

## 🟡 待办（仍属 MVP 范围，轻量，不交税）

- [ ] 教学记录保存/回看（用 World JSON 持久，无需数据库）
- [ ] 多课题切换 / 课室列表
- [ ] 真实 LLM 学生提问质量巡检（免费档额度恢复后验课题相关度）
- [ ] 是否彻底删除 `teaching.js` 中「已停用占位」函数（initP/fallbackUnderstand/teachingEffect/classEntropy/addressScore/overlapScore）—— **待用户拍板**
- [ ] 提交 + 推远程（红线，待用户一句话）

## ⛔ Phase 2 候选（未采纳，待拍板 —— 基建税）
> 下列任何一项都需引入新运行时/服务/部署，与「不交税」冲突，须用户明确 OK 才做。

- [ ] 3D 课室（Three.js 场景 + Avatar 动画）
- [ ] 麦克风录音 + ASR 语音转文字（阿里云/讯飞，付费 API）
- [ ] WebSocket 长连 + 音频接口（替换当前 HTTP/SSE）
- [ ] 教师语音回答
- [ ] 后端迁 Python FastAPI / LLM 迁 DeepSeek
- [ ] Vercel / 云部署 + 域名 HTTPS
- [ ] 多人在线（真实他人进入同一课室）
- [ ] 知识图谱 / 自适应权重 / 客观测评（v2.0）

## 排期建议（验证优先）
1. **本周**：MVP 轻量待办（记录保存、真实 LLM 巡检）+ 找 1–3 个真人试用拿留存信号。
2. **真人信号成立后再议 Phase 2**：先语音（最高杠杆的体验升级）还是先 3D（视觉升级），二选一，不并行铺税。
