'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Pencil, RotateCcw, Trash2, Upload, WandSparkles } from 'lucide-react';
import { useSettingsStore } from '@/stores/settings-store';
import { BUILTIN_THEMES, getTheme, isBuiltinTheme } from '@/lib/appearance/registry';
import { cloneTheme, validateThemePackage } from '@/lib/appearance/validation';
import { exportThemeJSON, importThemeJSON, makeAIDesignPrompt, makeAIThemeTemplate } from '@/lib/appearance/exchange';
import { applyAppearance, createAppearancePreview } from '@/lib/appearance/runtime';
import { THEME_COLOR_KEYS, type ThemeColorKey, type ThemePackage, type ThemeMode as AppearanceMode } from '@/lib/appearance/types';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/hooks/use-i18n';

const zhCopy = {
  title: '外观皮肤', subtitle: '统一工作区外观，保持文档内容可读。',
  apply: '应用', edit: '编辑', clone: '克隆为自定义', save: '保存自定义', cancel: '取消预览',
  reset: '恢复默认', import: '导入 JSON', export: '导出 JSON', importText: '导入文本', ai: '复制 AI 设计提示词',
  aiTemplate: '复制主题模板', customName: '自定义名称', colors: '关键颜色', rules: '显示规则', light: '浅色', dark: '深色',
  delete: '删除自定义', invalid: '主题 JSON 无效或不可读', copied: '已复制', copyFailed: '复制失败，请检查浏览器权限',
  saved: '已保存', uiFont: '界面字体', readingFont: '阅读字体', codeFont: '代码字体', density: '控件紧凑度', radius: '圆角风格', shadow: '阴影层级', motion: '动效速度',
  custom: '自定义', jsonPlaceholder: '粘贴 ThemePackage JSON', saveFirst: '请先保存自定义主题，再应用它。', applyFailed: '应用失败', saveFailed: '保存失败', resetFailed: '恢复默认失败', deleteFailed: '删除失败',
};
const enCopy = {
  title: 'Workspace skins', subtitle: 'Personalize the workspace while keeping documents readable.',
  apply:'Apply', edit:'Edit', clone:'Clone as custom', save:'Save custom skin', cancel:'Cancel preview',
  reset:'Restore default', import:'Import JSON', export:'Export JSON', importText:'Import text', ai:'Copy AI design prompt',
  aiTemplate:'Copy theme template', customName:'Custom name', colors:'Colors', rules:'Display rules', light:'Light palette', dark:'Dark palette',
  delete:'Delete custom skin', invalid:'Invalid or unreadable theme JSON', copied:'Copied', copyFailed:'Copy failed; check browser permissions', saved:'Saved', uiFont:'UI font', readingFont:'Reading font', codeFont:'Code font', density:'Compactness', radius:'Corner style', shadow:'Shadow level', motion:'Motion speed',
  custom:'Custom', jsonPlaceholder:'Paste ThemePackage JSON', saveFirst:'Save the custom skin before applying it.', applyFailed:'Apply failed', saveFailed:'Save failed', resetFailed:'Restore default failed', deleteFailed:'Delete failed',
};

const colorLabels: Partial<Record<ThemeColorKey, string>> = {
  background: '工作区背景', foreground: '正文文字', surface: '面板表面', elevated: '浮层表面', primary: '主色',
  primaryForeground: '主色文字', focus: '焦点', selected: '选中背景', selectedForeground: '选中文字',
  success: '成功', warning: '警告', danger: '危险', info: '信息', border: '边界', controlBorder: '控件边界', muted:'柔和表面', mutedForeground:'次要文字',
};
const colorLabelsEn: Record<ThemeColorKey, string> = {
  background: 'Background', foreground: 'Text', surface: 'Panel surface', elevated: 'Floating surface', muted: 'Subtle surface',
  mutedForeground: 'Muted text', border: 'Border', controlBorder: 'Control border', primary: 'Primary color',
  primaryForeground: 'Primary text', focus: 'Focus ring', selected: 'Selection background', selectedForeground: 'Selection text',
  success: 'Success', warning: 'Warning', danger: 'Danger', info: 'Information',
};
const editableColors = THEME_COLOR_KEYS.filter((key) => colorLabels[key]);
const themeErrorsZh: Record<string, string> = {
  'Unknown theme field': '主题文件包含不支持的字段',
  'Unsupported theme schema': '主题文件版本不受支持',
  'Invalid theme id': '主题标识无效',
  'Invalid theme name': '主题名称无效',
  'Invalid author': '作者信息无效',
  'Invalid license': '许可信息无效',
  'Invalid packageVersion': '主题版本信息无效',
  'Invalid theme colors or contrast': '主题颜色无效或对比度不足',
  'Invalid theme rules': '主题显示规则无效',
  'Theme JSON exceeds 64 KiB': '主题 JSON 不能超过 64 KiB',
  'Theme JSON is malformed': '主题 JSON 格式错误',
  '最多保存 20 套自定义皮肤，请先删除一套再保存。': '最多保存 20 套自定义皮肤，请先删除一套再保存。',
};
const themeErrorsEn: Record<string, string> = {
  '最多保存 20 套自定义皮肤，请先删除一套再保存。': 'Save up to 20 custom skins. Delete one before adding another.',
};
function localizeThemeError(message: string, locale: string): string {
  return (locale === 'zh-CN' ? themeErrorsZh : themeErrorsEn)[message] ?? message;
}
type PreviewSession = ReturnType<typeof createAppearancePreview>;

export function AppearanceEditor() {
  const { locale } = useI18n();
  const copy = locale === 'zh-CN' ? zhCopy : enCopy;
  const themeNames: Record<string, string> = locale === 'zh-CN' ? {} : {lattice:'Lattice', folio:'Folio', breeze:'Breeze', atelier:'Atelier', nocturne:'Nocturne'};
  const ruleLabels: Record<string, string> = {uiFont:copy.uiFont, readingFont:copy.readingFont, codeFont:copy.codeFont, density:copy.density, radius:copy.radius, shadow:copy.shadow, motion:copy.motion};
  const valueLabels: Record<string, string> = locale === 'zh-CN' ? {geist:'本地 Geist',system:'系统字体',serif:'衬线字体',mono:'本地等宽',comfortable:'舒适',standard:'标准',compact:'紧凑',sharp:'利落',soft:'柔和',round:'圆润',none:'关闭',subtle:'轻微'} : {};
  const valueLabelsEn: Record<string, string> = { geist: 'Geist', system: 'System', serif: 'Serif', mono: 'Monospace', comfortable: 'Comfortable', standard: 'Standard', compact: 'Compact', sharp: 'Sharp', soft: 'Soft', round: 'Rounded', none: 'None', subtle: 'Subtle' };
  const { resolvedTheme } = useTheme();
  const appearance = useSettingsStore((state) => state.settings.appearance);
  const setAppearanceTheme = useSettingsStore((state) => state.setAppearanceTheme);
  const saveCustomTheme = useSettingsStore((state) => state.saveCustomTheme);
  const deleteCustomTheme = useSettingsStore((state) => state.deleteCustomTheme);
  const resetAppearance = useSettingsStore((state) => state.resetAppearance);
  const [selectedOverride, setSelectedId] = useState<string | null>(null);
  const selectedId = selectedOverride ?? appearance.activeThemeId;
  const [draft, setDraft] = useState<ThemePackage | null>(null);
  const [name, setName] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [editMode, setEditMode] = useState<AppearanceMode>(resolvedTheme);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<PreviewSession | null>(null);
  const selected = draft ?? getTheme(selectedId, appearance.customThemes);

  useEffect(() => {
    if (previewRef.current && validateThemePackage(selected).ok) previewRef.current.preview(selected, resolvedTheme);
  }, [resolvedTheme, selected]);

  useEffect(() => () => {
    previewRef.current?.dispose();
    previewRef.current = null;
  }, []);

  // Drafts may be invalid while they are being edited; only validated packages may touch document CSS.
  const previewIfValid = (theme: ThemePackage) => {
    const validation = validateThemePackage(theme);
    if (!validation.ok) { setError(localizeThemeError(validation.error, locale)); return; }
    setError(null);
    if (!previewRef.current) previewRef.current = createAppearancePreview();
    previewRef.current.preview(theme, resolvedTheme);
  };
  const stopPreview = () => { previewRef.current?.cancel(); previewRef.current = null; };

  const selectTheme = (id: string) => {
    setError(null); setNotice(null); setDraft(null); setSelectedId(id); previewIfValid(getTheme(id, appearance.customThemes));
  };
  const beginEdit = () => { const editable = isBuiltinTheme(selected.id) ? cloneTheme(selected, selected.name) : structuredClone(selected); setDraft(editable); setSelectedId(editable.id); setName(editable.name); previewIfValid(editable); };
  const cloneSelected = () => { const defaultName = locale === 'zh-CN' ? undefined : `${themeNames[selected.id] ?? selected.name} Custom`; const cloned = cloneTheme(selected, name.trim() || defaultName); setDraft(cloned); setName(cloned.name); setSelectedId(cloned.id); previewIfValid(cloned); };
  const updateDraft = (updates: Partial<ThemePackage>) => { if (!draft) return; const next = { ...draft, ...updates }; setDraft(next); previewIfValid(next); };
  const updateColor = (themeMode: AppearanceMode, key: ThemeColorKey, value: string) => {
    if (!draft || !/^#[0-9a-f]{6}$/i.test(value)) return;
    updateDraft({ colors: { ...draft.colors, [themeMode]: { ...draft.colors[themeMode], [key]: value } } });
  };
  const updateRule = <K extends keyof ThemePackage['rules']>(key: K, value: ThemePackage['rules'][K]) => {
    if (draft) updateDraft({ rules: { ...draft.rules, [key]: value } });
  };

  const applySelected = async () => {
    if (draft) { setError(copy.saveFirst); return; }
    try { await setAppearanceTheme(selected.id); stopPreview(); setSelectedId(null); applyAppearance(selected, resolvedTheme); setNotice(copy.saved); }
    catch (reason) { setError(localizeThemeError(reason instanceof Error ? reason.message : copy.applyFailed, locale)); }
  };
  const save = async () => {
    if (!draft) return;
    const result = validateThemePackage({ ...draft, name: name.trim() || draft.name }, { customOnly: true });
    if (!result.ok) { setError(result.error); return; }
    try { await saveCustomTheme(result.theme); stopPreview(); setDraft(null); setSelectedId(null); applyAppearance(result.theme, resolvedTheme); setNotice(copy.saved); }
    catch (reason) { setError(localizeThemeError(reason instanceof Error ? reason.message : copy.saveFailed, locale)); }
  };
  const cancel = () => { stopPreview(); setDraft(null); setSelectedId(null); setName(''); setError(null); };
  const reset = async () => { cancel(); try { await resetAppearance(); setNotice(copy.saved); } catch (reason) { setError(localizeThemeError(reason instanceof Error ? reason.message : copy.resetFailed, locale)); } };
  const removeSelected = async () => {
    if (isBuiltinTheme(selectedId)) return;
    try { await deleteCustomTheme(selectedId); cancel(); setNotice(copy.saved); } catch (reason) { setError(localizeThemeError(reason instanceof Error ? reason.message : copy.deleteFailed, locale)); }
  };
  const importText = (text: string) => {
    const result = importThemeJSON(text);
    if (!result.ok) { setError(localizeThemeError(result.error || copy.invalid, locale)); return; }
    setError(null); setJsonText(text); setDraft(result.theme); setName(result.theme.name); setSelectedId(result.theme.id); previewIfValid(result.theme);
  };
  const exportCurrent = () => { const blob = new Blob([exportThemeJSON(selected)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${selected.id}.json`; anchor.click(); URL.revokeObjectURL(url); };
  const copyText = async (text: string) => {
    try { if (!navigator.clipboard) throw new Error(copy.copyFailed); await navigator.clipboard.writeText(text); setCopied(true); setError(null); window.setTimeout(() => setCopied(false), 1500); }
    catch (reason) { setCopied(false); setError(reason instanceof Error ? reason.message : copy.copyFailed); }
  };

  return (
    <section className="space-y-4" aria-label={copy.title}>
      <div><h3 className="text-sm font-semibold">{copy.title}</h3><p className="mt-1 text-xs text-muted-foreground">{copy.subtitle}</p></div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 appearance-actions">
        {[...BUILTIN_THEMES, ...appearance.customThemes].map((theme) => (
          <div key={theme.id} className={`flex min-h-16 items-center gap-2 rounded-[var(--appearance-radius,6px)] border p-2 ${selectedId === theme.id ? 'border-primary bg-primary/10' : 'border-border'}`}>
            <button type="button" onClick={() => selectTheme(theme.id)} className="flex min-w-0 flex-1 items-center gap-3 p-1 text-left"><span className="h-8 w-8 shrink-0 rounded-full border" style={{ background: `linear-gradient(135deg, ${theme.colors.light.primary} 50%, ${theme.colors.dark.primary} 50%)` }} aria-hidden="true" /><span className="min-w-0"><span className="block truncate text-sm font-medium">{themeNames[theme.id] ?? theme.name}</span><span className="block truncate text-xs text-muted-foreground">{theme.id.startsWith('user-') ? copy.custom : `${valueLabels[theme.rules.density] ?? valueLabelsEn[theme.rules.density] ?? theme.rules.density} · ${valueLabels[theme.rules.readingFont] ?? valueLabelsEn[theme.rules.readingFont] ?? theme.rules.readingFont}`}</span></span>{selectedId === theme.id && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}</button>
            {selectedId === theme.id && <button type="button" aria-label={copy.edit} onClick={beginEdit} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>}
          </div>
        ))}
      </div>
      {draft && <div className="space-y-4 rounded border border-border bg-muted/20 p-3">
        <label className="block text-xs text-muted-foreground">{copy.customName}<input value={name} onChange={(event) => { setName(event.target.value); updateDraft({ name: event.target.value }); }} className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground" /></label>
        <fieldset><legend className="mb-2 text-xs font-semibold">{copy.colors}</legend><div className="mb-2 flex gap-1">{(['light', 'dark'] as const).map((item) => <button key={item} type="button" onClick={() => setEditMode(item)} className={`rounded px-2 py-1 text-xs ${editMode === item ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{item === 'light' ? copy.light : copy.dark}</button>)}</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{editableColors.map((key) => <label key={key} className="flex items-center gap-2 text-xs text-muted-foreground"><input type="color" value={draft.colors[editMode][key]} onChange={(event) => updateColor(editMode, key, event.target.value)} className="h-7 w-7 rounded border-0 bg-transparent p-0" />{locale === 'zh-CN' ? colorLabels[key] : colorLabelsEn[key]}</label>)}</div></fieldset>
        <fieldset><legend className="mb-2 text-xs font-semibold">{copy.rules}</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{(['uiFont', 'readingFont', 'codeFont', 'density', 'radius', 'shadow', 'motion'] as const).map((key) => <label key={key} className="text-xs text-muted-foreground">{ruleLabels[key]}<select value={draft.rules[key]} onChange={(event) => updateRule(key, event.target.value as never)} className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-xs text-foreground">{(key === 'uiFont' || key === 'readingFont' || key === 'codeFont' ? (key === 'codeFont' ? ['mono', 'system'] : ['geist', 'system', 'serif', 'mono']) : key === 'density' ? ['comfortable', 'standard', 'compact'] : key === 'radius' ? ['sharp', 'soft', 'round'] : key === 'shadow' ? ['none', 'subtle', 'soft'] : ['none', 'subtle', 'standard']).map((value) => <option key={value} value={value}>{valueLabels[value] ?? value}</option>)}</select></label>)}</div></fieldset>
      </div>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}{notice && <p role="status" className="text-xs text-[var(--appearance-success)]">{notice}</p>}
      <div className="appearance-actions flex flex-wrap gap-2">
        <button type="button" onClick={applySelected} className="inline-flex items-center gap-1.5 rounded bg-primary px-2.5 py-1.5 text-xs text-primary-foreground"><Check className="h-3.5 w-3.5" />{copy.apply}</button><button type="button" onClick={cloneSelected} className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs hover:bg-muted"><Copy className="h-3.5 w-3.5" />{copy.clone}</button>{draft && <button type="button" onClick={save} className="inline-flex items-center gap-1.5 rounded bg-primary px-2.5 py-1.5 text-xs text-primary-foreground"><Check className="h-3.5 w-3.5" />{copy.save}</button>}{appearance.customThemes.some(theme => theme.id === selectedId) && <button type="button" className="inline-flex items-center gap-1.5 rounded border border-destructive/40 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10" onClick={removeSelected}><Trash2 className="h-3.5 w-3.5" />{copy.delete}</button>}<button type="button" onClick={cancel} className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs hover:bg-muted"><RotateCcw className="h-3.5 w-3.5" />{copy.cancel}</button><button type="button" onClick={reset} className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs hover:bg-muted"><RotateCcw className="h-3.5 w-3.5" />{copy.reset}</button><button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs hover:bg-muted"><Upload className="h-3.5 w-3.5" />{copy.import}</button><input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={async (event) => { const file = event.target.files?.[0]; if (file && file.size <= 65536) importText(await file.text()); else if (file) setError(localizeThemeError('Theme JSON exceeds 64 KiB', locale)); event.target.value = ''; }} /><button type="button" onClick={exportCurrent} className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs hover:bg-muted"><Download className="h-3.5 w-3.5" />{copy.export}</button>
      </div>
      <div className="space-y-2"><textarea value={jsonText} onChange={(event) => setJsonText(event.target.value)} placeholder={copy.jsonPlaceholder} className="min-h-24 w-full resize-y rounded border border-input bg-background p-2 font-mono text-xs text-foreground" /><div className="appearance-actions flex flex-wrap gap-2"><button type="button" onClick={() => importText(jsonText)} className="rounded border border-border px-2.5 py-1.5 text-xs hover:bg-muted">{copy.importText}</button><button type="button" onClick={() => copyText(makeAIDesignPrompt())} className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs hover:bg-muted"><WandSparkles className="h-3.5 w-3.5" />{copied ? copy.copied : copy.ai}</button><button type="button" onClick={() => copyText(makeAIThemeTemplate())} className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs hover:bg-muted"><Copy className="h-3.5 w-3.5" />{copy.aiTemplate}</button></div></div>
    </section>
  );
}

