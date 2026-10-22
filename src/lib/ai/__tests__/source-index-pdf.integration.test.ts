// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createAuthorizedSourceIndex } from '../source-index';
import { SourceTestDirectory, SourceTestFile } from './fixtures/source-workspace';

vi.mock('@/lib/pdf-js-document-loader', () => ({ loadPdfJsDocument: async ({data}: {data:ArrayBuffer}) => {
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({data:new Uint8Array(data),useSystemFonts:true}).promise;
} }));

it('searches a real 42-page PDF beyond orientation pages and returns only the unique late-page evidence', async()=>{
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let i=1;i<=42;i++)pdf.addPage([612,792]).drawText(i===41?'NEBULA_LATE_REAL_41 has measured response 0.998.':'Synthetic background on page '+i+'.',{x:24,y:730,size:11,font});
  const bytes=await pdf.save(),root=new SourceTestDirectory('workspace');
  const paper=root.add(new SourceTestFile('synthetic.pdf',''));paper.getFile=async()=>new File([bytes.slice().buffer],'synthetic.pdf',{type:'application/pdf',lastModified:1});
  const other=root.add(new SourceTestFile('unrelated.txt','irrelevant source must not be opened'));
  const index=createAuthorizedSourceIndex({rootHandle:root.handle(),workspaceKey:'real-pdf-fixture',selections:[{kind:'folder',path:'.'}]});
  try {
    let cursor:number|undefined,found:Awaited<ReturnType<typeof index.search>>|undefined;
    for(let call=0;call<8;call++){const result=await index.search({query:'What does NEBULA_LATE_REAL_41 report?',paths:['synthetic.pdf'],cursor,maxFiles:1,maxUnits:8,maxChars:1200,maxResults:2,snippetChars:160});cursor=result.nextCursor;if(result.hits.length){found=result;break;}if(!cursor)break;}
    expect(found?.hits[0]).toMatchObject({unit:41,locator:'synthetic.pdf#page=41'});expect(found?.hits[0].text).toContain('0.998');
    expect(found?.reads[0].readUnits).toEqual([]);expect(found?.coverage[0].scannedUnits).toContain(41);expect(other.reads).toBe(0);
    expect(JSON.stringify(found).length).toBeLessThan(15000);
  }finally{index.invalidate();}
},30000);
