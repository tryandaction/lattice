import type { JupyterOutput } from "@/lib/notebook-utils";
import type { ExecutionOutput, RunnerEvent } from "@/lib/runner/types";

function normalizeText(value: string | string[] | undefined): string {
  if (!value) {
    return "";
  }
  return Array.isArray(value) ? value.join("") : value;
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
    return [
      {
        type: "error",
        content: `${output.ename ?? "Error"}: ${output.evalue ?? ""}`.trim(),
        errorName: output.ename,
        errorValue: output.evalue,
        traceback: output.traceback,
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
