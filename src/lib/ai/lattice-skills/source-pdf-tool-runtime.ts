import type { AuthorizedSourceIndex, AgentSourceRead } from '../source-index';
import { preparePdfChildProposal, type PdfChildProposal } from './pdf-child-skill';
import { prepareCloudPdfChildProposal, type CloudPdfChildProposal } from './cloud-pdf-child-skill';
import type { CloudLibraryResource, CloudLibrarySourceProvider } from '@/lib/shared-library/source-provider';

const integer = { type: 'integer', minimum: 1 };
/** Function schemas use the same names/JSON arguments for API tools and local dynamic-tool bridges. */
export const LATTICE_SOURCE_PDF_TOOLS = [
  { type: 'function', name: 'lattice.sources.list', description: 'List authorized source metadata by cursor. Listing and previews are not quotation evidence.',
    parameters: { type: 'object', properties: { cursor: { type: 'integer', minimum: 0 }, limit: integer }, additionalProperties: false } },
  { type: 'function', name: 'lattice.sources.search', description: 'Search relevant real document text, returning bounded matching excerpts and separate scanned coverage. maxChars/maxScanChars limit scanning, not source prefixes returned as evidence. cursor 0 starts; continue with the exact returned query/path/revision-bound nextCursor to scan later pages or offsets of the same file. Scanned units are not fully read evidence. Use paths to target exact authorized files.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, paths: { type: 'array', items: { type: 'string' }, maxItems: 100 }, cursor: { type: 'integer', minimum: 0 }, maxFiles: integer, maxChars: integer, maxScanChars: integer, maxUnits: integer, maxResults: integer, snippetChars: integer }, required: ['query'], additionalProperties: false } },
  { type: 'function', name: 'lattice.sources.read', description: 'Read authorized original pages/sections at the exact path and source version. For a whole-document task, iterate every pending unit in bounded calls until complete=true; continue with units/offsets when budget limits return pending coverage. Never treat an opening-page excerpt, search scan, or partial range as a completed document read.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, expectedVersion: { type: 'string' }, units: { type: 'array', items: integer }, offsets: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } }, maxChars: integer, maxUnits: integer }, required: ['path'], additionalProperties: false } },
  { type: 'function', name: 'lattice.pdf.proposeChild', description: 'Prepare a reviewable Markdown, code, Notebook or text-data child under a real stable PDF manifest. This tool never writes or approves its proposal.',
    parameters: { type: 'object', properties: { parentPath: { type: 'string' }, parentItemId: { type: 'string' }, fileName: { type: 'string' }, content: { type: 'string' }, mode: { type: 'string', enum: ['create', 'update'] } }, required: ['parentPath', 'fileName', 'content', 'mode'], additionalProperties: false } },
] as const;
export type LatticeSourcePdfToolName = typeof LATTICE_SOURCE_PDF_TOOLS[number]['name'];
export type LatticeSourcePdfToolResult = Awaited<ReturnType<AuthorizedSourceIndex['list'] | AuthorizedSourceIndex['search'] | AuthorizedSourceIndex['read']>> | PdfChildProposal;
export function validateLatticeSourcePdfToolArgs(name: string, value: unknown): Record<string, unknown> {
  const args = object(value);
  const definition = LATTICE_SOURCE_PDF_TOOLS.find(tool => tool.name === name);
  if (!definition) throw new Error('Unknown source/PDF tool.');
  const schema = definition.parameters as { properties: Record<string, { type: string; minimum?: number; enum?: readonly string[] }>; required?: readonly string[] };
  if (schema.required?.some(key => args[key] === undefined)) throw new Error('Missing required source/PDF argument.');
  for (const [key, value] of Object.entries(args)) {
    const property = schema.properties[key];
    if (!property) throw new Error('Unknown source/PDF argument.');
    if (property.type === 'string' && (typeof value !== 'string' || property.enum && !property.enum.includes(value))) throw new Error('Invalid string source/PDF argument.');
    if (property.type === 'integer' && (!Number.isSafeInteger(value) || (value as number) < (property.minimum ?? 0))) throw new Error('Invalid source/PDF read budget.');
    if (key === 'units' && (!Array.isArray(value) || value.some(unit => !Number.isSafeInteger(unit) || unit < 1))) throw new Error('Invalid source unit numbers.');
    if (key === 'paths' && (!Array.isArray(value) || !value.length || value.length > 100 || value.some(path => typeof path !== 'string' || !path.trim()))) throw new Error('Invalid search source paths.');
    if (key === 'offsets' && (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([unit, offset]) => !/^[1-9]\d*$/.test(unit) || !Number.isSafeInteger(offset) || offset < 0))) throw new Error('Invalid source unit offsets.');
  }
  return args;
}
export const LATTICE_SOURCE_PDF_SKILL = {
  id: 'lattice.authorized-sources-pdf-children', version: 1, tools: LATTICE_SOURCE_PDF_TOOLS,
  instructions: ['List only the selected workspace scope, search relevant real units, then read necessary ranges using expectedVersion.',
    'Use returned source revisions and locators for citations and disclose partial coverage. Unsupported binaries contain no usable text evidence.',
    'Create or update a PDF child as a proposal with concrete content. Wait for Workbench user review; model tools cannot approve or apply writes.',
    'Cloud resources require their provider identity/version/permission bridge; cloud display paths are never local filesystem inputs.'],
} as const;

export const LATTICE_CLOUD_PDF_TOOLS = [{ type: 'function', name: 'lattice.cloud.pdf.proposeChild',
  description: 'Prepare a concrete reviewed child for the currently authorized cloud PDF using provider identity and expected parent/child revisions. This tool never approves or saves.',
  parameters: { type: 'object', properties: { fileName: { type: 'string' }, content: { type: 'string' }, mode: { type: 'string', enum: ['create', 'update'] }, childItemId: { type: 'string' } },
    required: ['fileName', 'content', 'mode'], additionalProperties: false } }] as const;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tool arguments must be a JSON object.');
  return value as Record<string, unknown>;
}
function string(args: Record<string, unknown>, key: string): string {
  if (typeof args[key] !== 'string') throw new Error(`Tool argument ${key} must be a string.`);
  return args[key];
}
function number(args: Record<string, unknown>, key: string): number | undefined {
  if (args[key] === undefined) return undefined;
  if (!Number.isSafeInteger(args[key]) || (args[key] as number) < (key === 'cursor' ? 0 : 1)) throw new Error(`Tool argument ${key} must be an integer within the read budget.`);
  return args[key] as number;
}
export function createLatticeSourcePdfToolRuntime(input: {
  index: AuthorizedSourceIndex; root: FileSystemDirectoryHandle; workspaceKey: string;
  onProposal?: (proposal: PdfChildProposal) => void | Promise<void>;
}) {
  const readSnapshots = new Map<string, AgentSourceRead['snapshot']>();
  const remember = (read: AgentSourceRead, requestedPath?: string) => {
    if (read.chunks.some(chunk => chunk.text.trim())) {
      readSnapshots.set(read.snapshot.path, read.snapshot);
      if (requestedPath) readSnapshots.set(requestedPath, read.snapshot);
    }
    return read;
  };
  return {
    tools: LATTICE_SOURCE_PDF_TOOLS,
    async execute(name: string, value: unknown, signal?: AbortSignal): Promise<LatticeSourcePdfToolResult> {
      if (signal?.aborted) throw new DOMException('Tool cancelled', 'AbortError');
      input.index.assertScope(input.root, input.workspaceKey);
      const args = validateLatticeSourcePdfToolArgs(name, value);
      const definition = LATTICE_SOURCE_PDF_TOOLS.find(tool => tool.name === name);
      if (!definition) throw new Error('Unknown tool. PDF apply requires the separate concrete user review surface.');
      if (Object.keys(args).some(key => !Object.hasOwn(definition.parameters.properties, key))) throw new Error('Unknown tool argument.');
      switch (name) {
        case 'lattice.sources.list': return input.index.list({ cursor: number(args, 'cursor'), limit: number(args, 'limit'), signal });
        case 'lattice.sources.search': {
          const result = await input.index.search({ query: string(args, 'query'), paths: args.paths as string[] | undefined, cursor: number(args, 'cursor'), maxFiles: number(args, 'maxFiles'), maxChars: number(args, 'maxChars'), maxScanChars: number(args, 'maxScanChars'), maxUnits: number(args, 'maxUnits'), maxResults: number(args, 'maxResults'), snippetChars: number(args, 'snippetChars'), signal });
          result.reads.forEach(read => remember(read));
          return result;
        }
        case 'lattice.sources.read': {
          if (args.units !== undefined && (!Array.isArray(args.units) || args.units.some(unit => !Number.isSafeInteger(unit) || unit < 1))) throw new Error('Tool units must be positive integer unit numbers.');
          if (args.offsets !== undefined && (!args.offsets || typeof args.offsets !== 'object' || Array.isArray(args.offsets) || Object.entries(args.offsets).some(([key, offset]) => !/^[1-9]\d*$/.test(key) || !Number.isSafeInteger(offset) || (offset as number) < 0))) throw new Error('Tool offsets must contain nonnegative offsets keyed by unit.');
          return remember(await input.index.read({ path: string(args, 'path'), expectedVersion: args.expectedVersion === undefined ? undefined : string(args, 'expectedVersion'),
            units: args.units as number[] | undefined, offsets: args.offsets as Record<string, number> | undefined, maxChars: number(args, 'maxChars'), maxUnits: number(args, 'maxUnits'), signal }), string(args, 'path'));
        }
        case 'lattice.pdf.proposeChild': {
          if (args.mode !== 'create' && args.mode !== 'update') throw new Error('PDF proposal mode must be create or update.');
          // The root handle alone is not authorization for every PDF in the workspace.
          const remembered = readSnapshots.get(string(args, 'parentPath'));
          if (!remembered) throw new Error('PDF 子文件提案需要先通过 sources.read/search 读取选定父 PDF 的实际正文；列表或路径不构成已读来源。');
          const source = await input.index.read({ path: string(args, 'parentPath'), expectedVersion: remembered.version, maxChars: 1, maxUnits: 1, signal });
          const proposal = await preparePdfChildProposal({ root: input.root, workspaceKey: input.workspaceKey, parentPath: string(args, 'parentPath'),
            parentItemId: args.parentItemId === undefined ? undefined : string(args, 'parentItemId'), fileName: string(args, 'fileName'), content: string(args, 'content'), mode: args.mode, sourceSnapshot: remembered, signal });
          if ((await input.index.validateSnapshots([source.snapshot], signal)).invalid.length) throw new Error('PDF source permission or revision changed before proposal review.');
          if (signal?.aborted) throw new DOMException('Tool cancelled', 'AbortError');
          await input.onProposal?.(proposal);
          return proposal;
        }
      }
      throw new Error('Unknown source/PDF tool.');
    },
  };
}

export function createLatticeCloudPdfToolRuntime(input: {
  getProvider: () => CloudLibrarySourceProvider | null; getParent: () => CloudLibraryResource | null;
  onProposal?: (proposal: CloudPdfChildProposal) => void | Promise<void>;
}) {
  return { tools: LATTICE_CLOUD_PDF_TOOLS, async execute(name: string, value: unknown, signal?: AbortSignal) {
    if (name !== 'lattice.cloud.pdf.proposeChild') throw new Error('Cloud apply requires the separate concrete user review surface.');
    const provider = input.getProvider(), parent = input.getParent();
    if (!provider || !parent) throw new Error('No currently authorized cloud PDF.');
    const scope = provider.scope, parentId = parent.id, parentVersion = parent.versionId, parentRole = parent.role;
    const isCurrent = () => { const current = input.getParent(); return input.getProvider() === provider && provider.scope === scope
      && current?.id === parentId && current.versionId === parentVersion && current.role === parentRole; };
    const args = object(value);
    if (Object.keys(args).some(key => !Object.hasOwn(LATTICE_CLOUD_PDF_TOOLS[0].parameters.properties, key))) throw new Error('Unknown cloud tool argument.');
    if (args.mode !== 'create' && args.mode !== 'update') throw new Error('Cloud PDF proposal mode must be create or update.');
    const proposal = await prepareCloudPdfChildProposal({ provider, parent, fileName: string(args, 'fileName'), content: string(args, 'content'),
      mode: args.mode, childItemId: args.childItemId === undefined ? undefined : string(args, 'childItemId'), signal, isCurrent });
    if (!isCurrent()) throw new Error('Cloud provider permission scope changed.');
    if (signal?.aborted) throw new DOMException('Tool cancelled', 'AbortError');
    await input.onProposal?.(proposal);
    return proposal;
  } };
}
