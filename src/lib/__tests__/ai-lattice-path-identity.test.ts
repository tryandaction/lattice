import { describe, expect, it } from 'vitest';
import { resolveLatticePathIdentity } from '@/lib/ai/lattice-skills/path-identity';
import type { WorkspaceIdentity } from '@/types/workspace-identity';

const desktopWorkspace: WorkspaceIdentity = {
  workspaceKey: 'workspace-alpha',
  displayPath: 'C:/Research/Lattice Workspace',
  rootName: 'Lattice Workspace',
  hostKind: 'desktop',
  handleFingerprint: null,
  lastUsedAt: 100,
};

describe('lattice path identity skill', () => {
  it('resolves workspace-relative PDF identity with annotation and item paths', async () => {
    const identity = await resolveLatticePathIdentity({
      filePathOrAbsolutePath: 'atom/Categorized Papers/Rydberg paper.pdf',
      workspaceIdentity: desktopWorkspace,
    });

    expect(identity.kind).toBe('pdf');
    expect(identity.latticePath).toBe('atom/Categorized Papers/Rydberg paper.pdf');
    expect(identity.fileName).toBe('Rydberg paper.pdf');
    expect(identity.fileId).toBe('atom-Categorized_Papers-Rydberg_paper.pdf');
    expect(identity.annotationPath).toBe('.lattice/annotations/atom-Categorized_Papers-Rydberg_paper.pdf.json');
    expect(identity.itemFolderPath).toBe('.lattice/items/atom-Categorized_Papers-Rydberg_paper.pdf');
    expect(identity.itemManifestPath).toBe('.lattice/items/atom-Categorized_Papers-Rydberg_paper.pdf/manifest.json');
    expect(identity.annotationIndexPath).toBe('.lattice/items/atom-Categorized_Papers-Rydberg_paper.pdf/_annotations.md');
    expect(identity.fileIdCandidates).toContain('Categorized_Papers-Rydberg_paper.pdf');
  });

  it('strips desktop workspace display prefixes before deriving ids', async () => {
    const identity = await resolveLatticePathIdentity({
      filePathOrAbsolutePath: 'C:/Research/Lattice Workspace/notes/alpha.md',
      workspaceIdentity: desktopWorkspace,
    });

    expect(identity.kind).toBe('generic');
    expect(identity.latticePath).toBe('notes/alpha.md');
    expect(identity.fileId).toBe('notes-alpha.md');
    expect(identity.itemFolderPath).toBeNull();
    expect(identity.annotationIndexPath).toBeNull();
    expect(identity.fileIdentity.canonicalPath).toBe('C:/Research/Lattice Workspace/notes/alpha.md');
  });

  it('supports web workspaces with stable canonical path fallback', async () => {
    const identity = await resolveLatticePathIdentity({
      filePathOrAbsolutePath: 'notes/beta.md',
      workspaceIdentity: {
        ...desktopWorkspace,
        hostKind: 'web',
        displayPath: null,
      },
    });

    expect(identity.latticePath).toBe('notes/beta.md');
    expect(identity.fileIdentity.canonicalPath).toBe('workspace-alpha:notes/beta.md');
    expect(identity.annotationPath).toBe('.lattice/annotations/notes-beta.md.json');
  });
});
