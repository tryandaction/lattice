export type PluginPermission =
  | 'file:read'
  | 'file:write'
  | 'annotations:read'
  | 'annotations:write'
  | 'network'
  | 'ui:commands';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  permissions?: PluginPermission[];
}

export interface PluginCommand {
  id: string;
  title: string;
  run: () => void | Promise<void>;
}

export interface PluginContext {
  app: {
    platform: 'web' | 'desktop';
  };
  log: (...args: unknown[]) => void;
  registerCommand: (command: PluginCommand) => void;
}

export interface PluginModule {
  manifest: PluginManifest;
  activate: (ctx: PluginContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}
