import { parseThemeJSON } from './validation';
import { BUILTIN_THEMES } from './registry';
import type { ThemePackage, ThemeValidationResult } from './types';

export function exportThemeJSON(theme: ThemePackage): string {
  const exported = theme.id.startsWith('user-') ? theme : { ...theme, id: `user-import-${theme.id}` };
  return `${JSON.stringify(exported, null, 2)}\n`;
}

export function makeAIDesignPrompt(): string {
  return [
    '为 Lattice 设计一个离线可导入的 ThemePackage JSON。',
    '必须输出 schemaVersion=1、稳定 id、name、author、license、packageVersion、light/dark 两套完整 colors 和 rules。',
    'colors 只能使用 #RRGGBB；不得输出 CSS、URL、脚本、选择器或额外字段。普通文字对比度至少 4.5:1，focus/controlBorder 至少 3:1。',
    '产品面必须覆盖文件导航、多标签、工具栏、PDF 阅读/批注、Markdown/公式、代码/Notebook、AI Chat/Agent/证据、设置和插件容器；保留 PDF 原文和用户内容可读。',
    'rules 只能使用 uiFont/readingFont/codeFont=geist|system|serif|mono，density=comfortable|standard|compact，radius=sharp|soft|round，shadow=none|subtle|soft，motion=none|subtle|standard。',
    'id 使用 user- 前缀，包不超过 64 KiB。每个 foreground/mutedForeground/primary/status 在 background/surface/elevated/muted 都达到 4.5:1；selectedForeground 在 selected 达到 4.5:1；focus/controlBorder 在四个表面达到 3:1。border 是装饰线。',
    '遵守 reduced-motion，不改变 PDF canvas/textLayer 和 KaTeX 字形。包只能使用本机/已打包字体。不得改变用户高亮颜色。',
    '完整可导入模板如下；保留所有字段，只修改命名、色值和规则。只返回 JSON，不要 markdown 代码围栏。',
    makeAIThemeTemplate(),
  ].join('\n');
}

export function makeAIThemeTemplate(): string {
  return exportThemeJSON({ ...structuredClone(BUILTIN_THEMES[0]), id: 'user-example', name: '我的主题', author: 'User', license: 'User' });
}

export function importThemeJSON(text: string): ThemeValidationResult {
  return parseThemeJSON(text);
}

