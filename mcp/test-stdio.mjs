import { spawn } from "node:child_process";

const child = spawn("node", ["lingjing-classroom-mcp.js"], { stdio: ["pipe", "pipe", "inherit"] });

let buf = "";
const responses = [];
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) { try { responses.push(JSON.parse(line)); } catch {} }
  }
});

const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let sessionId = null;
const out = {};

async function main() {
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } });
  await wait(400);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  await wait(400);

  const list = responses.find((r) => r.id === 2);
  out.tools = (list?.result?.tools || []).map((t) => t.name);

  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "lingjing", arguments: { action: "start_session", args: { title: "测试课" } } } });
  await wait(300);
  const started = responses.find((r) => r.id === 3);
  sessionId = JSON.parse(started.result.content[0].text).sessionId;
  out.start = { sessionId };

  send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "lingjing", arguments: { action: "teach", args: { sessionId, content: "数学公式在计算时要注意边界值；因果关系导致结果变化，要区分相关和因果。" } } } });
  await wait(300);
  const taught = responses.find((r) => r.id === 4);
  out.teach = JSON.parse(taught.result.content[0].text);

  send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "lingjing", arguments: { action: "reflect", args: { sessionId } } } });
  await wait(300);
  const reflected = responses.find((r) => r.id === 5);
  out.reflect = JSON.parse(reflected.result.content[0].text);

  send({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "lingjing", arguments: { action: "close_session", args: { sessionId } } } });
  await wait(300);
  const closed = responses.find((r) => r.id === 6);
  out.close = JSON.parse(closed.result.content[0].text);

  // error path: reuse closed id (fail-closed)
  send({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "lingjing", arguments: { action: "teach", args: { sessionId, content: "x" } } } });
  await wait(300);
  const err = responses.find((r) => r.id === 7);
  out.errorPath = JSON.parse(err.result.content[0].text);

  console.log(JSON.stringify(out, null, 2));
  child.kill();
  process.exit(0);
}

child.on("error", (e) => { console.error("SPAWN ERROR", e); process.exit(1); });
main();
setTimeout(() => { console.error("TIMEOUT"); console.log(JSON.stringify(out, null, 2)); child.kill(); process.exit(1); }, 8000);
