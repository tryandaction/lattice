import { describe, expect, it } from "vitest";
import { mergeExecutionProblems, outputsToExecutionProblems } from "@/lib/runner/problem-utils";
import type { ExecutionProblem, ExecutionOutput } from "@/lib/runner/types";

describe("runner problem utils", () => {
  it("从文件 traceback 中提取行号", () => {
    const outputs: ExecutionOutput[] = [
      {
        type: "error",
        content: "ValueError: broken",
        errorName: "ValueError",
        errorValue: "broken",
        traceback: ['Traceback...', '  File "C:/workspace/demo.py", line 12, in <module>', "ValueError: broken"],
      },
    ];

    const problems = outputsToExecutionProblems(outputs, {
      kind: "file",
      filePath: "C:/workspace/demo.py",
      fileName: "demo.py",
    });

    expect(problems).toHaveLength(1);
    expect(problems[0].context?.line).toBe(12);
  });

  it("将 markdown block 内联 traceback 映射回文档行号", () => {
    const outputs: ExecutionOutput[] = [
      {
        type: "error",
        content: "RuntimeError: failed",
        errorName: "RuntimeError",
        errorValue: "failed",
        traceback: ['Traceback...', '  File "<lattice-inline>", line 2, in <module>', "RuntimeError: failed"],
      },
    ];

    const problems = outputsToExecutionProblems(outputs, {
      kind: "markdown-block",
      filePath: "notes/demo.md",
      blockKey: "notes/demo.md#block:0:python",
      range: {
        from: 10,
        to: 42,
        startLine: 20,
        endLine: 24,
      },
    });

    expect(problems).toHaveLength(1);
    expect(problems[0].context?.line).toBe(22);
  });

  it("从 stderr 编译器输出中提取可跳转问题", () => {
    const outputs: ExecutionOutput[] = [
      {
        type: "text",
        channel: "stderr",
        content: "src/main.c:12:5: error: expected ';' before 'return'\n",
      },
    ];

    const problems = outputsToExecutionProblems(outputs, {
      kind: "file",
      filePath: "src/main.c",
      fileName: "main.c",
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      source: "runtime",
      severity: "error",
      title: "编译错误",
      message: "expected ';' before 'return'",
      context: {
        filePath: "src/main.c",
        line: 12,
        column: 5,
      },
    });
  });

  it("从 Node stderr stack frame 中提取可跳转问题", () => {
    const outputs: ExecutionOutput[] = [
      {
        type: "text",
        channel: "stderr",
        content: "TypeError: broken\n    at Object.<anonymous> (C:\\workspace\\demo.js:3:7)\n",
      },
    ];

    const problems = outputsToExecutionProblems(outputs);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      source: "runtime",
      severity: "error",
      title: "运行错误位置",
      context: {
        filePath: "C:\\workspace\\demo.js",
        line: 3,
        column: 7,
      },
    });
  });

  it("合并问题时按 id 去重", () => {
    const problem: ExecutionProblem = {
      id: "same",
      severity: "error",
      source: "runtime",
      title: "Error",
      message: "broken",
    };

    const merged = mergeExecutionProblems([problem], [problem]);
    expect(merged).toHaveLength(1);
  });
});
