export type McpTransport = "stdio" | "streamable-http";
export type McpApprovalMode = "ask" | "always" | "never";

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
  approval: McpApprovalMode;
  tools: string[];
  resources: string[];
  prompts: string[];
}

export interface McpValidationResult {
  ok: boolean;
  errors: string[];
  config?: McpServerConfig;
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())));
}

export function validateMcpServerConfig(input: Partial<McpServerConfig>): McpValidationResult {
  const errors: string[] = [];
  if (!input.id?.trim()) errors.push("Server id is required.");
  if (!input.name?.trim()) errors.push("Server name is required.");
  if (input.transport !== "stdio" && input.transport !== "streamable-http") errors.push("Transport must be stdio or streamable-http.");
  if (input.transport === "stdio" && !input.command?.trim()) errors.push("stdio servers require a command.");
  if (input.transport === "streamable-http") {
    if (!input.url?.trim()) errors.push("Streamable HTTP servers require a URL.");
    else {
      try {
        const url = new URL(input.url);
        if (url.protocol !== "https:") errors.push("Remote MCP URLs must use HTTPS.");
      } catch {
        errors.push("MCP URL is invalid.");
      }
    }
  }
  if (input.approval !== "ask" && input.approval !== "always" && input.approval !== "never") errors.push("Approval mode is invalid.");
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    config: {
      id: input.id!.trim(),
      name: input.name!.trim(),
      transport: input.transport!,
      ...(input.command?.trim() ? { command: input.command.trim() } : {}),
      args: normalizeList(input.args),
      ...(input.url?.trim() ? { url: input.url.trim() } : {}),
      enabled: input.enabled !== false,
      approval: input.approval!,
      tools: normalizeList(input.tools),
      resources: normalizeList(input.resources),
      prompts: normalizeList(input.prompts),
    },
  };
}

export function normalizeMcpServerConfig(input: Partial<McpServerConfig>): McpServerConfig | null {
  return validateMcpServerConfig(input).config ?? null;
}
