import { describe, expect, it } from 'vitest';
import type { AgentSourceChunk, AgentSourceRead } from '@/lib/ai/source-index';
import { prepareVerifiedAnnotationDraftBatch, AnnotationQuoteValidationError } from '../pdf-tool-helpers';
const path='synthetic-paper.pdf';
const snapshot: AgentSourceRead['snapshot']={path,sourceId:'paper',workspaceKey:'workspace',version:'v1',kind:'pdf',totalUnits:2,unitLabel:'page'};
function read(text:string):AgentSourceRead{const length=text.length;const chunk:AgentSourceChunk={path,sourceId:snapshot.sourceId,version:'v1',unit:1,locator:path+'#page=1',text,startOffset:0,endOffset:length,completeUnit:true,unitLength:length};return {snapshot,chunks:[chunk],complete:false,readUnits:[],pendingUnits:[2],unreadableUnits:[],scannedChars:length};}
const previous=['# Human notes','Keep exactly.'].join(String.fromCharCode(10))+String.fromCharCode(10);
const valid={page:1,quote:'The verified claim holds.',type:'highlight' as const};const invented={page:1,quote:'A tempting but absent claim.',type:'underline' as const};
describe('partial verified PDF annotation batch',()=>{
it('preserves human notes and valid AI quotes while identifying rejected items',()=>{const result=prepareVerifiedAnnotationDraftBatch(previous,[valid,invented],read('The verified claim holds. Adjacent context.'));expect(result).toMatchObject({acceptedCount:1,rejectedCount:1,validationDetails:{issues:[{annotationIndex:1,page:1,reason:'quote_not_found'}]}});expect(result.content).toContain('# Human notes'+String.fromCharCode(10)+'Keep exactly.');expect(result.content).toContain('- Quote: The verified claim holds.');expect(result.content).not.toContain(invented.quote);});
it('fails when every suggestion is invalid',()=>{expect(()=>prepareVerifiedAnnotationDraftBatch(previous,[invented],read('The verified claim holds.'))).toThrow(AnnotationQuoteValidationError);});
it('does not downgrade unread pages or invalid styles into partial success',()=>{expect(()=>prepareVerifiedAnnotationDraftBatch(previous,[valid,{...invented,page:16}],read('The verified claim holds.'))).toThrow(AnnotationQuoteValidationError);expect(()=>prepareVerifiedAnnotationDraftBatch(previous,[valid,{...invented,color:'bad'}],read('The verified claim holds.'))).toThrow(/annotation color/i);});
});
