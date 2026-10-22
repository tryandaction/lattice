/** Convert only the unambiguous whole-formula grouped plain-TeX root dialect.
 * Never replace predicted characters, infer a missing group or repair a matrix.
 */
export function normalizeOcrLatex(latex:string):string {
  if(latex.length>20000)return latex;
  const match=/^\\root\s+([A-Za-z0-9][A-Za-z0-9+*/\s-]{0,127})\\of\s*(\{[\s\S]*\})$/.exec(latex);
  if(!match||!match[1].trim())return latex;
  const group=match[2];let depth=0;
  for(let index=0;index<group.length;index++){
    if(group[index]==='\\'){index++;continue;}
    if(group[index]==='{')depth++;
    if(group[index]==='}')depth--;
    if(depth<0||depth===0&&index!==group.length-1)return latex;
  }
  return depth===0?`\\sqrt[${match[1].trim()}]${group}`:latex;
}
