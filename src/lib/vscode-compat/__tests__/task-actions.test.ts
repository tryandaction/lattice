import { describe, expect, it } from "vitest";
import {
  buildNodeDebugLaunchRequest,
  buildPythonDebugLaunchRequest,
  buildVSCodeTaskActions,
  buildVSCodeTaskExecutionRequest,
} from "../task-actions";

describe("vscode compat task actions", () => {
  it("builds command bar actions from imported tasks", () => {
    const actions = buildVSCodeTaskActions([
      {
        label: "build",
        type: "shell",
        command: "npm",
        args: ["run", "build"],
      },
    ], {
      workspaceRootPath: "workspace",
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("vscode-task:0");
    expect(actions[0]?.label).toBe("build");
    expect(actions[0]?.tooltip).toContain("npm run build");
  });

  it("builds executable runner requests for VS Code shell tasks", () => {
    const request = buildVSCodeTaskExecutionRequest({
      label: "build",
      type: "shell",
      command: "npm",
      args: ["run", "build"],
      cwd: "app",
      env: {
        NODE_ENV: "production",
      },
    }, {
      workspaceRootPath: "workspace",
    });

    expect(request.runnerType).toBe("external-command");
    expect(request.cwd).toBe("app");
    expect(request.env).toEqual({ NODE_ENV: "production" });
    expect(request.mode).toBe("file");
    expect([["cmd", ["/C", "npm run build"]], ["sh", ["-lc", "npm run build"]]]).toContainEqual([
      request.command,
      request.args,
    ]);
  });

  it("builds a Python debug request from the active workspace file", () => {
    const result = buildPythonDebugLaunchRequest({
      name: "Debug current file",
      type: "debugpy",
      request: "launch",
      program: "${file}",
      cwd: "${fileDirname}",
      args: ["--mode", "test"],
      env: { LATTICE_DEBUG: "1" },
      justMyCode: false,
      stopOnEntry: true,
      subProcess: false,
    }, {
      workspaceRootPath: "C:/workspace",
      activeFilePath: "C:/workspace/pkg/app.py",
      defaultPythonPath: "C:/Python313/python.exe",
    });

    expect(result).toEqual({
      supported: true,
      request: {
        kind: "python",
        name: "Debug current file",
        workspaceRootPath: "C:/workspace",
        python: "C:/Python313/python.exe",
        target: { kind: "program", value: "C:/workspace/pkg/app.py" },
        cwd: "C:/workspace/pkg",
        args: ["--mode", "test"],
        env: { LATTICE_DEBUG: "1" },
        justMyCode: false,
        stopOnEntry: true,
        subProcess: false,
      },
    });
  });

  it("rejects launch configurations with ambiguous or unresolved targets", () => {
    const ambiguous = buildPythonDebugLaunchRequest({
      name: "Ambiguous",
      type: "python",
      request: "launch",
      program: "app.py",
      module: "pkg.app",
      args: [],
    }, { workspaceRootPath: "C:/workspace" });
    const unresolved = buildPythonDebugLaunchRequest({
      name: "Unresolved",
      type: "python",
      request: "launch",
      program: "${env:PYTHON_FILE}",
      args: [],
    }, { workspaceRootPath: "C:/workspace" });
    const node = buildPythonDebugLaunchRequest({
      name: "Node",
      type: "pwa-node",
      request: "launch",
      program: "app.js",
      args: [],
    }, { workspaceRootPath: "C:/workspace" });

    expect(ambiguous).toEqual({
      supported: false,
      reason: "Python debugging requires exactly one program or module target.",
    });
    expect(unresolved).toEqual({
      supported: false,
      reason: "Unsupported or unresolved VS Code variable in program: ${env:PYTHON_FILE}",
    });
    expect(node).toEqual({
      supported: false,
      reason: "Real debugging is not available yet for pwa-node launch configurations.",
    });
  });

  it("builds a Node js-debug request from the active workspace file", () => {
    const result = buildNodeDebugLaunchRequest({
      name: "Debug current Node file",
      type: "pwa-node",
      request: "launch",
      program: "${file}",
      cwd: "${workspaceFolder}",
      runtimeExecutable: "node",
      runtimeArgs: ["--enable-source-maps"],
      args: ["--mode", "test"],
      env: { NODE_ENV: "development" },
      console: "internalConsole",
      stopOnEntry: true,
      sourceMaps: true,
      smartStep: true,
      skipFiles: ["<node_internals>/**"],
      outFiles: ["${workspaceFolder}/dist/**/*.js"],
    }, {
      workspaceRootPath: "C:/workspace",
      activeFilePath: "C:/workspace/src/app.js",
    });

    expect(result).toEqual({
      supported: true,
      request: {
        kind: "node",
        name: "Debug current Node file",
        workspaceRootPath: "C:/workspace",
        program: "C:/workspace/src/app.js",
        cwd: "C:/workspace",
        runtimeExecutable: "node",
        runtimeArgs: ["--enable-source-maps"],
        args: ["--mode", "test"],
        env: { NODE_ENV: "development" },
        stopOnEntry: true,
        sourceMaps: true,
        smartStep: true,
        skipFiles: ["<node_internals>/**"],
        outFiles: ["C:/workspace/dist/**/*.js"],
      },
    });
  });

  it("rejects unsupported Node debug launch variants truthfully", () => {
    const base = {
      name: "Node",
      type: "pwa-node",
      request: "launch",
      program: "app.js",
      args: [],
    };

    expect(buildNodeDebugLaunchRequest({ ...base, request: "attach" }, {
      workspaceRootPath: "C:/workspace",
    })).toEqual({ supported: false, reason: "Node attach configurations are not supported yet." });
    expect(buildNodeDebugLaunchRequest({ ...base, type: "pwa-chrome" }, {
      workspaceRootPath: "C:/workspace",
    })).toEqual({ supported: false, reason: "Real Node debugging is not available for pwa-chrome launch configurations." });
    expect(buildNodeDebugLaunchRequest({ ...base, program: undefined }, {
      workspaceRootPath: "C:/workspace",
    })).toEqual({ supported: false, reason: "Node debugging requires a program target." });
    expect(buildNodeDebugLaunchRequest({ ...base, program: "${env:NODE_FILE}" }, {
      workspaceRootPath: "C:/workspace",
    })).toEqual({
      supported: false,
      reason: "Unsupported or unresolved VS Code variable in program: ${env:NODE_FILE}",
    });
    expect(buildNodeDebugLaunchRequest({ ...base, console: "integratedTerminal" }, {
      workspaceRootPath: "C:/workspace",
    })).toEqual({
      supported: false,
      reason: "Node debugging currently supports only the internal console.",
    });
    expect(buildNodeDebugLaunchRequest({ ...base, outFiles: ["../dist/**/*.js"] }, {
      workspaceRootPath: "C:/workspace",
    })).toEqual({
      supported: false,
      reason: "Node debug outFiles must stay inside the workspace.",
    });
  });
});
