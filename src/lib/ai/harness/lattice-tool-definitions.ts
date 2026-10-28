import { LATTICE_SOURCE_PDF_TOOLS } from '../lattice-skills/source-pdf-tool-runtime';
import { validateHarnessAnnotationStyle } from './pdf-tool-helpers';

const integer = { type: 'integer', minimum: 1 };
const paging = { cursor: { type: 'integer', minimum: 0 }, limit: integer };
const parent = { parentPath: { type: 'string' }, expectedVersion: { type: 'string' } };
const { path: _path, ...readOptions } = LATTICE_SOURCE_PDF_TOOLS[2].parameters.properties;
export const LATTICE_HARNESS_TOOLS = [
  ...LATTICE_SOURCE_PDF_TOOLS,
  { type: 'function', name: 'lattice.sources.active', description: 'Read the exact source captured for this conversation, without scanning the workspace. Returns real unit text, revision, locators and pending coverage.',
    parameters: { type: 'object', properties: readOptions, additionalProperties: false } },
  { type: 'function', name: 'lattice.pdf.listChildren', description: 'List existing children of an authorized PDF using its stable manifest or cloud provider. Returned paths can be read through sources.read. Does not initialize a PDF workspace.',
    parameters: { type: 'object', properties: { ...parent, ...paging }, required: ['parentPath'], additionalProperties: false } },
  { type: 'function', name: 'lattice.pdf.readAnnotations', description: 'Read existing PDF annotation records and annotation-note drafts with actual storage revisions. Never creates, migrates or writes sidecars; annotation text is evidence about annotations, not whole-PDF coverage.',
    parameters: { type: 'object', properties: { ...parent, ...paging, maxChars: integer }, required: ['parentPath'], additionalProperties: false } },
  { type: 'function', name: 'lattice.pdf.proposeAnnotations', description: 'Propose exact-quote highlight/underline drafts for pages actually read. Preserves prior annotation-note content. Emits a Workbench review draft, never coordinates, approval or writes.',
    parameters: { type: 'object', properties: { ...parent, annotations: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', properties: {
      page: integer, quote: { type: 'string' }, type: { type: 'string', enum: ['highlight', 'underline'] },
      color: { type: 'string', description: 'Optional #RGB, #RRGGBB, or CSS color name: aqua, black, blue, brown, cyan, fuchsia, gray/grey, green, lime, magenta, maroon, navy, olive, orange, pink, purple, red, silver, teal, white, yellow. Names preserve their standard CSS value; omitted uses #FFD400.' },
      comment: { type: 'string' }, tags: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    }, required: ['page', 'quote', 'type'], additionalProperties: false } } }, required: ['parentPath', 'annotations'], additionalProperties: false } },
  { type: 'function', name: 'lattice.workspace.proposeWrite', description: 'Prepare a complete Markdown/code/Notebook/text file for concrete Workbench review. Updates bind the actual original content and revision; no model tool can approve or apply. Local create uses a workspace-relative targetPath. Cloud update uses the real resource ID; cloud create uses an authorized folder resource ID as targetPath and a single fileName.',
    parameters: { type: 'object', properties: { targetPath: { type: 'string' }, fileName: { type: 'string' }, content: { type: 'string' }, mode: { type: 'string', enum: ['create', 'update'] }, expectedVersion: { type: 'string' } }, required: ['targetPath', 'content', 'mode'], additionalProperties: false } },
  { type: 'function', name: 'lattice.skills.list', description: 'Discover current Lattice skills and their actual callable tools, read/evidence contracts and review boundaries.',
    parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'lattice.skills.get', description: 'Read a Lattice skill and its operation contracts before PDF annotations, children, notebooks, code or note writes. Declared legacy tools are not automatically executable in this Harness.',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { type: 'function', name: 'lattice.compute.evaluate', description: 'Evaluate bounded numeric arithmetic with parentheses, + - * / % **, pi/e and fixed math functions. Returns a real finite number. No arbitrary JS, Python, shell, network, file access or execution claims.',
    parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'], additionalProperties: false } },
] as const;

type Schema = { type: string; minimum?: number; enum?: readonly string[]; properties?: Record<string, Schema>; required?: readonly string[]; items?: Schema; minItems?: number; maxItems?: number };
function validate(schema: Schema, value: unknown, depth = 0): void {
  if (depth > 8) throw new Error('Tool arguments exceed nesting budget.');
  if (schema.type === 'string' && (typeof value !== 'string' || schema.enum && !schema.enum.includes(value))) throw new Error('Invalid tool string argument.');
  if (schema.type === 'integer' && (!Number.isSafeInteger(value) || (value as number) < (schema.minimum ?? 0))) throw new Error('Invalid tool integer argument.');
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 4096)) throw new Error('Invalid tool array argument.');
    value.forEach(item => validate(schema.items!, item, depth + 1));
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tool arguments must be a JSON object.');
    const args = value as Record<string, unknown>;
    if (schema.required?.some(key => args[key] === undefined)) throw new Error('Missing required tool argument.');
    for (const [key, entry] of Object.entries(args)) {
      const property = schema.properties?.[key];
      // Source offsets intentionally use positive unit-number keys.
      if (!property && !schema.properties && /^[1-9]\d*$/.test(key) && Number.isSafeInteger(entry) && (entry as number) >= 0) continue;
      if (!property) throw new Error('Unknown tool argument.');
      validate(property, entry, depth + 1);
    }
  }
}
export function validateLatticeHarnessArgs(name: string, value: unknown): Record<string, unknown> {
  const tool = LATTICE_HARNESS_TOOLS.find(tool => tool.name === name);
  if (!tool) throw new Error('Unknown Lattice tool. Writes require concrete Workbench user review.');
  if (name === 'lattice.pdf.proposeAnnotations' && value && typeof value === 'object' && !Array.isArray(value)) {
    const annotations = (value as Record<string, unknown>).annotations;
    if (Array.isArray(annotations) && annotations.length <= 50) {
      for (const annotation of annotations) {
        if (annotation && typeof annotation === 'object' && !Array.isArray(annotation)) {
          const style = annotation as Record<string, unknown>;
          validateHarnessAnnotationStyle({ type: style.type, color: style.color });
        }
      }
    }
  }
  validate(tool.parameters as Schema, value);
  return value as Record<string, unknown>;
}
