import { describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/lib/storage-adapter', () => ({ isTauri: () => true, invokeTauriCommand: invoke }));

import { createDesktopDirectoryHandle } from '@/lib/desktop-file-system';
import { resolveAuthorizedDocumentHandle } from '../document-source-capture';

describe('desktop document handle recovery', () => {
  it('recovers an explorer path through real desktop handles without reading document bytes', async () => {
    const workspacePath = 'C:/test-document-recovery/atom';
    invoke.mockImplementation(async (command: string, args: { path: string }) => {
      if (command !== 'desktop_read_dir') throw new Error('Recovery must only inspect directory metadata');
      if (args.path === workspacePath) return [{ name: 'research', isDirectory: true, isFile: false, isSymlink: false }];
      if (args.path === workspacePath + '/research') return [{ name: 'paper.pdf', isDirectory: false, isFile: true, isSymlink: false }];
      throw new Error('Unexpected metadata path: ' + args.path);
    });
    const workspace = createDesktopDirectoryHandle(workspacePath);
    await expect(workspace.getDirectoryHandle('atom')).rejects.toMatchObject({
      name: 'NotFoundError', message: 'Directory not found: atom',
    });
    await expect(resolveAuthorizedDocumentHandle(workspace, 'atom/research/paper.pdf')).resolves.toMatchObject({
      name: 'paper.pdf', kind: 'file', fullPath: workspacePath + '/research/paper.pdf',
    });
  });
});
