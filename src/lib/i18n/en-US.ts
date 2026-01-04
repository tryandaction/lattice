/**
 * English (US) Translations
 */

import type { TranslationKey } from './zh-CN';

export const enUS: Record<TranslationKey, string> = {
  // Common
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.confirm': 'Confirm',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.reset': 'Reset',
  'common.skip': 'Skip',
  'common.next': 'Next',
  'common.back': 'Back',
  'common.finish': 'Finish',
  'common.select': 'Select',
  'common.clear': 'Clear',

  // Settings
  'settings.title': 'Settings',
  'settings.general': 'General',
  'settings.appearance': 'Appearance',
  'settings.language': 'Language',
  'settings.files': 'Files',
  'settings.about': 'About',
  'settings.theme': 'Theme',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.theme.system': 'System',
  'settings.defaultFolder': 'Default Folder',
  'settings.defaultFolder.description': 'Automatically open this folder when the app starts',
  'settings.defaultFolder.select': 'Select Folder',
  'settings.defaultFolder.clear': 'Clear',
  'settings.defaultFolder.notSet': 'Not set',
  'settings.defaultFolder.notFound': 'Folder not found',
  'settings.defaultFolder.notFound.description': 'The default folder has been moved or deleted. Please select a new one.',
  'settings.defaultFolder.reselect': 'Reselect',
  'settings.lastOpenedFolder': 'Last Opened Folder',
  'settings.restartOnboarding': 'Restart Onboarding',
  'settings.restartOnboarding.description': 'Show the first-time setup wizard again',
  'settings.version': 'Version',
  'settings.shortcuts': 'Keyboard Shortcuts',
  'settings.shortcuts.toggleSidebar': 'Toggle Sidebar',
  'settings.shortcuts.openSettings': 'Open Settings',
  'settings.shortcuts.toggleTheme': 'Toggle Theme',

  // Onboarding
  'onboarding.welcome': 'Welcome to Lattice',
  'onboarding.welcome.description': 'Local-first, AI-native scientific workbench',
  'onboarding.welcome.subtitle': "Let's take a minute to set things up",
  'onboarding.language.title': 'Choose Your Language',
  'onboarding.language.description': 'You can change this anytime in settings',
  'onboarding.theme.title': 'Choose Theme',
  'onboarding.theme.description': 'Select your preferred appearance',
  'onboarding.folder.title': 'Set Default Workspace',
  'onboarding.folder.description': 'Choose a folder to open automatically when the app starts',
  'onboarding.folder.skip': 'Set up later',
  'onboarding.complete.title': 'All Set!',
  'onboarding.complete.description': "You're ready to start using Lattice",
  'onboarding.getStarted': 'Get Started',

  // Export
  'export.title': 'Export',
  'export.success': 'Export Successful',
  'export.success.description': 'File saved to: {path}',
  'export.showInFolder': 'Show in Folder',
  'export.error': 'Export Failed',
  'export.retry': 'Retry',
  'export.progress': 'Exporting...',

  // Annotations
  'annotations.title': 'Annotations',
  'annotations.empty': 'No annotations yet',
  'annotations.page': 'Page {page}',
  'annotations.selectText': 'Select text or Alt+drag to create highlights',

  // File Explorer
  'explorer.title': 'File Explorer',
  'explorer.openFolder': 'Open Folder',
  'explorer.newFile': 'New File',
  'explorer.newFolder': 'New Folder',
  'explorer.refresh': 'Refresh',
  'explorer.empty': 'Select a folder to get started',

  // App
  'app.name': 'Lattice',
  'app.tagline': 'Local-first, AI-native scientific workbench',
};
