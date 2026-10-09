#!/usr/bin/env node
/**
 * 灵境 LingJing · 课室 MCP（stdio）
 * 概念：人当老师（teach），AI 当学生（提问 / 反思）。
 * 设计：确定性引擎，无需 LLM、无需联网、可离线复现（与灵境 server.js 的「确定性兜底」一致）。
 * 工具：lingjing_start_session / lingjing_teach / lingjing_reflect / lingjing_close_session
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { randomBytes } from "node:crypto";

// ---------- 认知维度主清单（盲区判定基准）----------
const DIMENSIONS = [
  "前提/假设",
  "反例/边界",
  "因果方向",
  "不确定性/误差",
  "适用范围/人群",
  "长期演化",
  "价值/责任",
];

// ---------- 概念银行：关键词 -> 维度 + 苏格拉底式追问 ----------
const CONCEPT_BANK = {
  math: { dims: ["前提/假设", "反例/边界"], labels: ["数学", "公式", "方程", "计算", "数值", "函数", "证明"], q: "这个结论背后的数学假设是什么？把变量取到边界值还会成立吗？" },
  logic: { dims: ["前提/假设", "因果方向"], labels: ["逻辑", "推理", "前提", "命题", "因为", "所以", "蕴含"], q: "前提之间是否相互独立？有没有没说出口的隐含前提？" },
  causal: { dims: ["因果方向", "适用范围/人群"], labels: ["因果", "导致", "影响", "原因", "结果", "中介"], q: "这是相关还是因果？有没有混淆变量或反向因果？" },
  prob: { dims: ["不确定性/误差"], labels: ["概率", "随机", "不确定", "置信", "风险", "可能", "误差"], q: "不确定性从哪里来？有没有给出置信区间或反例概率？" },
  sys: { dims: ["长期演化", "适用范围/人群"], labels: ["系统", "整体", "组件", "结构", "模块", "反馈"], q: "局部成立，整体也成立吗？组件交互会不会引出没考虑到的行为？" },
  ethics: { dims: ["价值/责任"], labels: ["应该", "道德", "价值", "公平", "责任", "权益"], q: "这个结论对谁负责？边界人群会被怎样影响？" },
  time: { dims: ["长期演化"], labels: ["长期", "短期", "未来", "演化", "动态", "趋势"], q: "短期成立，长期也成立吗？有没有反馈回路会改变结论？" },
};

// ---------- 会话存储（进程内，重启即清空，与灵境 MVP 一致）----------
/** @type {Map<string, {id:string,title:string,taught:string[],concepts:Set<string>,questions:string[]}>} */
const SESSIONS = new Map();

function detectConcepts(text) {
  const found = new Set();
  for (const [key, bank] of Object.entries(CONCEPT_BANK)) {
    if (bank.labels.some((l) => text.includes(l))) found.add(key);
  }
  return found;
}

function studentQuestions(concepts) {
  const qs = [];
  for (const c of concepts) qs.push(CONCEPT_BANK[c].q);
  if (qs.length === 0) qs.push("能不能先给一个最具体的例子？从例子反推，结论会更扎实。");
  return qs;
}

function coveredDimensions(concepts) {
  const cov = new Set();
  for (const c of concepts) for (const d of CONCEPT_BANK[c].dims) cov.add(d);
  return cov;
}

function summarize(taught) {
  const sentences = taught
    .join(" ")
    .split(/[。！？\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
  const text = sentences.join("；");
  return text.length > 240 ? text.slice(0, 240) + "…" : text || "（本节课尚未记录具体内容）";
}

function ok(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}
function fail(msg) {
  return { content: [{ type: "text", text: JSON.stringify({ error: msg }, null, 2) }], isError: true };
}

// ---------- MCP Server ----------
const server = new McpServer({ name: "lingjing-classroom-mcp", version: "1.0.0" });

server.tool(
  "lingjing_start_session",
  "开一间灵境课室，返回一个 sessionId。人当老师，AI 当学生。",
  { title: z.string().optional().describe("课室标题（可选）") },
  async ({ title }) => {
    const id = randomBytes(8).toString("hex");
    SESSIONS.set(id, { id, title: title || "未命名课室", taught: [], concepts: new Set(), questions: [] });
    return ok({ sessionId: id, title: title || "未命名课室", message: "课室已开。请用 lingjing_teach 把要教的内容发给 AI 学生。" });
  }
);

server.tool(
  "lingjing_teach",
  "老师授课：把一段内容/经验/知识发给 AI 学生，学生返回苏格拉底式追问。",
  {
    sessionId: z.string().describe("lingjing_start_session 返回的 sessionId"),
    content: z.string().describe("要教给 AI 学生的内容"),
  },
  async ({ sessionId, content }) => {
    const s = SESSIONS.get(sessionId);
    if (!s) return fail("sessionId 无效或课室已关闭，请先 lingjing_start_session。");
    s.taught.push(content);
    const concepts = detectConcepts(content);
    for (const c of concepts) s.concepts.add(c);
    const questions = studentQuestions(concepts);
    s.questions.push(...questions);
    return ok({
      sessionId,
      detectedConcepts: [...concepts],
      studentQuestions: questions,
      acknowledged: "AI 学生已收到，并提了上面的问题。请继续教，或调用 lingjing_reflect 收尾。",
    });
  }
);

server.tool(
  "lingjing_reflect",
  "课后反思：AI 学生交回「盲区」（没覆盖到的认知维度）、本节课总结，以及可带走的卡。",
  { sessionId: z.string().describe("lingjing_start_session 返回的 sessionId") },
  async ({ sessionId }) => {
    const s = SESSIONS.get(sessionId);
    if (!s) return fail("sessionId 无效或课室已关闭，请先 lingjing_start_session。");
    const covered = coveredDimensions(s.concepts);
    const blindspots = DIMENSIONS.filter((d) => !covered.has(d));
    return ok({
      sessionId,
      summary: summarize(s.taught),
      blindspots,
      cards: {
        mirrorCard: summarize(s.taught),
        blindspotLedger: blindspots,
        returnCard: blindspots.length ? "带走的思考：" + blindspots.join("、") : "本节课维度覆盖较全，无显著盲区。",
      },
      note: "盲区 = 本节课未触及的 7 个认知维度；带走的卡可存入你的知识库。",
    });
  }
);

server.tool(
  "lingjing_close_session",
  "下课：关闭课室并交回最终总结。",
  { sessionId: z.string().describe("lingjing_start_session 返回的 sessionId") },
  async ({ sessionId }) => {
    const s = SESSIONS.get(sessionId);
    if (!s) return fail("sessionId 无效或课室已关闭。");
    const covered = coveredDimensions(s.concepts);
    const blindspots = DIMENSIONS.filter((d) => !covered.has(d));
    SESSIONS.delete(sessionId);
    return ok({
      status: "closed",
      title: s.title,
      summary: summarize(s.taught),
      blindspots,
      message: "课室已关闭，会话数据已清空。",
    });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
