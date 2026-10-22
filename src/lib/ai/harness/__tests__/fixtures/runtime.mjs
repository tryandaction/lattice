// Executable protocol fixture: no AI/network/auth/config/file content access.
import readline from "node:readline";
import { spawn } from "node:child_process";
let turnId = "turn_fixture_1";
let threadId = "thread_fixture_1";
let approval;
let toolCall;
const descendant = process.argv.includes("--child") ? spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true }) : null;
function send(value) {
  const data = Buffer.from(JSON.stringify(value) + "\n");
  // Exercise byte boundaries inside non-ASCII text and line breaks.
  const position = Math.min(17, data.length);
  process.stdout.write(data.subarray(0, position)); process.stdout.write(data.subarray(position));
}
const notify = (method, params) => send({ method, params: { threadId, turnId, ...params } });
const finish = () => notify("turn/completed", { turn: { id: turnId, status: "completed" } });
const rl = readline.createInterface({ input: process.stdin });
let claudeRequest = 0;
let claudeSession;
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (process.argv.includes("--claude")) {
    if (message.type === "control_request") return send({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
    if (message.type === "user") {
      claudeSession = message.session_id;
      claudeRequest += 1;
      return send({ type: "control_request", request_id: `claude_request_${claudeRequest}`, request: { subtype: "mcp_message", server_name: "lattice", message: { jsonrpc: "2.0", id: claudeRequest, method: "tools/call", params: { name: "lattice_sources_read", arguments: { sourceId: "fixture" } } } } });
    }
    if (message.type === "control_response") {
      if (message.response.response.mcp_response.id !== claudeRequest) throw new Error("MCP response ID mismatch");
      const text = message.response.response.mcp_response.result.content[0].text;
      send({ type: "stream_event", session_id: claudeSession, event: { delta: { type: "text_delta", text } } });
      return send({ type: "result", subtype: "success", is_error: false, session_id: claudeSession, result: text });
    }
    throw new Error("Unexpected Claude fixture message");
  }
  if (message.method === "initialize") return send({ id: message.id, result: { userAgent: "owned-fixture/1" } });
  if (message.method === "initialized") return;
  if (message.method === "fixture/pid") return send({ id: message.id, result: { childPid: descendant?.pid ?? null, pid: process.pid } });
  if (message.method === "permissionProfile/list") return send({ id: message.id, result: { data: [{ id: process.env.FIXTURE_PERMISSION_PROFILE, allowed: true }] } });
  if (message.method === "thread/start" || message.method === "thread/resume") {
    if (message.params.approvalPolicy !== "on-request") return send({ id: message.id, error: { code: -32602, message: "Retired untrusted policy is not supported" } });
    if (!message.params.developerInstructions?.includes("research assistant inside Lattice")) throw new Error("Missing explicit research role isolation");
    threadId = message.params.threadId ?? threadId;
    return send({ id: message.id, result: { thread: { id: threadId }, cwd: process.cwd(), model: message.params.model, activePermissionProfile: { id: message.params.permissions }, approvalPolicy: "on-request" } });
  }
  if (message.method === "turn/start") {
    if (message.params.input.some(item => item.type === "image")) {
      const inputs = message.params.input;
      if (inputs.some(item => !["text", "image"].includes(item.type))) throw new Error("Unexpected image input kind");
      for (const item of inputs.filter(item => item.type === "image")) {
        if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(item.url) || "path" in item) throw new Error("Images must use typed inline data URLs");
      }
      turnId = "turn_fixture_" + String(Number(turnId.split("_").at(-1)) + 1);
      send({ id: message.id, result: { turn: { id: turnId, status: "inProgress" } } });
      notify("turn/started", { turn: { id: turnId, status: "inProgress" } });
      notify("item/agentMessage/delta", { itemId: "image-result", delta: `typed-images=${inputs.filter(item => item.type === "image").length};text=${inputs.filter(item => item.type === "text").map(item => item.text).join("")}` });
      finish(); return;
    }
    if (message.params.input[0].text === "rpc-error") return send({ id: message.id, error: { code: -32603, message: "Windows sandbox setup required; authorization: Bearer sk-test-secret" } });
    turnId = "turn_fixture_" + String(Number(turnId.split("_").at(-1)) + 1);
    const text = message.params.input[0].text;
    send({ id: message.id, result: { turn: { id: turnId, status: "inProgress" } } });
    notify("turn/started", { turn: { id: turnId, status: "inProgress" } });
    if (text === "crash") return setTimeout(() => process.exit(17), 20);
    if (text === "eof") { process.stdout.write('{"method":"truncated'); return setTimeout(() => process.exit(0), 20); }
    if (text === "empty") return setTimeout(() => process.exit(0), 20);
    if (text === "oversized") { process.stdout.write("x".repeat(2 * 1024 * 1024 + 5)); return; }
    if (text === "interrupt") return;
    if (text === "phases" || text === "late-phases") {
      const messages = [{ id: "progress", phase: "commentary", text: "Status Update / Todo / Next Steps" }, { id: "answer", phase: "final_answer", text: "本文总结：完整结论。" }];
      for (const item of messages) {
        notify("item/started", { item: { ...item, type: "agentMessage", text: "", ...(text === "late-phases" ? { phase: null } : {}) } });
        notify("item/agentMessage/delta", { itemId: item.id, delta: item.text });
        notify("item/completed", { item: { ...item, type: "agentMessage" } });
      }
      finish(); return;
    }
    if (text === "dynamic") {
      toolCall = { id: "wire-tool-7", callId: "call_fixture_7" };
      return send({ id: toolCall.id, method: "item/tool/call", params: { threadId, turnId, callId: toolCall.callId, tool: "lattice_pdf_proposeChild", arguments: { parentPath: "paper.pdf", fileName: "note.md", mode: "create", content: "# 研究" } } });
    }
    if (["approval", "outside-approval", "command-approval", "grant-root-approval"].includes(text)) {
      const command = text === "command-approval";
      notify("item/started", { item: { id: "item_change", type: command ? "commandExecution" : "fileChange", changes: [{ path: text === "outside-approval" ? "../escape.md" : "out.md", diff: "+reviewed content", kind: { type: "add" } }] } });
      approval = { id: "wire-approval-42", turnId };
      send({ id: approval.id, method: command ? "item/commandExecution/requestApproval" : "item/fileChange/requestApproval", params: { threadId, turnId, itemId: "item_change", command: command ? "echo blocked" : undefined, ...(text === "grant-root-approval" ? { grantRoot: process.cwd() } : {}) } });
      return;
    }
    if (text === "stderr") process.stderr.write("sensitive diagnostic discarded ".repeat(2000));
    if (text === "unknown") notify("future/private", { text: "must not render" });
    if (text === "burst") {
      for (let index = 0; index < 500; index++) notify("item/agentMessage/delta", { itemId: "message", delta: "字" });
    } else notify("item/agentMessage/delta", { itemId: "message", delta: text });
    finish(); return;
  }
  if (message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
    notify("item/agentMessage/delta", { itemId: "message", delta: "late forbidden delta" });
    notify("turn/completed", { turn: { id: turnId, status: "interrupted" } }); return;
  }
  if (message.id === approval?.id) {
    if (!message.result?.decision) throw new Error("Missing exact approval reply");
    notify("item/agentMessage/delta", { itemId: "message", delta: `decision=${message.result.decision}` });
    finish(); return;
  }
  if (message.id === toolCall?.id) {
    if (!Array.isArray(message.result?.contentItems) || typeof message.result.success !== "boolean") throw new Error("Invalid official dynamic tool response");
    notify("item/agentMessage/delta", { itemId: "message", delta: message.result.contentItems[0].text });
    finish(); return;
  }
  if (message.id !== undefined) send({ id: message.id, error: { code: -32601, message: "Unknown fixture request" } });
});
