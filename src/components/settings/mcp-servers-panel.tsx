"use client";

import { useState } from "react";
import { Plus, Server, Trash2 } from "lucide-react";
import { normalizeMcpServerConfig, type McpServerConfig, type McpTransport } from "@/lib/ai/mcp-config";
import { useI18n } from "@/hooks/use-i18n";

export interface McpServersPanelProps {
  servers: McpServerConfig[];
  onChange: (servers: McpServerConfig[]) => void;
}

export function McpServersPanel({ servers, onChange }: McpServersPanelProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpTransport>("streamable-http");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [approval, setApproval] = useState<McpServerConfig["approval"]>("ask");
  const [error, setError] = useState<"settings.mcp.error.command" | "settings.mcp.error.url" | null>(null);

  const addServer = () => {
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `mcp-${Date.now()}`;
    const config = normalizeMcpServerConfig({
      id,
      name,
      transport,
      url: transport === "streamable-http" ? url : undefined,
      command: transport === "stdio" ? command : undefined,
      enabled: true,
      approval,
      tools: [],
      resources: [],
      prompts: [],
    });
    if (!config) {
      setError(transport === "stdio" ? "settings.mcp.error.command" : "settings.mcp.error.url");
      return;
    }
    setError(null);
    onChange([...servers, config]);
    setName("");
    setUrl("");
    setCommand("");
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-3" data-testid="mcp-servers-panel">
      <div className="flex items-start gap-2"><Server className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><div className="text-sm font-medium">{t("settings.mcp.title")}</div><p className="mt-1 text-xs text-muted-foreground">{t("settings.mcp.description")}</p></div></div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-[11px] text-muted-foreground">{t("settings.mcp.name")}<input aria-label={t("settings.mcp.nameLabel")} value={name} onChange={(event) => setName(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs" placeholder={t("settings.mcp.namePlaceholder")} /></label>
        <label className="grid gap-1 text-[11px] text-muted-foreground">{t("settings.mcp.transport")}<select aria-label={t("settings.mcp.transportLabel")} value={transport} onChange={(event) => setTransport(event.target.value as McpTransport)} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"><option value="streamable-http">Streamable HTTP</option><option value="stdio">stdio</option></select></label>
      </div>
      {transport === "stdio" ? <label className="grid gap-1 text-[11px] text-muted-foreground">{t("settings.mcp.command")}<input aria-label={t("settings.mcp.commandLabel")} value={command} onChange={(event) => setCommand(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono" placeholder="npx -y @modelcontextprotocol/server-filesystem" /></label> : <label className="grid gap-1 text-[11px] text-muted-foreground">URL<input aria-label={t("settings.mcp.urlLabel")} type="url" value={url} onChange={(event) => setUrl(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs" placeholder="https://example.com/mcp" /></label>}
      <div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-[11px] text-muted-foreground">{t("settings.mcp.approval")}<select aria-label={t("settings.mcp.approvalLabel")} value={approval} onChange={(event) => setApproval(event.target.value as McpServerConfig["approval"])} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"><option value="ask">{t("settings.mcp.approval.ask")}</option><option value="always">{t("settings.mcp.approval.always")}</option><option value="never">{t("settings.mcp.approval.never")}</option></select></label><button type="button" aria-label={t("settings.mcp.add")} onClick={addServer} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent"><Plus className="h-3.5 w-3.5" /> {t("settings.mcp.add")}</button></div>
      {error ? <p role="alert" className="text-xs text-destructive">{t(error)}</p> : null}
      {servers.length > 0 ? <div className="space-y-1 border-t border-border/60 pt-2">{servers.map((server) => <div key={server.id} className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs"><span className="min-w-0 flex-1 truncate"><span className="font-medium">{server.name}</span><span className="ml-2 text-muted-foreground">{server.transport} · {t(`settings.mcp.approval.${server.approval}`)}</span></span><button type="button" aria-label={t("settings.mcp.delete", { name: server.name })} onClick={() => onChange(servers.filter((candidate) => candidate.id !== server.id))} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div> : null}
    </section>
  );
}
