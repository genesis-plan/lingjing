# 灵境 LingJing（课室 MVP）· 项目长期记忆

## 不可推导的不变量（最高频）
- **定位红线**：机器学生 = 工具 / 镜子，**不会学习**，服务的是**人类使用者**。
  → 产物里**绝不给 AI 学生打分**（无理解度 / 接住率 / completeness / finalP / avgR / H / conceptCaught）。
  → 机器只报事实（抛几枚探测、收到几枚回答原话）；"答到没"由人类课后逐条判。
- **测试约定（用户 2026-09-11 明确）**：改动**一次性写完**，最后**统一跑一次全测试**；
  **禁止边写边测 / 每步都测**。拆分测试会拖长交付时间。
- **红线（全程）**：不擅自提交/推远程；密钥只走环境变量 `LINGJING_OR_KEY`；
  不擅自删 teaching.js 中"已停用占位"函数（initP/fallbackUnderstand/teachingEffect/classEntropy/addressScore/overlapScore），待用户拍板。
- **运行坑**：本机 8080 可能残留旧服务进程跑旧代码；验证 HTTP 契约用隔离端口（如 8137），
  或先重启 8080 服务加载新代码。Bash 环境 shim 坏（cd/sleep/cat/dirname 缺失）→ 用 node 绝对路径 + spawn cwd 选项绕开。
