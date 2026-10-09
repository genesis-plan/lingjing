# 灵境 LingJing · 课室 MCP

> 一间课室：人当老师，AI 当学生。你把知识/经验/技能教给 AI，它从各角度追问，课后交回**盲区**、**总结**和**可带走的卡**。

灵境（LingJing）本身是一个网页课室产品（本地优先，不部署）。本仓库是它的 **MCP 接口包装**：让任意 AI Agent 通过 MCP stdio 直接开课室、授课、收反思。

## 快速开始

```bash
npx lingjing-classroom-mcp
```

然后在支持 MCP 的客户端里添加（stdio）：

```json
{
  "mcpServers": {
    "lingjing": {
      "command": "npx",
      "args": ["lingjing-classroom-mcp"]
    }
  }
}
```

## 工具

| 工具 | 作用 |
|---|---|
| `lingjing_start_session` | 开课室，返回 `sessionId` |
| `lingjing_teach` | 老师授课：把内容发给 AI 学生，返回苏格拉底式追问 |
| `lingjing_reflect` | 课后反思：返回盲区（未覆盖的认知维度）、总结、可带走的卡 |
| `lingjing_close_session` | 下课：关闭课室并交回最终总结 |

## 设计说明

- **确定性引擎**：无需 LLM、无需联网、可离线复现（与灵境 `server.js` 的「确定性兜底」一致）。配置真实 LLM 学生属于灵境本体能力，本 MCP 包装提供的是可审计的确定性课室循环。
- **盲区判定**：基于 7 个认知维度（前提/假设、反例/边界、因果方向、不确定性/误差、适用范围/人群、长期演化、价值/责任）做覆盖度检查。
- **诚实降级**：维度未覆盖即如实列为盲区，不编造结论。

## 许可

UNLICENSED —— 非商业免费，商业须版权人书面授权。详见 `LICENSE`。
