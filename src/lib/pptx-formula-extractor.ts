/**
 * PPTX Formula Extractor
 * 
 * Extracts mathematical formulas (OMML) directly from PPTX files.
 * PPTX files are ZIP archives containing XML files with slide content.
 * 
 * This module:
 * 1. Unzips the PPTX file
 * 2. Parses slide XML files
 * 3. Extracts OMML (Office Math Markup Language) formulas
 * 4. Converts them to LaTeX for rendering with KaTeX
 */

import JSZip from 'jszip';
import { convertOmmlToLatex, renderLatex } from './formula-converter';

/**
 * Extracted formula with position information
 */
export interface ExtractedFormula {
  slideIndex: number;
  latex: string;
  html: string;
  position?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  originalOmml: string;
}

/**
 * Slide formula data
 */
export interface SlideFormulas {
  slideIndex: number;
  formulas: ExtractedFormula[];
}

/**
 * Slide text content with structure
 */
export interface SlideTextContent {
  slideIndex: number;
  paragraphs: SlideTextParagraph[];
}

export interface SlideTextParagraph {
  text: string;
  isTitle?: boolean;
  isMath?: boolean;
  isBullet?: boolean;
  level?: number;
}

/**
 * Extract text content from a PPTX file with structure
 * 
 * @param pptxBuffer - ArrayBuffer containing the PPTX file
 * @returns Array of slide text content
 */
export async function extractTextFromPptx(
  pptxBuffer: ArrayBuffer
): Promise<SlideTextContent[]> {
  try {
    const zip = await JSZip.loadAsync(pptxBuffer);
    const slideTexts: SlideTextContent[] = [];
    
    // Find all slide XML files
    const slideFiles = Object.keys(zip.files)
      .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
        const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
        return numA - numB;
      });
    
    for (let i = 0; i < slideFiles.length; i++) {
      const slideFile = slideFiles[i];
      const slideXml = await zip.file(slideFile)?.async('string');
      
      if (slideXml) {
        const paragraphs = extractTextFromSlideXml(slideXml);
        slideTexts.push({
          slideIndex: i,
          paragraphs,
        });
      }
    }
    
    return slideTexts;
  } catch (error) {
    console.error('Error extracting text from PPTX:', error);
    return [];
  }
}

/**
 * Extract text paragraphs from slide XML with structure
 * 
 * IMPORTANT: This function tries to preserve the relationship between text and formulas.
 * When a formula appears inline with text, we mark its position with a placeholder.
 */
function extractTextFromSlideXml(slideXml: string): SlideTextParagraph[] {
  const paragraphs: SlideTextParagraph[] = [];
  
  try {
    // Find text bodies and extract structured paragraphs
    const textBodyPattern = /<p:txBody[^>]*>([\s\S]*?)<\/p:txBody>/gi;
    let textBodyMatch;
    let textBodyIndex = 0;
    
    while ((textBodyMatch = textBodyPattern.exec(slideXml)) !== null) {
      const textBody = textBodyMatch[1];
      
      // Extract paragraphs from this text body
      const paraPattern = /<a:p[^>]*>([\s\S]*?)<\/a:p>/gi;
      let paraMatch;
      let paraIndex = 0;
      
      while ((paraMatch = paraPattern.exec(textBody)) !== null) {
        const paraContent = paraMatch[1];
        
        // Check if this paragraph contains math (OMML)
        const hasMath = paraContent.includes('m:oMath') || paraContent.includes(':oMath') || 
                       paraContent.includes('oMath') || paraContent.includes('a14:m');
        
        // Extract text with formula placeholders
        // We need to process the paragraph content to interleave text and formula markers
        let paraText = '';

        // Find all text runs and math elements in order
        const elementPattern = /(<a:t>([^<]*)<\/a:t>|<(?:m:|a14:)?oMath[^>]*>[\s\S]*?<\/(?:m:|a14:)?oMath>)/gi;
        let elementMatch;
        
        // Reset regex
        elementPattern.lastIndex = 0;
        
        while ((elementMatch = elementPattern.exec(paraContent)) !== null) {
          const fullMatch = elementMatch[0];
          
          if (fullMatch.startsWith('<a:t>')) {
            // Text element
            const textContent = elementMatch[2] || '';
            paraText += textContent;
          } else if (fullMatch.includes('oMath')) {
            // Math element - add placeholder
            paraText += '【公式】';
          }
        }
        
        // If no elements found, try simple text extraction
        if (!paraText) {
          const simpleTextPattern = /<a:t>([^<]*)<\/a:t>/g;
          let simpleMatch;
          while ((simpleMatch = simpleTextPattern.exec(paraContent)) !== null) {
            paraText += simpleMatch[1];
          }
        }
        
        // Determine if this is a title
        const isFirstTextBody = textBodyIndex === 0;
        const isFirstPara = paraIndex === 0;
        const hasPlaceholderTitle = slideXml.includes('type="title"') || slideXml.includes('type="ctrTitle"');
        const isTitle = isFirstTextBody && isFirstPara && hasPlaceholderTitle;
        
        // Check for bullet points
        const isBullet = paraContent.includes('<a:buChar') || paraContent.includes('<a:buAutoNum');
        
        // Get indentation level
        const levelMatch = paraContent.match(/lvl="(\d+)"/);
        const level = levelMatch ? parseInt(levelMatch[1]) : 0;
        
        // Add paragraph if it has text
        if (paraText.trim()) {
          paragraphs.push({
            text: paraText.trim(),
            isTitle: isTitle,
            isMath: hasMath,
            isBullet,
            level,
          });
        } else if (hasMath) {
          // Pure math paragraph
          paragraphs.push({
            text: '【公式】',
            isTitle: false,
            isMath: true,
            isBullet: false,
            level: 0,
          });
        }
        
        paraIndex++;
      }
      
      textBodyIndex++;
    }
    
  } catch (error) {
    console.warn('Error parsing slide XML for text:', error);
  }
  
  // Deduplicate while preserving order
  const seen = new Set<string>();
  const unique = paragraphs.filter(p => {
    // Keep formula placeholders
    if (p.text === '【公式】') return true;
    if (seen.has(p.text)) return false;
    seen.add(p.text);
    return true;
  });
  
  return unique;
}

/**
 * Extract all formulas from a PPTX file
 * 
 * @param pptxBuffer - ArrayBuffer containing the PPTX file
 * @returns Array of slide formulas
 */
export async function extractFormulasFromPptx(
  pptxBuffer: ArrayBuffer
): Promise<SlideFormulas[]> {
  try {
    const zip = await JSZip.loadAsync(pptxBuffer);
    const slideFormulas: SlideFormulas[] = [];
    
    // Find all slide XML files
    const slideFiles = Object.keys(zip.files)
      .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
        const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
        return numA - numB;
      });
    
    for (let i = 0; i < slideFiles.length; i++) {
      const slideFile = slideFiles[i];
      const slideXml = await zip.file(slideFile)?.async('string');
      
      if (slideXml) {
        const formulas = extractFormulasFromSlideXml(slideXml, i);
        slideFormulas.push({
          slideIndex: i,
          formulas,
        });
      }
    }
    
    return slideFormulas;
  } catch (error) {
    console.error('Error extracting formulas from PPTX:', error);
    return [];
  }
}

/**
 * Extract formulas from a single slide XML
 */
function extractFormulasFromSlideXml(
  slideXml: string,
  slideIndex: number
): ExtractedFormula[] {
  const formulas: ExtractedFormula[] = [];
  
  // Check if slide XML contains any math-related content
  const hasMathContent = slideXml.includes('oMath') || slideXml.includes(':oMath') || 
                         slideXml.includes('m:oMath') || slideXml.includes('a:m');
  
  if (!hasMathContent) {
    return formulas;
  }
  
  // Use DOM parser for more reliable extraction
  // This handles nested elements correctly
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(slideXml, 'text/xml');
    
    // Find all oMath elements using various namespace approaches
    const mathElements: Element[] = [];
    
    // Try different selectors
    const selectors = [
      'oMath',
      '*|oMath',
      'oMathPara',
      '*|oMathPara',
    ];
    
    for (const selector of selectors) {
      try {
        const elements = doc.querySelectorAll(selector);
        elements.forEach(el => {
          // Avoid duplicates (oMathPara contains oMath)
          if (!mathElements.some(existing => existing.contains(el) || el.contains(existing))) {
            mathElements.push(el);
          }
        });
      } catch {
        // Selector might not be valid, continue
      }
    }
    
    // Also try getElementsByTagNameNS for namespaced elements
    const namespaces = [
      'http://schemas.openxmlformats.org/officeDocument/2006/math',
      'http://schemas.microsoft.com/office/drawing/2010/main',
    ];
    
    for (const ns of namespaces) {
      try {
        const elements = doc.getElementsByTagNameNS(ns, 'oMath');
        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          if (!mathElements.some(existing => existing.contains(el) || el.contains(existing))) {
            mathElements.push(el);
          }
        }
      } catch {
        // Continue
      }
    }
    
    // Process each math element
    for (const mathEl of mathElements) {
      try {
        const ommlXml = mathEl.outerHTML || new XMLSerializer().serializeToString(mathEl);
        const latex = convertOmmlToLatex(ommlXml);
        
        if (latex && latex.trim() && latex.trim().length > 1) {
          const html = renderLatex(latex, true);
          
          if (html?.includes('katex')) {
            formulas.push({
              slideIndex,
              latex,
              html,
              originalOmml: ommlXml,
            });
          }
        }
      } catch (error) {
        console.warn('[Formula Extractor] Error converting OMML formula:', error);
      }
    }
  } catch (domError) {
    console.warn('[Formula Extractor] DOM parsing failed, falling back to regex:', domError);
    
    // Fallback to regex-based extraction
    const ommlPatterns = [
      // Standard m: namespace - use greedy matching with proper nesting
      /<m:oMathPara\b[^>]*>[\s\S]*?<\/m:oMathPara>/gi,
      /<m:oMath\b[^>]*>[\s\S]*?<\/m:oMath>/gi,
      // No namespace prefix
      /<oMathPara\b[^>]*>[\s\S]*?<\/oMathPara>/gi,
      /<oMath\b[^>]*>[\s\S]*?<\/oMath>/gi,
      // a14: namespace (used in some PPTX files)
      /<a14:m\b[^>]*>[\s\S]*?<\/a14:m>/gi,
    ];
    
    const allMatches: string[] = [];
    for (const pattern of ommlPatterns) {
      const matches = slideXml.match(pattern) || [];
      allMatches.push(...matches);
    }
    
    // Remove duplicates
    const uniqueMatches = [...new Set(allMatches)];
    
    for (const ommlXml of uniqueMatches) {
      try {
        const latex = convertOmmlToLatex(ommlXml);
        
        if (latex && latex.trim() && latex.trim().length > 1) {
          const html = renderLatex(latex, true);
          
          if (html?.includes('katex')) {
            formulas.push({
              slideIndex,
              latex,
              html,
              originalOmml: ommlXml,
            });
          }
        }
      } catch (error) {
        console.warn('[Formula Extractor] Error converting OMML formula:', error);
      }
    }
  }
  
  // Also look for MathML (some PPTX files might use it)
  const mathmlPattern = /<math[^>]*>[\s\S]*?<\/math>/gi;
  const mathmlMatches = slideXml.match(mathmlPattern) || [];
  
  for (const mathmlXml of mathmlMatches) {
    try {
      // Import and use MathML converter
      const { convertMathmlToLatex } = require('./formula-converter');
      const latex = convertMathmlToLatex(mathmlXml);
      
      if (latex && latex.trim()) {
        const html = renderLatex(latex, true);
        
        formulas.push({
          slideIndex,
          latex,
          html,
          originalOmml: mathmlXml,
        });
      }
    } catch (error) {
      console.warn('Error converting MathML formula:', error);
    }
  }
  
  return formulas;
}

/**
 * Create a formula placeholder element
 */
export function createFormulaPlaceholder(formula: ExtractedFormula): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'pptx-formula-rendered';
  wrapper.innerHTML = formula.html;
  wrapper.setAttribute('data-latex', formula.latex);
  wrapper.style.display = 'inline-block';
  return wrapper;
}

/**
 * Inject formulas into a slide element
 * 
 * This function attempts to find placeholder elements in the slide
 * and replace them with rendered formulas.
 */
export function injectFormulasIntoSlide(
  slideElement: HTMLElement,
  formulas: ExtractedFormula[]
): void {
  if (formulas.length === 0) return;
  
  // Strategy 1: Look for empty text blocks that might be formula placeholders
  const emptyBlocks = slideElement.querySelectorAll('.block, [class*="text"], p, span');
  
  let formulaIndex = 0;
  
  for (const block of Array.from(emptyBlocks)) {
    const htmlBlock = block as HTMLElement;
    const text = htmlBlock.textContent?.trim() || '';
    
    // Check if this block is empty or contains only whitespace
    // This might be a formula placeholder
    if (text === '' && htmlBlock.children.length === 0) {
      if (formulaIndex < formulas.length) {
        const formula = formulas[formulaIndex];
        htmlBlock.innerHTML = formula.html;
        htmlBlock.classList.add('formula-injected');
        formulaIndex++;
      }
    }
  }
  
  // Strategy 2: If we still have formulas, append them to the slide
  // This is a fallback when we can't find placeholders
  if (formulaIndex < formulas.length) {
    // Create a formula container at the bottom of the slide
    const formulaContainer = document.createElement('div');
    formulaContainer.className = 'pptx-formulas-container';
    formulaContainer.style.cssText = `
      position: absolute;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      justify-content: center;
      max-width: 90%;
    `;
    
    for (let i = formulaIndex; i < formulas.length; i++) {
      const formula = formulas[i];
      const wrapper = createFormulaPlaceholder(formula);
      wrapper.style.cssText = `
        background: rgba(255, 255, 255, 0.9);
        padding: 10px 15px;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      `;
      formulaContainer.appendChild(wrapper);
    }
    
    slideElement.appendChild(formulaContainer);
  }
}

/**
 * Check if JSZip is available
 */
export function isJSZipAvailable(): boolean {
  try {
    return typeof JSZip !== 'undefined';
  } catch {
    return false;
  }
}
