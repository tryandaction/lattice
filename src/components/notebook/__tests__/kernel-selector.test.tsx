/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KernelSelector, type KernelOption } from "../kernel-selector";

const detectPythonEnvironments = vi.hoisted(() => vi.fn());
const isTauriHostMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/runner/runner-manager", () => ({
  runnerManager: {
    detectPythonEnvironments,
  },
}));

vi.mock("@/lib/storage-adapter", () => ({
  isTauriHost: () => isTauriHostMock(),
}));

function Harness({
  initialKernel = null,
  onKernelChange,
  cwd,
}: {
  initialKernel?: KernelOption | null;
  onKernelChange: (kernel: KernelOption) => void;
  cwd?: string;
}) {
  const [kernel, setKernel] = useState<KernelOption | null>(initialKernel);

  return (
    <KernelSelector
      currentKernel={kernel}
      cwd={cwd}
      onKernelChange={(nextKernel) => {
        setKernel(nextKernel);
        onKernelChange(nextKernel);
      }}
    />
  );
}

describe("KernelSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("桌面端检测到本地 Python 时默认优先选择本地内核", async () => {
    isTauriHostMock.mockReturnValue(true);
    detectPythonEnvironments.mockResolvedValue([
      {
        path: "C:/Python312/python.exe",
        version: "3.12.2",
        envType: "system",
        source: "path",
      },
    ]);

    const onKernelChange = vi.fn();
    render(<Harness initialKernel={null} onKernelChange={onKernelChange} cwd="C:/workspace" />);

    await waitFor(() => {
      expect(onKernelChange).toHaveBeenCalledWith(expect.objectContaining({
        runnerType: "python-local",
        command: "C:/Python312/python.exe",
      }));
    });

    fireEvent.click(screen.getByRole("button", { name: /Python 3.12.2/ }));
    expect(screen.queryByText("Pyodide（应急回退）")).not.toBeNull();
  });

  it("桌面端当前停留在 Pyodide 时，探测到本地 Python 后会自动切回本地内核", async () => {
    isTauriHostMock.mockReturnValue(true);
    detectPythonEnvironments.mockResolvedValue([
      {
        path: "D:/envs/project/python.exe",
        version: "3.11.9",
        envType: "venv",
        name: "project",
        source: "workspace",
      },
    ]);

    const onKernelChange = vi.fn();
    const currentKernel: KernelOption = {
      id: "pyodide",
      runnerType: "python-pyodide",
      displayName: "Pyodide（应急回退）",
      description: "fallback",
    };

    render(<Harness initialKernel={currentKernel} onKernelChange={onKernelChange} cwd="D:/workspace" />);

    await waitFor(() => {
      expect(onKernelChange).toHaveBeenCalledWith(expect.objectContaining({
        runnerType: "python-local",
        command: "D:/envs/project/python.exe",
      }));
    });
  });

  it("网页环境只暴露浏览器内核文案，不伪装成桌面本地运行器", async () => {
    isTauriHostMock.mockReturnValue(false);
    detectPythonEnvironments.mockResolvedValue([]);

    const onKernelChange = vi.fn();
    render(<Harness initialKernel={null} onKernelChange={onKernelChange} />);

    await waitFor(() => {
      expect(onKernelChange).toHaveBeenCalledWith(expect.objectContaining({
        runnerType: "python-pyodide",
        displayName: "Pyodide（浏览器内核）",
      }));
    });

    fireEvent.click(screen.getByRole("button", { name: /Pyodide（浏览器内核）/ }));
    expect(screen.queryByText("当前环境：网页运行时")).not.toBeNull();
    expect(screen.queryByText("Browser")).not.toBeNull();
  });
});
