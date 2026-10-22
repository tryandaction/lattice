"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleOff, ExternalLink, Play, RefreshCw, Trash2 } from "lucide-react";
import { getAvailablePlugins } from "@/lib/plugins/registry";
import {
  getPluginAuditLog,
  getPluginHealthSnapshot,
  subscribePluginAudit,
  subscribePluginHealth,
  getPluginSetting,
  runPluginCommand,
  setPluginSetting,
  subscribePluginSetting,
  syncPlugins,
  getCommandsForPlugin,
  subscribePluginRegistry,
} from "@/lib/plugins/runtime";
import { usePluginStore } from "@/stores/plugin-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { PluginHealth } from "@/lib/plugins/runtime";
import type { PluginCommand, PluginManifest, PluginPermission } from "@/lib/plugins/types";
import { getPluginPermissionMeta, getPluginPermissionRisk } from "@/lib/plugins/permission-catalog";
import { useI18n } from "@/hooks/use-i18n";
import { probeFormulaOcrBackend,type FormulaOcrAvailability } from '@/lib/formula-ocr';

export interface PluginsPanelProps {
  onOpenGuide?: () => void;
  onPluginsChanged?: () => void | Promise<void>;
  onOpenResult?: (commandId: string) => void | Promise<void>;
}

function statusLabel(status: PluginHealth["status"] | undefined, enabled: boolean, zh: boolean) {
  if (status === "error") return zh ? "错误" : "Error";
  if (status === "active") return zh ? "运行中" : "Running";
  if (enabled) return zh ? "已启用（等待运行时）" : "Enabled (waiting for runtime)";
  return zh ? "已停用" : "Disabled";
}

const formulaCommandLabelsZh: Record<string, string> = {
  'formula-extractor.extract.document': '识别全文公式',
  'formula-extractor.extract.current-page': '识别当前页公式',
  'formula-extractor.extract.selection': '识别所选公式',
  'formula-extractor.ocr.selection': 'OCR 所选公式区域',
  'formula-extractor.export-markdown': '导出 Markdown',
  'formula-extractor.export-latex': '导出 LaTeX',
};

function commandLabel(command: PluginCommand, zh: boolean): string {
  return zh && command.id in formulaCommandLabelsZh ? formulaCommandLabelsZh[command.id] : command.title;
}

export function PluginsPanel({ onOpenGuide, onPluginsChanged, onOpenResult }: PluginsPanelProps) {
  const { locale, t } = useI18n();
  const zh = locale !== "en-US";
  const settings = useSettingsStore((state) => state.settings);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const { plugins, isLoading, error, loadPlugins, removePlugin } = usePluginStore();
  const [health, setHealth] = useState<Record<string, PluginHealth>>(() => getPluginHealthSnapshot());
  const [audit, setAudit] = useState(() => getPluginAuditLog());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runningCommand, setRunningCommand] = useState<string | null>(null);
  const [settingValues, setSettingValues] = useState<Record<string, Record<string, unknown>>>({});
  const [registryVersion,setRegistryVersion]=useState(0);
  const [networkHosts,setNetworkHosts]=useState(()=>settings.pluginNetworkAllowlist.join('\n'));
  const [ocrStatus,setOcrStatus]=useState<FormulaOcrAvailability|null>(null);
  const [ocrChecking,setOcrChecking]=useState(false);
  const tr=useCallback((en:string,cn:string)=>zh?cn:en,[zh]);
  const persistSettings = useCallback(async (updates: Parameters<typeof updateSettings>[0]) => {
    const persisted = await updateSettings(updates);
    if (persisted === false) {
      throw new Error(useSettingsStore.getState().error ?? tr('Failed to save plugin settings.', '插件设置保存失败。'));
    }
  }, [tr, updateSettings]);
  const applyRuntime=useCallback(async()=>{
    const next=useSettingsStore.getState().settings;
    await syncPlugins({pluginsEnabled:next.pluginsEnabled,enabledPluginIds:next.enabledPlugins.filter(id=>next.trustedPlugins.includes(id))});
  },[]);

  useEffect(() => {
    void loadPlugins();
    const unsubscribeHealth = subscribePluginHealth(() => setHealth(getPluginHealthSnapshot()));
    const unsubscribeAudit = subscribePluginAudit(() => setAudit(getPluginAuditLog()));
    const unsubscribeRegistry=subscribePluginRegistry(()=>setRegistryVersion(v=>v+1));
    return () => {
      unsubscribeHealth();
      unsubscribeAudit();
      unsubscribeRegistry();
    };
  }, [loadPlugins]);

  const manifests = useMemo(() => {
    const byId = new Map<string, PluginManifest>();
    getAvailablePlugins().forEach((manifest) => byId.set(manifest.id, manifest));
    plugins.forEach((plugin) => byId.set(plugin.manifest.id, plugin.manifest));
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [plugins]);

  useEffect(() => {
    let disposed = false;
    const unsubscribers: Array<() => void> = [];
    const hydrate = async () => {
      const values: Record<string, Record<string, unknown>> = {};
      for (const manifest of manifests) {
        const fields = manifest.settings ?? manifest.contributes?.settings ?? [];
        for (const field of fields) {
          const value = getPluginSetting(manifest.id, field.id);
          if (value !== undefined && value !== null) (values[manifest.id] ??= {})[field.id] = value;
          unsubscribers.push(subscribePluginSetting(manifest.id, field.id, (next) => {
            if (!disposed) setSettingValues((current) => ({ ...current, [manifest.id]: { ...current[manifest.id], [field.id]: next } }));
          }));
        }
      }
      if (!disposed) setSettingValues((current) => ({ ...values, ...current }));
    };
    void hydrate();
    return () => { disposed = true; unsubscribers.forEach((unsubscribe) => unsubscribe()); };
  }, [manifests]);

  const toggle = useCallback(async (manifest: PluginManifest, enabled: boolean) => {
    setBusyId(manifest.id);
    setLocalError(null);
    const previous = settings.enabledPlugins;
    const next = enabled
      ? Array.from(new Set([...previous, manifest.id]))
      : previous.filter((id) => id !== manifest.id);
    try {
      await persistSettings({ enabledPlugins: next });
      await applyRuntime();
      if(enabled && getPluginHealthSnapshot()[manifest.id]?.status!=='active')throw new Error(getPluginHealthSnapshot()[manifest.id]?.lastError??'Plugin activation did not complete.');
      await onPluginsChanged?.();
      // syncPlugins runs from the app shell; allow its health subscription to
      // report activation failure without claiming that persistence succeeded.
    } catch (cause) {
      await updateSettings({ enabledPlugins: previous }).catch(()=>{});
      setLocalError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }, [onPluginsChanged, settings.enabledPlugins, persistSettings, updateSettings,applyRuntime]);

  const uninstall = useCallback(async (manifest: PluginManifest) => {
    setBusyId(manifest.id);
    setLocalError(null);
    try {
      await removePlugin(manifest.id);
      await onPluginsChanged?.();
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }, [onPluginsChanged, removePlugin]);

  const installZip = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setLocalError(null);
      try {
        await usePluginStore.getState().installFromZip(file);
        await loadPlugins();
        await onPluginsChanged?.();
      } catch (cause) {
        setLocalError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    input.click();
  }, [loadPlugins, onPluginsChanged]);

  const setTrusted = useCallback(async (manifest: PluginManifest, trusted: boolean) => {
    const previous = settings.trustedPlugins;
    const next = trusted
      ? Array.from(new Set([...previous, manifest.id]))
      : previous.filter((id) => id !== manifest.id);
    try {
      await persistSettings({ trustedPlugins: next,enabledPlugins:trusted?settings.enabledPlugins:settings.enabledPlugins.filter((id) => id !== manifest.id) });
      await applyRuntime();
      await onPluginsChanged?.();
    } catch (cause) {
      await updateSettings({ trustedPlugins: previous }).catch(()=>{});
      setLocalError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [onPluginsChanged, settings.enabledPlugins, settings.trustedPlugins, persistSettings, updateSettings,applyRuntime]);

  const updatePluginSetting = useCallback(async (pluginId: string, fieldId: string, value: unknown) => {
    setLocalError(null);
    const previous = settingValues[pluginId]?.[fieldId] ?? getPluginSetting(pluginId, fieldId);
    setSettingValues((current) => ({ ...current, [pluginId]: { ...current[pluginId], [fieldId]: value } }));
    try {
      await setPluginSetting(pluginId, fieldId, value);
    } catch (cause) {
      setSettingValues((current) => {
        const next = { ...current, [pluginId]: { ...current[pluginId] } };
        next[pluginId][fieldId] = previous;
        return next;
      });
      setLocalError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [settingValues]);

  const runCommand = useCallback(async (command: PluginCommand) => {
    const commandId=command.id;
    setRunningCommand(commandId);
    setLocalError(null);
    try {
      if (command.opensPanel) {
        await onOpenResult?.(commandId);
      }
      await runPluginCommand(commandId);
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunningCommand(null);
    }
  }, [onOpenResult]);

  const installDirectory=async()=>{
    setLocalError(null);
    try {
      const picker=(window as Window & {showDirectoryPicker?:()=>Promise<FileSystemDirectoryHandle>}).showDirectoryPicker;
      if(!picker)throw new Error(tr('Directory import is unavailable in this browser. Use a ZIP package.','当前浏览器不支持目录导入，请使用 ZIP 插件包。'));
      await usePluginStore.getState().installFromDirectory(await picker());await onPluginsChanged?.();
    } catch(cause){if(!(cause instanceof DOMException&&cause.name==='AbortError'))setLocalError(cause instanceof Error?cause.message:String(cause));}
  };

  const renderError = localError ?? error;
  return (
    <section className="space-y-4" aria-label={tr("Plugins", "插件")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{zh ? "插件中心" : "Plugins"}</h2>
          <p className="text-sm text-muted-foreground">{zh ? "发现、启用、诊断和卸载 Lattice 插件。" : "Discover, enable, diagnose, and remove Lattice plugins."}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs" onClick={() => void installZip()}><ExternalLink className="h-3.5 w-3.5" /> {zh ? "安装 ZIP" : "Install ZIP"}</button>
          <button type="button" className="rounded-md border border-border px-2 py-1 text-xs" onClick={()=>void installDirectory()}>{tr('Import directory','导入目录')}</button>
          <button type="button" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs" onClick={() => void loadPlugins()} disabled={isLoading}>
            <RefreshCw className="h-3.5 w-3.5" /> {isLoading ? (zh ? "刷新中…" : "Refreshing…") : (zh ? "刷新" : "Refresh")}
          </button>
          {onOpenGuide && <button type="button" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs" onClick={onOpenGuide}><ExternalLink className="h-3.5 w-3.5" /> {tr('Guide','开发指南')}</button>}
        </div>
      </div>
      {renderError && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{renderError}</div>}
      <div className="space-y-2">
        {manifests.map((manifest) => {
          const enabled = settings.enabledPlugins.includes(manifest.id);
          const pluginHealth = health[manifest.id];
          const installed = plugins.some((plugin) => plugin.manifest.id === manifest.id);
          const trusted = settings.trustedPlugins.includes(manifest.id);
          const status = pluginHealth?.status;
          const settingsFields = manifest.settings ?? manifest.contributes?.settings ?? [];
          void registryVersion;
          const commands = getCommandsForPlugin(manifest.id).filter(command=>!command.id.includes('copy-formula')&&!command.id.includes('reveal-formula')&&!command.id.includes('update-formula')&&!command.id.endsWith('cancel')&&!command.id.endsWith('retry'));
          const isExpanded = expandedId === manifest.id;
          return (
            <article key={manifest.id} className="rounded-lg border border-border p-3" data-plugin-id={manifest.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-medium">{zh&&manifest.id==='formula-extractor'?'公式提取':manifest.name}</h3>
                  <p className="text-xs text-muted-foreground">{zh&&manifest.id==='formula-extractor'?'提取 PDF 原生结构、Markdown 和 Word 中的公式，校正后复制或导出。':manifest.description ?? manifest.id}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{manifest.version}</span>
                    <span>{installed?tr('Installed package','已安装包'):tr('Built-in','内置')}</span>
                    <span className="inline-flex items-center gap-1" data-plugin-status={status??'inactive'}>
                      {status === "error" ? <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> : status==='active' ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : <CircleOff className="h-3.5 w-3.5" />}
                      {statusLabel(status, enabled, zh)}
                    </span>
                  </div>
                  {pluginHealth?.lastError && <p className="mt-1 text-xs text-destructive">{pluginHealth.lastError}</p>}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button type="button" className="rounded-md border border-border px-2 py-1 text-xs" disabled={busyId === manifest.id} onClick={() => trusted ? void toggle(manifest, !enabled) : setExpandedId(manifest.id)}>{enabled ? tr('Disable','停用') : trusted ? tr('Enable','启用') : tr('Review permissions','查看权限')}</button>
                  <button type="button" className="rounded-md border border-border px-2 py-1 text-xs" onClick={() => setExpandedId(isExpanded ? null : manifest.id)}>{isExpanded ? tr('Hide','收起') : tr('Details','详情与设置')}</button>
                  {installed && <button type="button" aria-label={`${tr('Remove','卸载')} ${manifest.name}`} className="rounded-md border border-destructive/40 p-1.5 text-destructive" disabled={busyId === manifest.id} onClick={() => void uninstall(manifest)}><Trash2 className="h-3.5 w-3.5" /></button>}
                </div>
              </div>
              {isExpanded && <div className="mt-3 space-y-3 border-t border-border pt-3 text-xs">
                {manifest.id==='formula-extractor'&&<div className="space-y-1"><p>{tr('Set up the local image engine from Formula Extractor. An already installed custom pix2tex backend remains optional.','请从公式提取面板启用本地图片识别；已安装的自定义 pix2tex 为可选高级配置。')}</p><button type="button" className="rounded border border-border px-2 py-1" disabled={ocrChecking} onClick={()=>{setOcrChecking(true);void probeFormulaOcrBackend(String(settingValues[manifest.id]?.ocrCommand??getPluginSetting(manifest.id,'ocrCommand')??'managed')).then(setOcrStatus).finally(()=>setOcrChecking(false));}}>{tr('Check local OCR','检查本地 OCR')}</button>{ocrStatus&&<p role="status">{ocrStatus.status==='ready'?tr('Executable found; model quality requires validation.','已找到可执行文件；模型质量仍需实际验证。'):ocrStatus.status==='desktop-only'?tr('OCR is available only in the desktop app with a configured backend.','OCR 仅可在桌面端配置后端后使用。'):tr('OCR is not ready. Complete setup in Formula Extractor or check the custom executable.','OCR 尚未就绪，请在公式提取面板启用，或检查自定义后端。')}{ocrStatus.message}</p>}</div>}
                <label className="flex items-center gap-2"><input type="checkbox" checked={trusted} onChange={(event) => void setTrusted(manifest, event.target.checked)} /> {tr('Trust this plugin','已了解权限并信任此插件')}</label>
                <div><div className="font-medium">{tr('Permissions','权限')} <span className="text-muted-foreground">({t(`settings.plugins.risk.${getPluginPermissionRisk(manifest.permissions ?? [])}` as never)})</span></div><div className="mt-1 flex flex-wrap gap-1">{(manifest.permissions ?? []).map((permission) => { const meta = getPluginPermissionMeta(permission as PluginPermission); return <span key={permission} className="rounded bg-muted px-1.5 py-0.5" title={t(meta.descKey)}>{t(meta.titleKey)}</span>; })}</div></div>
                {settingsFields.length > 0 && <div className="space-y-2"><div className="font-medium">{tr("Settings", "设置")}</div>{settingsFields.map((field) => { const stored = getPluginSetting(manifest.id, field.id); const current = settingValues[manifest.id]?.[field.id] ?? stored ?? field.default ?? (field.type === "boolean" ? false : ""); const onChange = (value: unknown) => void updatePluginSetting(manifest.id, field.id, value); const label = zh && manifest.id === 'formula-extractor' && field.id === 'ocrCommand' ? '高级 OCR 后端' : field.label; return <label key={field.id} className="flex items-center justify-between gap-2"><span>{label}</span>{field.type === "boolean" ? <input type="checkbox" checked={Boolean(current)} onChange={(event) => onChange(event.target.checked)} /> : field.type === "select" ? <select value={String(current)} onChange={(event) => onChange(event.target.value)}>{(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input className="max-w-44 rounded border border-border bg-background px-2 py-1" type={field.type === "number" ? "number" : "text"} value={String(current)} onChange={(event) => onChange(field.type === "number" ? Number(event.target.value) : event.target.value)} />}</label>; })}</div>}
                {commands.length > 0 && <div className="space-y-1"><div className="font-medium">{tr('Commands','可执行命令')}</div>{commands.map((command) => <button key={command.id} type="button" className="flex w-full items-center gap-2 rounded border border-border px-2 py-1 text-left" disabled={runningCommand === command.id || status!=='active'} onClick={() => void runCommand(command)}><Play className="h-3 w-3" /> {commandLabel(command, zh)}</button>)}</div>}
              </div>}
            </article>
          );
        })}
      </div>
      <details className="rounded-lg border border-border p-3 text-xs">
        <summary className="cursor-pointer font-medium">{tr('Advanced plugin settings','插件高级设置')}</summary>
        <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={settings.pluginsEnabled} onChange={event=>{void persistSettings({pluginsEnabled:event.target.checked}).then(applyRuntime).catch(cause=>setLocalError(cause instanceof Error?cause.message:String(cause)));}} />{tr('Enable plugin runtime','启用插件运行时')}</label>
        <label className="mt-3 block">{tr('Allowed network domains (one per line)','允许联网域名（每行一个）')}<textarea className="mt-1 w-full rounded border border-border bg-background p-2" value={networkHosts} onChange={event=>setNetworkHosts(event.target.value)} /></label>
        <button type="button" className="mt-2 rounded border border-border px-2 py-1" onClick={()=>{void persistSettings({pluginNetworkAllowlist:networkHosts.split(/\s+/).map(v=>v.trim()).filter(Boolean)}).catch(cause=>setLocalError(cause instanceof Error?cause.message:String(cause)));}}>{tr('Save allowed domains','保存允许域名')}</button>
      </details>
      <details className="rounded-lg border border-border p-3 text-xs">
        <summary className="cursor-pointer font-medium">{tr('Diagnostics','运行诊断')} ({audit.length})</summary>
        <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-muted-foreground">
          {audit.slice(0,20).map((event) => <li key={event.id}>{event.pluginId}: {event.message}</li>)}
        </ul>
      </details>
    </section>
  );
}
