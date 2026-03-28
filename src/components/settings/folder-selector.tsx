'use client';

import { FolderOpen, Trash2, AlertCircle, RefreshCw, X } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useI18n } from '@/hooks/use-i18n';
import { isExistingDesktopDirectory, openDesktopDirectoryDialog } from '@/lib/desktop-folder';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { isTauri } from '@/lib/storage-adapter';
import { useFileSystem } from '@/hooks/use-file-system';

interface FolderSelectorProps {
  compact?: boolean;
  /** Show folder not found warning */
  showNotFoundWarning?: boolean;
}

export function FolderSelector({ compact = false, showNotFoundWarning = false }: FolderSelectorProps) {
  const { t } = useI18n();
  const defaultFolder = useSettingsStore((state) => state.settings.defaultFolder);
  const recentWorkspaces = useSettingsStore((state) => state.settings.recentWorkspacePaths);
  const setDefaultFolder = useSettingsStore((state) => state.setDefaultFolder);
  const removeRecentWorkspacePath = useSettingsStore((state) => state.removeRecentWorkspacePath);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const { openWorkspacePath } = useFileSystem();
  
  const [error, setError] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [folderNotFound, setFolderNotFound] = useState(false);

  // Check if folder exists (for Tauri mode)
  useEffect(() => {
    if (showNotFoundWarning && defaultFolder && isTauri()) {
      isExistingDesktopDirectory(defaultFolder)
        .then((exists) => {
          setFolderNotFound(!exists);
        })
        .catch(() => {
          setFolderNotFound(false);
        });
    } else {
      setFolderNotFound(false);
    }
  }, [defaultFolder, showNotFoundWarning]);

  const handleSelectFolder = async () => {
    setError(null);
    setFolderNotFound(false);
    setIsSelecting(true);

    try {
      if (isTauri()) {
        const selected = await openDesktopDirectoryDialog({
          title: t('settings.defaultFolder.select'),
          defaultPath: defaultFolder ?? workspaceRootPath,
        });
        if (selected) {
          await setDefaultFolder(selected);
        }
      } else {
        // Web: Use File System Access API
        if ('showDirectoryPicker' in window) {
          const handle = await (window as Window & { showDirectoryPicker: (options?: { mode?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({
            mode: 'readwrite',
          });
          
          // Save the folder name as default
          await setDefaultFolder(handle.name);
        } else {
          setError('Folder selection not supported in this browser');
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Failed to select folder');
      }
    } finally {
      setIsSelecting(false);
    }
  };

  const handleClear = async () => {
    setError(null);
    setFolderNotFound(false);
    await setDefaultFolder(null);
  };

  if (compact) {
    return (
      <div className="space-y-3">
        {defaultFolder ? (
          <div className={`flex items-center gap-2 p-3 rounded-lg ${folderNotFound ? 'bg-destructive/10 border border-destructive/30' : 'bg-muted'}`}>
            <FolderOpen className={`h-5 w-5 flex-shrink-0 ${folderNotFound ? 'text-destructive' : 'text-primary'}`} />
            <span className="flex-1 truncate text-sm">{defaultFolder}</span>
            {folderNotFound && (
              <button
                onClick={handleSelectFolder}
                disabled={isSelecting}
                className="p-1 text-destructive hover:text-destructive/80 transition-colors"
                title={t('settings.defaultFolder.reselect')}
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={handleClear}
              className="p-1 text-muted-foreground hover:text-destructive transition-colors"
              title={t('common.clear')}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={handleSelectFolder}
            disabled={isSelecting}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-border rounded-lg hover:border-primary hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            <FolderOpen className="h-5 w-5" />
            <span>{isSelecting ? '...' : t('settings.defaultFolder.select')}</span>
          </button>
        )}
        {folderNotFound && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="h-3 w-3" />
            {t('settings.defaultFolder.notFound')}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <FolderOpen className="h-4 w-4" />
        {t('settings.defaultFolder')}
      </div>
      <p className="text-xs text-muted-foreground">
        {t('settings.defaultFolder.description')}
      </p>
      
      {defaultFolder ? (
        <div className="space-y-2">
          <div className={`flex items-center gap-2 ${folderNotFound ? 'border border-destructive/30 rounded-lg' : ''}`}>
            <div className={`flex-1 px-3 py-2 rounded-lg text-sm truncate ${folderNotFound ? 'bg-destructive/10 text-destructive' : 'bg-muted'}`}>
              {defaultFolder}
            </div>
            <button
              onClick={handleClear}
              className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
              title={t('settings.defaultFolder.clear')}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {folderNotFound && (
            <div className="flex items-center gap-2 p-2 text-xs text-destructive bg-destructive/5 rounded-lg">
              <AlertCircle className="h-3 w-3 flex-shrink-0" />
              <span className="flex-1">{t('settings.defaultFolder.notFound.description')}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="px-3 py-2 bg-muted rounded-lg text-sm text-muted-foreground">
          {t('settings.defaultFolder.notSet')}
        </div>
      )}

      <button
        onClick={handleSelectFolder}
        disabled={isSelecting}
        className="flex items-center gap-2 px-3 py-2 text-sm bg-primary/10 text-primary hover:bg-primary/20 rounded-lg transition-colors disabled:opacity-50"
      >
        <FolderOpen className="h-4 w-4" />
        {isSelecting ? '...' : (folderNotFound ? t('settings.defaultFolder.reselect') : t('settings.defaultFolder.select'))}
      </button>

      {error && (
        <div className="flex items-center gap-2 p-2 text-sm text-destructive bg-destructive/10 rounded-lg">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-2 pt-2">
        <div className="text-xs font-medium text-muted-foreground">
          {t('settings.recentWorkspaces')}
        </div>
        {recentWorkspaces.length > 0 ? (
          <div className="space-y-1">
            {recentWorkspaces.map((workspacePath) => (
              <div key={workspacePath} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void openWorkspacePath(workspacePath)}
                  className="flex-1 truncate rounded-lg border border-border bg-muted/40 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                  title={workspacePath}
                >
                  {workspacePath}
                </button>
                <button
                  type="button"
                  onClick={() => void removeRecentWorkspacePath(workspacePath)}
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title={t('explorer.empty.removeRecent')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            {t('settings.recentWorkspaces.empty')}
          </div>
        )}
      </div>
    </div>
  );
}
