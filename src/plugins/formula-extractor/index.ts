import { FORMULA_EXTRACTOR_PLUGIN_ID } from '@/lib/plugins/defaults';
import type { PluginModule } from '@/lib/plugins/types';
import { createFormulaWorkflow, FORMULA_PANEL_ID } from './workflow';
let workflow: ReturnType<typeof createFormulaWorkflow> | null = null;
export const formulaExtractorPlugin: PluginModule = {
  manifest: {
    id: FORMULA_EXTRACTOR_PLUGIN_ID,
    name: "Formula Extractor",
    version: "1.0.0",
    description: "Extract formulas from the active PDF, DOCX, Markdown, or HTML document.",
    author: "Lattice",
    category: "official",
    entry: "builtin:formula-extractor",
    settings: [{id:'ocrCommand',type:'string',label:'Advanced OCR backend',description:'Use managed after in-app setup, or an already installed custom pix2tex executable.',default:'managed'}],
    permissions: [
      "read-current-document",
      "clipboard-write",
      "export-file",
      "use-ocr",
      "ui:commands",
      "ui:panels",
    ],
    activationEvents: ["onStartupFinished", "onCommand:formula-extractor.extract.document"],
    recommended: true,
    defaultEnabled: true,
    contributes: {
      commands: [
        { id: "formula-extractor.extract.document", title: "Extract formulas", opensPanel: true },
        { id: "formula-extractor.extract.current-page", title: "Extract formulas from current page", opensPanel: true },
        { id: "formula-extractor.extract.selection", title: "Extract formulas from selection", opensPanel: true },
        { id: "formula-extractor.ocr.selection", title: "OCR selected formula region", opensPanel: true },
      ],
      panels: [
        {
          id: FORMULA_PANEL_ID,
          title: "Formula Extractor",
          icon: "sigma",
          schema: {
            type: "custom",
            title: "Formula Extractor",
            description: "Formulas detected in the active document.",
            props: {
              kind: "formula-extractor.results",
              result: null,
              busy: false,
              error: null,
              progress: 0,
              canCancel: false,
              canRetry: false,
            },
          },
          actions: [],
        },
      ],
    },
  },
  activate(ctx) {
    workflow?.dispose();
    const session=createFormulaWorkflow(ctx);workflow=session;
    ctx.panels.register(this.manifest.contributes!.panels![0]);
    const register=(id:string,title:string,run:(payload?:unknown)=>void|Promise<void>)=>ctx.commands.register({id:'formula-extractor.'+id,title,opensPanel:id.startsWith('extract.')||id==='ocr.selection',run});
    register('extract.document','Extract formulas',()=>session.start({scope:'document'}));
    register('extract.current-page','Extract formulas from current page',()=>session.start({scope:'current-page'}));
    register('extract.selection','Extract formulas from selection',()=>session.start({scope:'selection'}));
    register('ocr.selection','OCR selected formula region',()=>session.start({scope:'selection',ocr:true}));
    register('cancel','Cancel formula scan',()=>session.cancel());
    register('retry','Retry formula scan',()=>session.retry());
    register('update-formula','Correct formula LaTeX',payload=>session.edit((payload??{}) as Parameters<typeof session.edit>[0]));
    register('copy-formula-latex','Copy formula as LaTeX',payload=>session.copy((payload??{}) as Parameters<typeof session.copy>[0],'latex'));
    register('copy-formula-markdown','Copy formula as Markdown',payload=>session.copy((payload??{}) as Parameters<typeof session.copy>[0],'markdown'));
    register('copy-formula','Copy formula as LaTeX',payload=>session.copy((payload??{}) as Parameters<typeof session.copy>[0],'latex'));
    register('reveal-formula','Reveal formula in document',payload=>session.reveal((payload??{}) as Parameters<typeof session.reveal>[0]));
    register('export-markdown','Export formulas.md',payload=>session.exportResults('markdown',(payload??{}) as Parameters<typeof session.exportResults>[1]));
    register('export-latex','Export formulas.tex',payload=>session.exportResults('latex',(payload??{}) as Parameters<typeof session.exportResults>[1]));
  },
  deactivate() { workflow?.dispose();workflow=null; },
};
