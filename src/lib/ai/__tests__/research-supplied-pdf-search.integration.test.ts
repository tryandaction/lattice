// @vitest-environment node
import {beforeEach,expect,it,vi} from 'vitest';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {createAuthorizedSourceIndex} from '../source-index';
import {createLatticeSourcePdfToolRuntime} from '../lattice-skills/source-pdf-tool-runtime';
import {SourceTestDirectory,SourceTestFile} from './fixtures/source-workspace';
import {runResearchAgent} from '../research-agent';
import {useAgentSessionStore} from '@/stores/agent-session-store';
import {useAgentMemoryStore} from '@/stores/agent-memory-store';
vi.mock('@/lib/pdf-js-document-loader',()=>({loadPdfJsDocument:async({data}:{data:ArrayBuffer})=>{const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');return pdfjs.getDocument({data:new Uint8Array(data),useSystemFonts:true}).promise;}}));
beforeEach(()=>{useAgentSessionStore.setState({sessions:[],activeSessionId:null});useAgentMemoryStore.setState({entries:[],loaded:true,persistenceError:null});});
const path='papers/selected.pdf';
const core=['context-pack','evidence-resolve','synthesize-answer'].map(id=>({id,title:id,description:id}));
async function fixture(){const root=new SourceTestDirectory('workspace'),file=root.add(new SourceTestDirectory('papers')).add(new SourceTestFile('selected.pdf',''));
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);for(let page=1;page<=42;page++)pdf.addPage([612,792]).drawText(page===39?'QubitKey_LATE_SUPPLIED_SENTINEL measured fidelity 0.996.':'Synthetic orientation background '+page,{x:24,y:730,size:11,font});const bytes=await pdf.save();file.getFile=async()=>new File([bytes.slice().buffer],'selected.pdf',{type:'application/pdf',lastModified:1});
 const index=createAuthorizedSourceIndex({rootHandle:root.handle(),workspaceKey:'supplied-test',selections:[{kind:'folder',path:'.'}]});const runtime=createLatticeSourcePdfToolRuntime({index,root:root.handle(),workspaceKey:'supplied-test'});const execute=vi.fn(runtime.execute);return{index,execute,input:{task:'Explain QubitKey',query:'What is QubitKey in this paper?',sourceIntentQuery:'What is QubitKey in this paper?',filePath:path,workspaceKey:'supplied-test',sourceSelections:[{kind:'file' as const,path}],latticeSourcePdfRuntime:{execute},planSteps:core,compact:false,suggestMemory:false,maxReadToolSteps:3,maxObservationReplans:0,requireAnswer:true}};}
it('searches beyond supplied PDF pages 1-2 when the current question is supported only by page 39',async()=>{const state=await fixture();try{const result=await runResearchAgent({...state.input,content:'[PDF text extracted from selected.pdf; supplied pages 1, 2 of 42.]\n--- Page 1 ---\nOnly general introduction.\n--- Page 2 ---\nOnly general methods.\n[PDF extraction limited to 2 pages. Omitted pages were not read.]',generateAnswer:async messages=>{expect(JSON.stringify(messages)).toContain('QubitKey_LATE_SUPPLIED_SENTINEL');return{text:'The actual page 39 describes QubitKey.'};}});expect(state.execute.mock.calls[0][0]).toBe('lattice.sources.search');expect(result.promptContext.evidenceRefs.some(ref=>ref.locator.endsWith('#page=39'))).toBe(true);}finally{state.index.invalidate();}},30000);
it.each([
 {label:'relevant supplied evidence',content:'--- Page 2 ---\nQubitKey uses the supplied two metastable levels.'},
 {label:'plain supplied content without partial markers',content:'Verified user supplied source text for direct explanation.'},
 {label:'explicit selection',content:'--- Page 1 ---\nGeneral intro',selection:'Explain only this exact selected sentence.'},
 {label:'explicit requested page',content:'--- Page 2 ---\nGeneral methods',sourceIntentQuery:'Explain only page 2.'},
 {label:'complete extracted source',content:'[PDF text extracted from selected.pdf; supplied pages 1, 2 of 2.]\n--- Page 1 ---\nIntroduction\n--- Page 2 ---\nConclusion'},
])('does not force extra reads for $label',async options=>{const state=await fixture();try{await runResearchAgent({...state.input,...options,generateAnswer:async()=>({text:'Based on the supplied scope.'})});expect(state.execute).not.toHaveBeenCalled();}finally{state.index.invalidate();}},30000);
