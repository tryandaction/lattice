import type { JupyterOutput } from "@/lib/notebook-utils";
import type { ExecutionOutput, RunnerEvent } from "@/lib/runner/types";

function normalizeText(value: string | string[] | undefined): string {
  if (!value) {
    return "";
  }
  return Array.isArray(value) ? value.join("") : value;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function hasSemanticText(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return /[\p{L}\p{N}]/u.test(stripAnsi(value).trim());
}

function isGenericNotebookErrorShell(output: JupyterOutput): boolean {
  if (output.output_type !== "error") {
    return false;
  }

  const errorName = stripAnsi(output.ename ?? "").trim();
  const errorValue = stripAnsi(output.evalue ?? "").trim();
  const traceback = (output.traceback ?? []).map((line) => stripAnsi(line).trim()).filter(Boolean);
  const genericName = !errorName || errorName === "Error" || errorName === "ExecutionError";

  return genericName && !hasSemanticText(errorValue) && !traceback.some(hasSemanticText);
}

export function runnerEventToExecutionOutputs(event: RunnerEvent): ExecutionOutput[] {
  switch (event.type) {
    case "stdout":
    case "stderr":
      return [{ type: "text", content: event.payload.text, channel: event.payload.channel }];
    case "display_data":
      if (event.payload.data["image/png"]) {
        return [{ type: "image", content: `data:image/png;base64,${event.payload.data["image/png"]}` }];
      }
      if (event.payload.data["image/jpeg"]) {
        return [{ type: "image", content: `data:image/jpeg;base64,${event.payload.data["image/jpeg"]}` }];
      }
      if (event.payload.data["image/svg+xml"]) {
        return [{ type: "svg", content: event.payload.data["image/svg+xml"] }];
      }
      if (event.payload.data["text/html"]) {
        return [{ type: "html", content: event.payload.data["text/html"] }];
      }
      if (event.payload.data["text/plain"]) {
        return [{ type: "text", content: event.payload.data["text/plain"] }];
      }
      return [];
    case "error":
      return [
        {
          type: "error",
          content: event.payload.traceback?.length
            ? `${event.payload.message}\n\n${event.payload.traceback.join("\n")}`
            : event.payload.message,
          errorName: event.payload.ename,
          errorValue: event.payload.evalue ?? event.payload.message,
          traceback: event.payload.traceback,
        },
      ];
    default:
      return [];
  }
}

export function jupyterOutputToExecutionOutputs(output: JupyterOutput): ExecutionOutput[] {
  if (output.output_type === "stream") {
    return [
      {
        type: "text",
        content: normalizeText(output.text),
        channel: output.name === "stderr" ? "stderr" : output.name === "stdout" ? "stdout" : undefined,
      },
    ];
  }

  if (output.output_type === "execute_result" || output.output_type === "display_data") {
    const data = output.data;
    if (!data) {
      return [];
    }
    if (data["image/png"]) {
      return [{ type: "image", content: `data:image/png;base64,${data["image/png"]}` }];
    }
    if (data["image/jpeg"]) {
      return [{ type: "image", content: `data:image/jpeg;base64,${data["image/jpeg"]}` }];
    }
    if (data["image/svg+xml"]) {
      return [{ type: "svg", content: normalizeText(data["image/svg+xml"]) }];
    }
    if (data["text/html"]) {
      return [{ type: "html", content: normalizeText(data["text/html"]) }];
    }
    if (data["text/plain"]) {
      return [{ type: "text", content: normalizeText(data["text/plain"]) }];
    }
  }

  if (output.output_type === "error") {
    if (isGenericNotebookErrorShell(output)) {
      return [];
    }
    const traceback = output.traceback
      ?.map((line) => stripAnsi(line).trimEnd())
      .filter((line) => line.trim().length > 0);
    return [
      {
        type: "error",
        content: `${output.ename ?? "Error"}: ${output.evalue ?? ""}`.trim(),
        errorName: output.ename,
        errorValue: output.evalue,
        traceback,
      },
    ];
  }

  return [];
}

export function jupyterOutputsToExecutionOutputs(outputs: JupyterOutput[] | undefined): ExecutionOutput[] {
  if (!outputs?.length) {
    return [];
  }
  return outputs.flatMap((output) => jupyterOutputToExecutionOutputs(output));
}
