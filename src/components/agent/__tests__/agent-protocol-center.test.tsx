/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addAgentPendingApproval,
  appendAgentTraceEvent,
  completeAgentSession,
  createAgentSession,
  failAgentSession,
  resolveAgentPendingApproval,
} from "@/lib/ai/agent-session";
import {
  buildCodingQaRunnerApprovalRequest,
  buildCodingQaRunnerViewModel,
} from "@/lib/ai/coding-qa-runner-view-model";
import { setLocale } from "@/lib/i18n";
import { useAgentSessionStore } from "@/stores/agent-session-store";
import { AgentProtocolCenter } from "../agent-protocol-center";

const CURRENT_VALIDATION_STORAGE_KEY = "lattice-agent-protocol-current-validation-recorded-v1";
const CURRENT_VALIDATION_RECORD_ID = "agent-protocol-desktop-build-20260603";

const hoisted = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: hoisted.toastSuccess,
    error: hoisted.toastError,
  },
}));

describe("AgentProtocolCenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLocale("zh-CN");
    window.localStorage.clear();
    window.localStorage.setItem(CURRENT_VALIDATION_STORAGE_KEY, CURRENT_VALIDATION_RECORD_ID);
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => undefined),
      },
    });
    useAgentSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      focusTarget: null,
    });
  });

  it("renders the executable protocol dashboard", () => {
    render(<AgentProtocolCenter />);

    expect(screen.getByTestId("agent-cowork-inbox")).not.toBeNull();
    expect(screen.getByText("Co-work Session Inbox")).not.toBeNull();
    expect(screen.getByText("Workspace risk: clean")).not.toBeNull();
    expect(screen.getByTestId("coding-qa-runner")).not.toBeNull();
    expect(screen.getByText("Approval-gated QA Runner")).not.toBeNull();

    expect(screen.getByRole("heading", { name: "Agent 协议中心" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: /执行/ })).not.toBeNull();
    expect(screen.getByRole("tab", { name: /证据/ })).not.toBeNull();
    expect(screen.getByRole("tab", { name: /决策/ })).not.toBeNull();
    expect(screen.getByRole("tab", { name: /交接/ })).not.toBeNull();
    expect(screen.getByText("任务上下文")).not.toBeNull();
    expect(screen.getByText("阶段进度")).not.toBeNull();
    expect(screen.getByText("检查项进度")).not.toBeNull();
    expect(screen.getByText("执行报告")).not.toBeNull();
    expect(screen.getAllByText("收尾门禁").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("收尾门禁: 本地页面健康")).not.toBeNull();
    expect(screen.getByText("危险操作确认生成器")).not.toBeNull();
    expect(screen.getByText("验证证据")).not.toBeNull();
    expect(screen.getByText("验证模板")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Dev / Build 产物隔离回归" })).not.toBeNull();
    expect(screen.getByText("决策记录")).not.toBeNull();
    expect(screen.getByText("交接摘要")).not.toBeNull();
    expect(screen.getByText("运行快照")).not.toBeNull();
  });

  it("renders protocol controls in English when the locale changes", () => {
    setLocale("en-US");

    render(<AgentProtocolCenter />);

    expect(screen.getByRole("heading", { name: "Agent Protocol Center" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: /Execution/ })).not.toBeNull();
    expect(screen.getByRole("tab", { name: /Evidence/ })).not.toBeNull();
    expect(screen.getByText("Task context")).not.toBeNull();
    expect(screen.getByText("Stage progress")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Copy protocol" })).not.toBeNull();
    expect(screen.getByPlaceholderText("For example: complete the Agent Protocol Center and product validation")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Agent 协议中心" })).toBeNull();
  });

  it("surfaces co-work agent sessions and focuses the selected trace", async () => {
    let approvalSession = createAgentSession({
      id: "session-approval",
      profile: "research",
      task: "Review code proposal",
      title: "Approval run",
      now: 100,
    });
    approvalSession = addAgentPendingApproval(approvalSession, {
      id: "approval-1",
      capability: "write_workspace",
      toolName: "workbench.createProposal",
      request: { name: "workbench.createProposal", args: {} },
      decision: {
        capability: "write_workspace",
        permission: "ask",
        requiresApproval: true,
        allowed: true,
      },
      now: 120,
    });
    const blockedSession = failAgentSession(createAgentSession({
      id: "session-blocked",
      profile: "research",
      task: "Fix typecheck",
      title: "Blocked run",
      now: 90,
    }), "Typecheck failed.", 130);
    const handoffSession = completeAgentSession(appendAgentTraceEvent(createAgentSession({
      id: "session-handoff",
      profile: "research",
      task: "Create handoff proposal",
      title: "Handoff run",
      now: 80,
    }), {
      kind: "proposal_created",
      message: "Workbench proposal created.",
      timestamp: 140,
      artifactId: "proposal-1",
    }), "Completed handoff.", 150);

    useAgentSessionStore.setState({
      sessions: [handoffSession, blockedSession, approvalSession],
      activeSessionId: "session-approval",
      focusTarget: null,
    });

    render(<AgentProtocolCenter />);

    expect(screen.getByText("3 sessions / 1 approvals / 1 blocked / 1 handoffs")).not.toBeNull();
    expect(screen.getByText("Approval run")).not.toBeNull();
    expect(screen.getByText("Blocked run")).not.toBeNull();
    expect(screen.getByText("Handoff run")).not.toBeNull();
    expect(screen.getByText("Typecheck failed.")).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "查看 Trace" })[1]);
    });

    expect(useAgentSessionStore.getState().activeSessionId).toBe("session-blocked");
    expect(useAgentSessionStore.getState().focusTarget).toBe("trace");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制协议" }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("Co-work Session Inbox:"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("Workspace risk: clean"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("Coding QA Runner:"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("session: session-blocked"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("detail: Typecheck failed."),
    );
  });

  it("surfaces an approval-gated coding QA plan without executing commands", async () => {
    const session = appendAgentTraceEvent(createAgentSession({
      id: "session-qa-plan",
      profile: "research",
      task: "Review coding QA plan",
      title: "QA plan run",
      now: 100,
    }), {
      kind: "proposal_created",
      message: "Created QA proposal.",
      timestamp: 120,
      targetPath: "src/lib/__tests__/ai-coding-qa-runner-view-model.test.ts",
    });

    useAgentSessionStore.setState({
      sessions: [session],
      activeSessionId: "session-qa-plan",
      focusTarget: null,
    });

    render(<AgentProtocolCenter />);

    const qaRunner = within(screen.getByTestId("coding-qa-runner"));
    expect(qaRunner.getByText("Approval-gated QA Runner")).not.toBeNull();
    expect(qaRunner.getByText(/approval-gated commands/)).not.toBeNull();
    expect(qaRunner.getByText(/npx vitest run/)).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制 QA 计划" }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("Coding QA Runner Plan"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("Execution boundary:"),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "创建审批请求" }));
    });

    const approvalSession = useAgentSessionStore.getState().getActiveSession();
    expect(approvalSession).toMatchObject({
      title: "Coding QA approval",
      status: "waiting_approval",
    });
    expect(approvalSession?.pendingApprovals[0]).toMatchObject({
      status: "pending",
      toolName: "runner.runCode",
      toolLabel: "Approval-gated QA Runner",
      request: {
        name: "runner.runCode",
      },
    });
    expect(approvalSession?.trace.map((event) => event.kind)).toEqual(
      expect.arrayContaining(["session_started", "approval_required"]),
    );
    expect(useAgentSessionStore.getState().focusTarget).toBe("trace");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "填入证据草稿" }));
    });

    expect(screen.getByDisplayValue("Coding QA Runner plan")).not.toBeNull();
    expect(screen.getByDisplayValue(/npx vitest run/)).not.toBeNull();
  });

  it("imports resolved coding QA approval results as evidence", async () => {
    const view = buildCodingQaRunnerViewModel({
      activeTabPath: "src/lib/__tests__/ai-coding-qa-runner-view-model.test.ts",
    });
    const request = buildCodingQaRunnerApprovalRequest(view, {
      now: 123,
      idPrefix: "qa-request",
    });
    const session = resolveAgentPendingApproval(addAgentPendingApproval(createAgentSession({
      id: "session-qa-import",
      profile: "research",
      task: "QA approval",
      title: "QA approval",
      now: 100,
    }), request.approval), {
      id: request.approval.id,
      status: "completed",
      resultPreview: "Runner output captured.",
      now: 140,
    });

    useAgentSessionStore.setState({
      sessions: [session],
      activeSessionId: "session-qa-import",
      focusTarget: null,
    });

    render(<AgentProtocolCenter />);

    expect(screen.getByText("Approval result evidence")).not.toBeNull();
    expect(screen.getByText("Coding QA Runner completed")).not.toBeNull();
    expect(screen.getAllByText("pending imports: 1").length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "导入证据" }));
    });

    expect(screen.getAllByText("Runner output captured.").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("pending imports: 0").length).toBeGreaterThanOrEqual(2);

    const storedEvidence = JSON.parse(window.localStorage.getItem("lattice-agent-protocol-evidence-v1") ?? "[]");
    expect(storedEvidence[0]).toMatchObject({
      importedKey: `coding-qa:${session.id}:${request.approval.id}:completed`,
      sourceKind: "coding-qa",
      sourceSessionId: session.id,
      sourceApprovalId: request.approval.id,
    });

    useAgentSessionStore.setState({ activeSessionId: null, focusTarget: null });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /查看来源 Trace/ }));
    });
    expect(useAgentSessionStore.getState().activeSessionId).toBe(session.id);
    expect(useAgentSessionStore.getState().focusTarget).toBe("trace");

    expect((screen.getByRole("button", { name: "已导入" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("1 条")).not.toBeNull();
  });

  it("focuses the QA evidence section from a protocol deep link", () => {
    const scrollIntoView = vi.fn();
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    window.location.hash = "#qa-evidence";
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    render(<AgentProtocolCenter />);

    expect(document.getElementById("qa-evidence")).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });

    window.location.hash = "";
    requestAnimationFrameSpy.mockRestore();
  });

  it("records the current validation progress into the dashboard", async () => {
    render(<AgentProtocolCenter />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "记录本轮验证" }));
    });

    expect(screen.getByText("/ 6")).not.toBeNull();
    expect(screen.getByText("18 / 18 项已确认")).not.toBeNull();
    expect(screen.getByText("6 / 6 已确认")).not.toBeNull();
    expect(screen.getByDisplayValue("完成 Agent Protocol Center 的真实工程落地与页面状态对齐")).not.toBeNull();
    expect(screen.getByText("Agent 协议中心组件与命令入口测试")).not.toBeNull();
    expect(screen.getByText("隔离 next dev 与 next build 的产物目录")).not.toBeNull();
    expect(hoisted.toastSuccess).toHaveBeenCalledWith("本轮验证结果已记录");
  });

  it("switches between workspace tabs", async () => {
    render(<AgentProtocolCenter />);

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /证据/ }));
    });

    expect(screen.getByRole("tab", { name: /证据/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("验证证据").closest("section")?.className).not.toContain("hidden");
    expect(screen.getByText("任务上下文").closest("section")?.parentElement?.className).toContain("hidden");

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /交接/ }));
    });

    expect(screen.getByRole("tab", { name: /交接/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("执行报告").closest("aside")?.className).not.toContain("hidden");
  });

  it("tracks checklist progress and exports checked items in Markdown", async () => {
    render(<AgentProtocolCenter />);

    const checkbox = screen.getByLabelText("Todo 状态板: 使用 update_plan 建立任务板");

    await act(async () => {
      fireEvent.click(checkbox);
    });

    expect(screen.getByText("1 / 18")).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制协议" }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("- [x] 使用 update_plan 建立任务板"),
    );
    expect(hoisted.toastSuccess).toHaveBeenCalledWith("Agent 协议已复制");
  });

  it("includes task context and closure gates in the exported protocol", async () => {
    render(<AgentProtocolCenter />);

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("例如：完善 Agent 协议中心并完成产品验证"), {
        target: { value: "继续深度开发 Agent 协议中心" },
      });
      fireEvent.change(screen.getByPlaceholderText("记录限制、用户要求、暂不执行的动作，例如：部署由用户自行执行，收尾时提醒桌面打包更新。"), {
        target: { value: "部署由用户自行执行，收尾时提醒桌面打包更新。" },
      });
      fireEvent.click(screen.getByLabelText("收尾门禁: 桌面产品打包更新"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制协议" }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("- 目标：继续深度开发 Agent 协议中心"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("- 备注：部署由用户自行执行，收尾时提醒桌面打包更新。"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("- [x] 桌面产品打包更新"),
    );
  });

  it("copies the generated dangerous operation confirmation text", async () => {
    render(<AgentProtocolCenter />);

    await act(async () => {
      fireEvent.change(screen.getByDisplayValue("代码提交 / 打包收尾"), {
        target: { value: "git commit" },
      });
      fireEvent.click(screen.getByRole("button", { name: "复制危险操作确认文本" }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("操作类型：git commit"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("请确认是否继续？"),
    );
    expect(hoisted.toastSuccess).toHaveBeenCalledWith("危险操作确认文本已复制");
  });

  it("records evidence and decisions in the exported protocol", async () => {
    render(<AgentProtocolCenter />);

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("例如：Agent 协议中心组件测试"), {
        target: { value: "组件测试" },
      });
      fireEvent.change(screen.getByPlaceholderText("例如：npx vitest run src/components/agent/__tests__/agent-protocol-center.test.tsx"), {
        target: { value: "npx vitest run agent-protocol-center.test.tsx" },
      });
      fireEvent.change(screen.getByPlaceholderText("例如：9 个用例通过，覆盖任务上下文、门禁和复制报告。"), {
        target: { value: "全部用例通过" },
      });
      fireEvent.click(screen.getByRole("button", { name: "记录证据" }));
    });

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("例如：保持 Agent 协议中心为本地优先单页工作台"), {
        target: { value: "保持本地优先" },
      });
      fireEvent.change(screen.getByPlaceholderText("例如：避免引入服务端状态，符合 Lattice 本地优先定位。"), {
        target: { value: "符合 Lattice 本地优先定位" },
      });
      fireEvent.change(screen.getByPlaceholderText("例如：所有记录保存在浏览器本地，导出 Markdown 作为跨环境交接材料。"), {
        target: { value: "导出 Markdown 作为交接材料" },
      });
      fireEvent.click(screen.getByRole("button", { name: "保存决策" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制协议" }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("## 验证证据"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("组件测试（通过）"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("## 决策记录"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("保持本地优先"),
    );
  });

  it("filters and edits evidence entries", async () => {
    render(<AgentProtocolCenter />);

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /证据/ }));
      fireEvent.change(screen.getByPlaceholderText("例如：Agent 协议中心组件测试"), {
        target: { value: "失败构建" },
      });
      fireEvent.change(screen.getByDisplayValue("通过"), {
        target: { value: "failed" },
      });
      fireEvent.change(screen.getByPlaceholderText("例如：9 个用例通过，覆盖任务上下文、门禁和复制报告。"), {
        target: { value: "构建失败" },
      });
      fireEvent.click(screen.getByRole("button", { name: "记录证据" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "通过" }));
    });
    expect(screen.getByText("当前筛选条件下暂无证据。")).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "失败" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "编辑证据: 失败构建" }));
    });

    expect(screen.getByDisplayValue("失败构建")).not.toBeNull();

    await act(async () => {
      fireEvent.change(screen.getByDisplayValue("失败构建"), {
        target: { value: "构建已修复" },
      });
      fireEvent.change(screen.getByDisplayValue("失败"), {
        target: { value: "passed" },
      });
      fireEvent.click(screen.getByRole("button", { name: "更新证据" }));
      fireEvent.click(screen.getByRole("button", { name: "全部" }));
    });

    expect(screen.getByText("构建已修复")).not.toBeNull();
    expect(screen.queryByText("失败构建")).toBeNull();
    expect(hoisted.toastSuccess).toHaveBeenCalledWith("验证证据已更新");
  });

  it("edits decision records", async () => {
    render(<AgentProtocolCenter />);

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /决策/ }));
      fireEvent.change(screen.getByPlaceholderText("例如：保持 Agent 协议中心为本地优先单页工作台"), {
        target: { value: "保留单页工作台" },
      });
      fireEvent.change(screen.getByPlaceholderText("例如：避免引入服务端状态，符合 Lattice 本地优先定位。"), {
        target: { value: "当前无需服务端状态" },
      });
      fireEvent.click(screen.getByRole("button", { name: "保存决策" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "编辑决策: 保留单页工作台" }));
    });

    await act(async () => {
      fireEvent.change(screen.getByDisplayValue("保留单页工作台"), {
        target: { value: "工作区 Tabs 化" },
      });
      fireEvent.click(screen.getByRole("button", { name: "更新决策" }));
    });

    expect(screen.getByText("工作区 Tabs 化")).not.toBeNull();
    expect(screen.queryByText("保留单页工作台")).toBeNull();
    expect(hoisted.toastSuccess).toHaveBeenCalledWith("决策记录已更新");
  });

  it("fills evidence from templates and shows closure gate evidence hints", async () => {
    render(<AgentProtocolCenter />);

    expect(screen.getAllByText("仍需验证证据").length).toBeGreaterThan(0);
    expect(screen.getByText("本地页面健康")).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /证据/ }));
      fireEvent.click(screen.getByRole("button", { name: "类型检查" }));
    });

    expect(screen.getByDisplayValue("类型检查")).not.toBeNull();
    expect(screen.getByDisplayValue("npm run typecheck")).not.toBeNull();
    expect(hoisted.toastSuccess).toHaveBeenCalledWith("验证模板已填入");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "记录证据" }));
      fireEvent.click(screen.getByRole("tab", { name: /执行/ }));
    });

    expect(screen.getAllByText("已有通过证据").length).toBeGreaterThan(0);
  });

  it("fills the dev-build isolation evidence template", async () => {
    render(<AgentProtocolCenter />);

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /证据/ }));
      fireEvent.click(screen.getByRole("button", { name: "Dev / Build 产物隔离回归" }));
    });

    expect(screen.getByDisplayValue("Dev / Build 产物隔离回归")).not.toBeNull();
    expect(screen.getByDisplayValue("npm run build && Invoke-WebRequest http://localhost:3000/agent-protocol")).not.toBeNull();
    expect(screen.getByDisplayValue("记录生产构建后本地 dev 页面仍返回 200，避免 web-dist 与 dev 产物互相覆盖造成 500。")).not.toBeNull();
  });

  it("copies a run snapshot and includes it in the exported protocol", async () => {
    render(<AgentProtocolCenter />);

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("例如：完善 Agent 协议中心并完成产品验证"), {
        target: { value: "记录运行快照" },
      });
      fireEvent.click(screen.getByRole("tab", { name: /交接/ }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制运行快照" }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("当前目标：记录运行快照"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("页面路径："),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制协议" }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("## 运行快照"),
    );
    expect(hoisted.toastSuccess).toHaveBeenCalledWith("运行快照已复制");
  });

  it("copies workbench context and includes it in the exported protocol", async () => {
    render(<AgentProtocolCenter />);

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /交接/ }));
    });

    expect(screen.getByText("工作台上下文")).not.toBeNull();
    expect(screen.getByText("未打开工作区")).not.toBeNull();
    expect(screen.getByText("pane-initial")).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制工作台上下文" }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("工作区：未打开工作区"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("活动 Pane：pane-initial"),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制协议" }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("## 工作台上下文"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("打开标签：0"),
    );
    expect(hoisted.toastSuccess).toHaveBeenCalledWith("工作台上下文已复制");
  });

  it("copies a handoff summary with current progress", async () => {
    render(<AgentProtocolCenter />);

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("例如：完善 Agent 协议中心并完成产品验证"), {
        target: { value: "生成交接摘要" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制交接摘要" }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("当前目标：生成交接摘要"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("验证证据：0 条"),
    );
    expect(hoisted.toastSuccess).toHaveBeenCalledWith("交接摘要已复制");
  });

  it("keeps only one stage in progress", async () => {
    render(<AgentProtocolCenter />);

    const todoStage = screen.getByText("Todo 状态板").closest("article");
    const responseStage = screen.getByText("结构化协作回复").closest("article");

    expect(todoStage).not.toBeNull();
    expect(responseStage).not.toBeNull();

    await act(async () => {
      fireEvent.click(within(todoStage as HTMLElement).getByRole("button", { name: "进行中" }));
    });
    await act(async () => {
      fireEvent.click(within(responseStage as HTMLElement).getByRole("button", { name: "进行中" }));
    });

    const activeInProgressButtons = screen
      .getAllByRole("button", { name: "进行中" })
      .filter((button) => button.getAttribute("aria-pressed") === "true");

    expect(activeInProgressButtons).toHaveLength(1);
    expect(within(responseStage as HTMLElement).getByRole("button", { name: "进行中" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("当前焦点").closest("div")?.parentElement?.textContent).toContain("结构化协作回复");
  });
});
