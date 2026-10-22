import { describe, expect, it } from "vitest";
import { jupyterOutputsToExecutionOutputs } from "../output-utils";
import type { JupyterOutput } from "@/lib/notebook-utils";

describe("jupyterOutputsToExecutionOutputs", () => {
  it("suppresses empty generic notebook error shells emitted by VS Code/Jupyter metadata", () => {
    const outputs: JupyterOutput[] = [
      {
        output_type: "display_data",
        data: { "image/png": "plot" },
      },
      {
        output_type: "error",
        ename: "ExecutionError",
        evalue: ":",
        traceback: ["", "   "],
      },
    ];

    expect(jupyterOutputsToExecutionOutputs(outputs)).toEqual([
      { type: "image", content: "data:image/png;base64,plot" },
    ]);
  });

  it("keeps real notebook errors even when the message is short", () => {
    const outputs: JupyterOutput[] = [
      {
        output_type: "error",
        ename: "NameError",
        evalue: "",
        traceback: ['File "<ipython-input-1>", line 1', "NameError"],
      },
    ];

    expect(jupyterOutputsToExecutionOutputs(outputs)).toEqual([
      {
        type: "error",
        content: "NameError:",
        errorName: "NameError",
        errorValue: "",
        traceback: ['File "<ipython-input-1>", line 1', "NameError"],
      },
    ]);
  });
});
