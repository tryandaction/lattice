/**
 * Chinese (Simplified) Translations
 */

export const zhCN = {
  // Common
  'common.save': '保存',
  'common.cancel': '取消',
  'common.close': '关闭',
  'common.confirm': '确认',
  'common.delete': '删除',
  'common.edit': '编辑',
  'common.reset': '重置',
  'common.skip': '跳过',
  'common.next': '下一步',
  'common.back': '上一步',
  'common.finish': '完成',
  'common.select': '选择',
  'common.clear': '清除',

  // Settings
  'settings.title': '设置',
  'settings.general': '通用',
  'settings.appearance': '外观',
  'settings.language': '语言',
  'settings.files': '文件',
  'settings.about': '关于',
  'settings.theme': '主题',
  'settings.theme.light': '浅色',
  'settings.theme.dark': '深色',
  'settings.theme.system': '跟随系统',
  'settings.defaultFolder': '默认文件夹',
  'settings.defaultFolder.description': '应用启动时自动打开此文件夹',
  'settings.defaultFolder.select': '选择文件夹',
  'settings.defaultFolder.clear': '清除',
  'settings.defaultFolder.notSet': '未设置',
  'settings.defaultFolder.notFound': '文件夹不存在',
  'settings.defaultFolder.notFound.description': '默认文件夹已被移动或删除，请重新选择',
  'settings.defaultFolder.reselect': '重新选择',
  'settings.lastOpenedFolder': '上次打开的文件夹',
  'settings.restartOnboarding': '重新开始引导',
  'settings.restartOnboarding.description': '重新显示首次启动引导向导',
  'settings.version': '版本',
  'settings.shortcuts': '快捷键',
  'settings.shortcuts.toggleSidebar': '切换侧边栏',
  'settings.shortcuts.openSettings': '打开设置',
  'settings.shortcuts.toggleTheme': '切换主题',

  // Onboarding
  'onboarding.welcome': '欢迎使用 Lattice 格致',
  'onboarding.welcome.description': '本地优先、AI 原生的科学工作台',
  'onboarding.welcome.subtitle': '让我们花一分钟完成初始设置',
  'onboarding.language.title': '选择您的语言',
  'onboarding.language.description': '您可以随时在设置中更改语言',
  'onboarding.theme.title': '选择主题',
  'onboarding.theme.description': '选择您喜欢的界面外观',
  'onboarding.folder.title': '设置默认工作区',
  'onboarding.folder.description': '选择一个文件夹作为默认工作区，应用启动时会自动打开',
  'onboarding.folder.skip': '稍后设置',
  'onboarding.complete.title': '设置完成！',
  'onboarding.complete.description': '您已准备好开始使用 Lattice',
  'onboarding.getStarted': '开始使用',

  // Export
  'export.title': '导出',
  'export.success': '导出成功',
  'export.success.description': '文件已保存至: {path}',
  'export.showInFolder': '在文件夹中显示',
  'export.error': '导出失败',
  'export.retry': '重试',
  'export.progress': '正在导出...',

  // Annotations
  'annotations.title': '批注',
  'annotations.empty': '暂无批注',
  'annotations.page': '第 {page} 页',
  'annotations.selectText': '选择文字或按住 Alt 拖动创建高亮',

  // File Explorer
  'explorer.title': '文件浏览器',
  'explorer.openFolder': '打开文件夹',
  'explorer.newFile': '新建文件',
  'explorer.newFolder': '新建文件夹',
  'explorer.refresh': '刷新',
  'explorer.empty': '选择一个文件夹开始',

  // App
  'app.name': 'Lattice 格致',
  'app.tagline': '本地优先、AI 原生的科学工作台',
} as const;

export type TranslationKey = keyof typeof zhCN;
