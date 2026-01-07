"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { MainSlideAreaProps } from "@/types/ppt-viewer";
import { cn } from "@/lib/utils";
import { renderLatex } from "@/lib/formula-converter";

/**
 * Main Slide Area Component
 * 
 * Displays the current slide with proper scaling and formula enhancement.
 * No built-in navigation buttons - navigation is handled via keyboard/wheel.
 */
export function MainSlideArea({
  currentSlide,
  slideWidth,
  slideHeight,
  onNavigate,
  extractedFormulas = [],
  extractedTexts = [],
}: MainSlideAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const slideContainerRef = useRef<HTMLDivElement>(null);
  const lastWheelTime = useRef(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Render the slide content with formula enhancement
  useEffect(() => {
    if (slideContainerRef.current && currentSlide?.element) {
      setIsTransitioning(true);
      slideContainerRef.current.innerHTML = '';
      
      // Clone the slide element - DO NOT modify its styles
      const clone = currentSlide.element.cloneNode(true) as HTMLElement;
      
      // Debug: Log the clone content
      console.log('[PPT] Slide index:', currentSlide.index);
      console.log('[PPT] Clone innerHTML length:', clone.innerHTML.length);
      console.log('[PPT] Clone children count:', clone.children.length);
      console.log('[PPT] Extracted formulas count:', extractedFormulas.length);
      console.log('[PPT] Extracted texts count:', extractedTexts.length);
      
      // Check if the slide has formulas that need to be displayed
      const textContent = clone.textContent?.trim() || '';
      
      console.log('[PPT] Text content length:', textContent.length);
      console.log('[PPT] Text content preview:', textContent.substring(0, 150));
      
      // Debug: Log extracted texts
      if (extractedTexts.length > 0) {
        console.log('[PPT] Extracted texts:');
        extractedTexts.forEach((t, i) => {
          console.log(`  [${i}] ${t.isTitle ? '[TITLE]' : ''} ${t.isMath ? '[MATH]' : ''} ${t.text.substring(0, 60)}...`);
        });
      }
      
      // STEP 1: Determine what content is missing
      // Compare extracted text with rendered text to find missing content
      const extractedBodyTexts = extractedTexts.filter(p => !p.isTitle && p.text.length > 5 && p.text !== '[FORMULA]');
      const extractedTextLength = extractedBodyTexts.map(p => p.text).join('').length;
      const renderedTextLength = textContent.length;
      
      // Check if we have math content or formulas
      const hasMathContent = extractedTexts.some(t => t.isMath);
      const hasFormulas = extractedFormulas.length > 0;
      
      // Check if body text is missing
      // Simple rule: if we have extracted body text but very little rendered text
      const bodyTextMissing = extractedTextLength > 50 && renderedTextLength < extractedTextLength * 0.5;
      
      // CRITICAL: If we have formulas or math content, we MUST inject content
      // because pptx-preview cannot render OMML formulas
      const mustInjectContent = hasFormulas || hasMathContent;
      
      console.log('[PPT] Extracted body text length:', extractedTextLength);
      console.log('[PPT] Rendered text length:', renderedTextLength);
      console.log('[PPT] Body text missing:', bodyTextMissing);
      console.log('[PPT] Has math content:', hasMathContent);
      console.log('[PPT] Has formulas:', hasFormulas);
      console.log('[PPT] Must inject content:', mustInjectContent);
      
      // STEP 2: Inject content if needed
      if (mustInjectContent || bodyTextMissing) {
        // Inject all extracted content (text + formulas)
        console.log('[PPT] Injecting content (formulas or missing text)');
        injectTextContent(clone, extractedTexts, extractedFormulas);
      }
      
      // CRITICAL FIX: Remove any overflow:hidden from the clone and all its children
      // pptx-preview may set overflow:hidden which clips content
      clone.style.overflow = 'visible';
      const allElements = clone.querySelectorAll('*');
      allElements.forEach((el) => {
        const htmlEl = el as HTMLElement;
        if (htmlEl.style) {
          htmlEl.style.overflow = 'visible';
        }
      });
      
      // Also check for any CSS classes that might set overflow
      // and remove the overflow property from computed styles
      const removeOverflowHidden = (element: HTMLElement) => {
        const computed = window.getComputedStyle(element);
        if (computed.overflow === 'hidden' || computed.overflowY === 'hidden' || computed.overflowX === 'hidden') {
          element.style.overflow = 'visible';
          element.style.overflowX = 'visible';
          element.style.overflowY = 'visible';
        }
      };
      removeOverflowHidden(clone);
      allElements.forEach((el) => removeOverflowHidden(el as HTMLElement));
      
      // Get the ORIGINAL dimensions from the source element
      const sourceElement = currentSlide.element;
      
      // Get declared dimensions from pptx-preview - this is the PRIMARY source of truth
      const declaredWidth = parseFloat(sourceElement.style.width) || sourceElement.offsetWidth || 960;
      const declaredHeight = parseFloat(sourceElement.style.height) || sourceElement.offsetHeight || 540;
      
      console.log('[PPT] Declared dimensions:', declaredWidth, 'x', declaredHeight);
      
      // Check for content overflow using scrollWidth/scrollHeight
      // These are reliable even in off-screen containers
      const scrollWidth = sourceElement.scrollWidth;
      const scrollHeight = sourceElement.scrollHeight;
      
      // Only scan children if scroll dimensions suggest overflow
      let contentWidth = scrollWidth;
      let contentHeight = scrollHeight;
      
      // If scroll dimensions are larger than declared, scan children for precise bounds
      if (scrollWidth > declaredWidth || scrollHeight > declaredHeight) {
        // Scan children to find actual content bounds
        const children = sourceElement.querySelectorAll('*');
        let maxRight = 0;
        let maxBottom = 0;
        
        children.forEach((child) => {
          const el = child as HTMLElement;
          
          // Skip invisible elements
          if (el.offsetWidth === 0 && el.offsetHeight === 0) return;
          
          // Use offsetLeft/offsetTop + dimensions for position
          // This is more reliable than getBoundingClientRect for off-screen elements
          const left = el.offsetLeft;
          const top = el.offsetTop;
          const width = el.offsetWidth;
          const height = el.offsetHeight;
          
          // Also check inline styles for absolute positioned elements
          const styleLeft = parseFloat(el.style.left) || 0;
          const styleTop = parseFloat(el.style.top) || 0;
          const styleWidth = parseFloat(el.style.width) || 0;
          const styleHeight = parseFloat(el.style.height) || 0;
          
          // Use the larger of offset or style values
          const effectiveLeft = Math.max(left, styleLeft);
          const effectiveTop = Math.max(top, styleTop);
          const effectiveWidth = Math.max(width, styleWidth);
          const effectiveHeight = Math.max(height, styleHeight);
          
          const right = effectiveLeft + effectiveWidth;
          const bottom = effectiveTop + effectiveHeight;
          
          if (right > maxRight) maxRight = right;
          if (bottom > maxBottom) maxBottom = bottom;
        });
        
        contentWidth = Math.max(scrollWidth, maxRight);
        contentHeight = Math.max(scrollHeight, maxBottom);
      }
      
      console.log('[PPT] Content bounds:', contentWidth, 'x', contentHeight);
      
      // FINAL DIMENSIONS: Use declared size, but expand if content overflows
      // Add small padding only if we're expanding beyond declared size
      const OVERFLOW_PADDING = 10;
      const originalWidth = contentWidth > declaredWidth 
        ? contentWidth + OVERFLOW_PADDING 
        : declaredWidth;
      const originalHeight = contentHeight > declaredHeight 
        ? contentHeight + OVERFLOW_PADDING 
        : declaredHeight;
      
      console.log(`[PPT] Final dimensions: ${originalWidth}x${originalHeight}`);
      console.log(`[PPT] Target container: ${slideWidth}x${slideHeight}`);
      
      // Calculate scale to fit container while preserving aspect ratio
      const scaleX = slideWidth / originalWidth;
      const scaleY = slideHeight / originalHeight;
      const scale = Math.min(scaleX, scaleY);
      
      // Calculate centered position
      const scaledWidth = originalWidth * scale;
      const scaledHeight = originalHeight * scale;
      const offsetX = (slideWidth - scaledWidth) / 2;
      const offsetY = (slideHeight - scaledHeight) / 2;
      
      console.log(`[PPT] Scale: ${scale.toFixed(4)}, Offset: (${offsetX.toFixed(1)}, ${offsetY.toFixed(1)})`);
      
      // Create wrapper - this is the ONLY element we style
      // The clone keeps its original styles intact
      // CRITICAL: Use the calculated dimensions to ensure all content is visible
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        position: absolute;
        left: ${offsetX}px;
        top: ${offsetY}px;
        width: ${originalWidth}px;
        height: ${originalHeight}px;
        transform: scale(${scale});
        transform-origin: 0 0;
        background: white;
        overflow: visible;
      `;
      
      // Append clone WITHOUT modifying its styles
      wrapper.appendChild(clone);
      slideContainerRef.current.appendChild(wrapper);
      
      requestAnimationFrame(() => {
        setIsTransitioning(false);
      });
    }
  }, [currentSlide, slideWidth, slideHeight, extractedFormulas, extractedTexts]);

  /**
   * Enhance formula-like text in the slide by converting it to proper KaTeX rendering
   * 
   * This function scans the slide for text that looks like mathematical formulas
   * (e.g., "n_od(x,y) = OD(x,y)/θ_i") and converts them to properly rendered math.
   * 
   * @returns The number of text elements that were enhanced
   */
  function enhanceFormulaTextInSlide(slideElement: HTMLElement): number {
    let enhancedCount = 0;
    
    // Patterns that indicate formula-like text (must match at least one)
    const formulaIndicators = [
      // Subscript patterns: x_i, n_od, etc.
      /_[a-zA-Z0-9]+/,
      // Greek letters (both Unicode and common representations)
      /[αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ]/,
      // Mathematical operators
      /[÷×·∑∏∫∂∇√∞±∓≤≥≠≈≡∈∉⊂⊃∪∩∀∃→←↔⇒⇐⇔]/,
      // Fraction-like patterns with letters: OD(x,y)/θ
      /[a-zA-Z][a-zA-Z0-9()]*\/[a-zA-Z]/,
      // Superscript patterns: x^2, e^x
      /\^[a-zA-Z0-9]+/,
    ];
    
    // Additional patterns that suggest mathematical content
    const mathContextPatterns = [
      // Variable with subscript: n_od, x_i
      /[a-zA-Z]_[a-zA-Z0-9]+/,
      // Function notation with comma: f(x,y), OD(x,y)
      /[A-Za-z]+\([^)]*,[^)]*\)/,
      // Equals with variables on both sides: x = y
      /[a-zA-Z]\s*=\s*[a-zA-Z0-9]/,
      // Common math functions
      /\b(sin|cos|tan|log|ln|exp|sqrt|sum|prod|int)\b/i,
    ];
    
    // Find all text-containing elements (spans, divs with text)
    const walker = document.createTreeWalker(
      slideElement,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const text = node.textContent?.trim() || '';
          // Skip very short or very long text
          if (text.length < 3 || text.length > 300) return NodeFilter.FILTER_REJECT;
          // Skip if parent is already a KaTeX element or processed
          const parent = node.parentElement;
          if (parent?.classList.contains('katex') || 
              parent?.classList.contains('formula-enhanced') ||
              parent?.classList.contains('pptx-formula-replaced') ||
              parent?.closest('.katex') ||
              parent?.closest('.formula-enhanced') ||
              parent?.closest('.pptx-content-overlay')) {
            return NodeFilter.FILTER_REJECT;
          }
          
          // Check if text looks like a formula
          // Must match at least one strong indicator OR two context patterns
          const hasStrongIndicator = formulaIndicators.some(pattern => pattern.test(text));
          const contextMatches = mathContextPatterns.filter(pattern => pattern.test(text)).length;
          
          const looksLikeFormula = hasStrongIndicator || contextMatches >= 2;
          return looksLikeFormula ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );
    
    const nodesToProcess: Text[] = [];
    let currentNode: Node | null;
    while ((currentNode = walker.nextNode())) {
      nodesToProcess.push(currentNode as Text);
    }
    
    console.log(`[PPT] Found ${nodesToProcess.length} potential formula text nodes`);
    
    for (const textNode of nodesToProcess) {
      const text = textNode.textContent?.trim() || '';
      const parent = textNode.parentElement;
      if (!parent) continue;
      
      // Convert the text to LaTeX
      const latex = convertPlainTextToLatex(text);
      if (!latex) continue;
      
      console.log(`[PPT] Converting: "${text}" -> "${latex}"`);
      
      // Render with KaTeX
      const html = renderLatex(latex, false);
      if (!html || !html.includes('katex')) {
        console.log(`[PPT] KaTeX render failed for: "${latex}"`);
        continue;
      }
      
      // Create a span to hold the rendered formula
      // Preserve the parent's font size and color
      const computedStyle = window.getComputedStyle(parent);
      const span = document.createElement('span');
      span.className = 'formula-enhanced';
      span.innerHTML = html;
      span.style.cssText = `
        display: inline-block;
        font-size: ${computedStyle.fontSize};
        color: ${computedStyle.color};
        vertical-align: middle;
      `;
      
      // Replace the text node with the rendered formula
      textNode.replaceWith(span);
      enhancedCount++;
      
      console.log(`[PPT] Enhanced formula: "${text}"`);
    }
    
    return enhancedCount;
  }

  /**
   * Enhance formula-like elements (spans, divs) that contain mathematical content
   * This is a more aggressive approach that looks at element-level content
   */
  function enhanceFormulaElements(slideElement: HTMLElement): number {
    let enhancedCount = 0;
    
    // Find all span and div elements that might contain formulas
    const elements = slideElement.querySelectorAll('span, div, p');
    
    for (const element of Array.from(elements)) {
      const htmlElement = element as HTMLElement;
      
      // Skip if already processed
      if (htmlElement.classList.contains('formula-enhanced') ||
          htmlElement.classList.contains('formula-enhanced-container') ||
          htmlElement.classList.contains('katex') ||
          htmlElement.classList.contains('pptx-formula-replaced') ||
          htmlElement.closest('.katex') ||
          htmlElement.closest('.formula-enhanced') ||
          htmlElement.closest('.pptx-content-overlay')) {
        continue;
      }
      
      // Skip if has too many children (likely a container)
      if (htmlElement.children.length > 5) continue;
      
      const text = htmlElement.textContent?.trim() || '';
      
      // Skip very short or very long text
      if (text.length < 5 || text.length > 200) continue;
      
      // Check for formula indicators
      const hasGreek = /[αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ]/.test(text);
      const hasSubscript = /_[a-zA-Z0-9]/.test(text);
      const hasSuperscript = /\^[a-zA-Z0-9]/.test(text);
      const hasFraction = /[a-zA-Z0-9]+\/[a-zA-Z0-9]+/.test(text);
      const hasMathOp = /[÷×·∑∏∫∂∇√∞±∓≤≥≠≈≡∈∉⊂⊃∪∩∀∃→←↔⇒⇐⇔]/.test(text);
      const hasEquals = /[a-zA-Z]\s*=\s*[a-zA-Z0-9]/.test(text);
      const hasFunction = /[A-Za-z]+\([^)]*\)/.test(text);
      const hasMathFunc = /\b(sin|cos|tan|log|ln|exp|sqrt)\b/i.test(text);
      
      // Count how many indicators are present
      const indicatorCount = [hasGreek, hasSubscript, hasSuperscript, hasFraction, hasMathOp, hasEquals, hasFunction, hasMathFunc]
        .filter(Boolean).length;
      
      // Need at least 2 indicators to be considered a formula
      if (indicatorCount < 2) continue;
      
      console.log(`[PPT] Found formula element: "${text}" (${indicatorCount} indicators)`);
      
      // Convert to LaTeX
      const latex = convertPlainTextToLatex(text);
      if (!latex) {
        console.log(`[PPT] Could not convert to LaTeX: "${text}"`);
        continue;
      }
      
      // Render with KaTeX
      const html = renderLatex(latex, false);
      if (!html || !html.includes('katex')) {
        console.log(`[PPT] KaTeX render failed for: "${latex}"`);
        continue;
      }
      
      // Preserve the element's styling
      const computedStyle = window.getComputedStyle(htmlElement);
      
      // Replace the element content
      const wrapper = document.createElement('span');
      wrapper.className = 'formula-enhanced';
      wrapper.innerHTML = html;
      wrapper.style.cssText = `
        display: inline-block;
        font-size: ${computedStyle.fontSize};
        color: ${computedStyle.color};
        vertical-align: middle;
      `;
      
      // Replace content
      htmlElement.innerHTML = '';
      htmlElement.appendChild(wrapper);
      htmlElement.classList.add('formula-enhanced-container');
      
      enhancedCount++;
      console.log(`[PPT] Enhanced element formula: "${text}"`);
    }
    
    return enhancedCount;
  }

  /**
   * Convert plain text that looks like a formula to LaTeX
   * 
   * Examples:
   * - "n_od(x,y) = OD(x,y)/θ_i" -> "n_{od}(x,y) = \\frac{OD(x,y)}{\\theta_i}"
   * - "N = ncols·pdxdy" -> "N = ncols \\cdot pdxdy"
   */
  function convertPlainTextToLatex(text: string): string | null {
    if (!text || text.length < 2) return null;
    
    let latex = text;
    
    // Convert Greek letters
    const greekMap: Record<string, string> = {
      'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta',
      'ε': '\\epsilon', 'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta',
      'ι': '\\iota', 'κ': '\\kappa', 'λ': '\\lambda', 'μ': '\\mu',
      'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi', 'ρ': '\\rho',
      'σ': '\\sigma', 'τ': '\\tau', 'υ': '\\upsilon', 'φ': '\\phi',
      'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
      'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda',
      'Ξ': '\\Xi', 'Π': '\\Pi', 'Σ': '\\Sigma', 'Φ': '\\Phi',
      'Ψ': '\\Psi', 'Ω': '\\Omega',
    };
    
    for (const [greek, latexGreek] of Object.entries(greekMap)) {
      latex = latex.replace(new RegExp(greek, 'g'), latexGreek);
    }
    
    // Convert mathematical operators
    const operatorMap: Record<string, string> = {
      '·': ' \\cdot ',
      '×': ' \\times ',
      '÷': ' \\div ',
      '±': ' \\pm ',
      '∓': ' \\mp ',
      '≤': ' \\leq ',
      '≥': ' \\geq ',
      '≠': ' \\neq ',
      '≈': ' \\approx ',
      '≡': ' \\equiv ',
      '∈': ' \\in ',
      '∉': ' \\notin ',
      '⊂': ' \\subset ',
      '⊃': ' \\supset ',
      '∪': ' \\cup ',
      '∩': ' \\cap ',
      '∀': ' \\forall ',
      '∃': ' \\exists ',
      '→': ' \\rightarrow ',
      '←': ' \\leftarrow ',
      '↔': ' \\leftrightarrow ',
      '⇒': ' \\Rightarrow ',
      '⇐': ' \\Leftarrow ',
      '⇔': ' \\Leftrightarrow ',
      '∞': ' \\infty ',
      '∂': ' \\partial ',
      '∇': ' \\nabla ',
      '∑': ' \\sum ',
      '∏': ' \\prod ',
      '∫': ' \\int ',
    };
    
    for (const [op, latexOp] of Object.entries(operatorMap)) {
      latex = latex.replace(new RegExp(op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), latexOp);
    }
    
    // Convert subscripts: x_i -> x_{i}, x_od -> x_{od}
    latex = latex.replace(/_([a-zA-Z0-9]+)/g, '_{$1}');
    
    // Convert superscripts: x^2 -> x^{2}
    latex = latex.replace(/\^([a-zA-Z0-9]+)/g, '^{$1}');
    
    // Convert simple fractions: a/b -> \frac{a}{b}
    // But be careful not to convert things like "x/y" in the middle of text
    // Only convert if it looks like a standalone fraction
    latex = latex.replace(/([a-zA-Z0-9_{}\\]+)\/([a-zA-Z0-9_{}\\]+)/g, (match, num, den) => {
      // If numerator or denominator is complex (has subscripts, etc.), use frac
      if (num.includes('{') || den.includes('{') || num.length > 2 || den.length > 2) {
        return `\\frac{${num}}{${den}}`;
      }
      return match; // Keep simple fractions as-is
    });
    
    // Return the latex - the KaTeX renderer will handle it
    // Even if no backslashes, subscripts and fractions are still valid
    return latex;
  }

  /**
   * Inject text content and formulas into the slide
   * 
   * Strategy: Replace 【公式】 placeholders with actual rendered formulas
   * 
   * CRITICAL: Font sizes must be proportional to the ORIGINAL slide dimensions (2560x1920),
   * not the viewport size. The entire slide (including this overlay) will be scaled down
   * via CSS transform, so we need to use large pixel values that match the original PPT.
   * 
   * Layout must fit ALL content within the visible area - use compact spacing.
   */
  function injectTextContent(
    slideElement: HTMLElement,
    texts: Array<{ text: string; isTitle?: boolean; isBullet?: boolean; isMath?: boolean; level?: number }>,
    formulas: Array<{ latex: string; html: string }>
  ): void {
    // Filter valid formulas
    const validFormulas = formulas.filter(f => f.html?.includes('katex'));
    
    console.log('[PPT] injectTextContent called with', texts.length, 'texts and', validFormulas.length, 'valid formulas');
    
    // Get the slide's actual dimensions to calculate proportional font sizes
    const slideWidth = parseFloat(slideElement.style.width) || slideElement.offsetWidth || 2560;
    const slideHeight = parseFloat(slideElement.style.height) || slideElement.offsetHeight || 1920;
    
    // Calculate scale factor based on slide dimensions
    const scaleFactor = Math.min(slideWidth / 960, slideHeight / 720);
    
    // Count content items to determine appropriate sizing
    const contentCount = texts.filter(t => !t.isTitle && t.text.trim()).length;
    const hasLotsOfContent = contentCount > 8;
    
    // Use adaptive sizing based on content amount
    // More content = smaller font to fit everything
    const fontMultiplier = hasLotsOfContent ? 18 : 20;
    const baseFontSize = Math.round(fontMultiplier * scaleFactor);
    const lineHeight = hasLotsOfContent ? 1.3 : 1.35;
    const paragraphGap = Math.round((hasLotsOfContent ? 4 : 6) * scaleFactor);
    const padding = Math.round(16 * scaleFactor);
    
    console.log(`[PPT] Slide dimensions: ${slideWidth}x${slideHeight}, scale factor: ${scaleFactor.toFixed(2)}, base font: ${baseFontSize}px, content count: ${contentCount}`);
    
    // Create a content container - NO background, compact layout
    const container = document.createElement('div');
    container.className = 'pptx-content-overlay';
    container.style.cssText = `
      position: absolute;
      top: 10%;
      left: 3%;
      right: 3%;
      bottom: 1%;
      display: flex;
      flex-direction: column;
      gap: ${paragraphGap}px;
      padding: ${padding}px;
      font-size: ${baseFontSize}px;
      line-height: ${lineHeight};
      color: #222;
      background: transparent;
      overflow: visible;
      z-index: 10;
      pointer-events: none;
    `;
    
    let formulaIndex = 0;
    let addedElements = 0;
    
    // Calculate proportional spacing values - compact to fit all content
    const formulaMargin = Math.round(2 * scaleFactor);
    const formulaPadding = Math.round(4 * scaleFactor);
    const indentSize = Math.round(16 * scaleFactor);
    
    // Get existing text content from the slide to avoid duplicates
    const existingText = slideElement.textContent?.trim() || '';
    
    // Process texts
    for (let i = 0; i < texts.length; i++) {
      const para = texts[i];
      let text = para.text.trim();
      
      // Skip empty texts
      if (!text) continue;
      
      // Skip titles (pptx-preview already renders them)
      if (para.isTitle) continue;
      
      // Skip short texts that already appear in the slide (likely titles/headers)
      // This catches titles that weren't marked as isTitle
      if (text.length < 20 && !text.includes('【公式】') && existingText.includes(text)) {
        console.log(`[PPT] Skipping duplicate text: "${text}"`);
        continue;
      }
      
      // Create paragraph element
      const p = document.createElement('p');
      const indent = para.isBullet ? '0' : `${indentSize}px`;
      const paddingLeft = para.level ? `${para.level * indentSize * 0.75}px` : '0';
      
      p.style.cssText = `
        margin: 0;
        text-align: justify;
        text-indent: ${indent};
        padding-left: ${paddingLeft};
      `;
      
      // Check if text contains formula placeholder
      if (text.includes('【公式】')) {
        // Split text by formula placeholder and interleave with formulas
        const parts = text.split('【公式】');
        
        for (let j = 0; j < parts.length; j++) {
          // Add text part
          if (parts[j].trim()) {
            const textSpan = document.createElement('span');
            textSpan.textContent = parts[j];
            p.appendChild(textSpan);
          }
          
          // Add formula (except after the last part)
          if (j < parts.length - 1 && formulaIndex < validFormulas.length) {
            const formula = validFormulas[formulaIndex];
            const formulaSpan = document.createElement('span');
            formulaSpan.className = 'pptx-inline-formula';
            formulaSpan.innerHTML = formula.html;
            formulaSpan.style.cssText = `
              display: inline-block;
              vertical-align: middle;
              margin: 0 ${formulaMargin}px;
              font-size: 1.1em;
            `;
            p.appendChild(formulaSpan);
            formulaIndex++;
          }
        }
        
        container.appendChild(p);
        addedElements++;
      } else if (text === '【公式】') {
        // Standalone formula
        if (formulaIndex < validFormulas.length) {
          const formula = validFormulas[formulaIndex];
          const formulaDiv = document.createElement('div');
          formulaDiv.className = 'pptx-formula-display';
          formulaDiv.innerHTML = formula.html;
          formulaDiv.style.cssText = `
            text-align: center;
            padding: ${formulaPadding}px 0;
            margin: ${formulaMargin}px 0;
            font-size: 1.05em;
          `;
          container.appendChild(formulaDiv);
          formulaIndex++;
          addedElements++;
        }
      } else {
        // Regular text without formula
        if (para.isBullet) {
          p.textContent = '• ' + text;
        } else {
          p.textContent = text;
        }
        container.appendChild(p);
        addedElements++;
      }
    }
    
    // Add remaining formulas at the end
    while (formulaIndex < validFormulas.length) {
      const formula = validFormulas[formulaIndex];
      const formulaDiv = document.createElement('div');
      formulaDiv.className = 'pptx-formula-display';
      formulaDiv.innerHTML = formula.html;
      formulaDiv.style.cssText = `
        text-align: center;
        padding: ${formulaPadding}px 0;
        margin: ${formulaMargin}px 0;
        font-size: 1.05em;
      `;
      container.appendChild(formulaDiv);
      formulaIndex++;
      addedElements++;
    }
    
    // Append container if we have content
    if (addedElements > 0) {
      slideElement.appendChild(container);
      console.log(`[PPT] Injected overlay with ${addedElements} elements, used ${formulaIndex} formulas`);
    } else {
      console.log('[PPT] No elements to inject');
    }
  }

  /**
   * Replace plain text formulas with KaTeX rendered versions
   * 
   * pptx-preview often renders OMML formulas as plain text like:
   * - "n_od(x,y) = OD(x,y)/θ_i"
   * - "N = ncols·pdxdy"
   * 
   * This function finds text nodes containing formula-like content and replaces them
   * with properly rendered KaTeX formulas.
   * 
   * @returns true if any formulas were replaced
   */
  function replaceTextFormulasWithKatex(
    slideElement: HTMLElement,
    formulas: Array<{ latex: string; html: string }>
  ): boolean {
    if (formulas.length === 0) return false;
    
    // Filter to only valid KaTeX formulas
    const validFormulas = formulas.filter(f => f.html?.includes('katex'));
    if (validFormulas.length === 0) return false;
    
    let replacedCount = 0;
    
    // Strategy 1: Find elements that look like they contain formula text
    // These are typically spans or divs with mathematical symbols
    const formulaPatterns = [
      /[=+\-*/÷×·∑∏∫∂∇√∞±∓≤≥≠≈≡∈∉⊂⊃∪∩∀∃→←↔⇒⇐⇔αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ]/,
      /\b[a-zA-Z]_\{?[a-zA-Z0-9]+\}?/,  // subscript notation like x_i
      /\b[a-zA-Z]\^?\{?[a-zA-Z0-9]+\}?/,  // superscript notation like x^2
      /\([^)]*[,;][^)]*\)/,  // function arguments like (x,y)
      /\bOD\b|\bln\b|\blog\b|\bsin\b|\bcos\b|\btan\b|\bexp\b/i,  // common functions
    ];
    
    // Find all text-containing elements
    const textElements = slideElement.querySelectorAll('span, p, div');
    const processedElements = new Set<Element>();
    
    for (const element of Array.from(textElements)) {
      // Skip if already processed or if it's a container with many children
      if (processedElements.has(element)) continue;
      if (element.children.length > 3) continue;
      
      const text = element.textContent?.trim() || '';
      if (text.length < 3 || text.length > 200) continue;
      
      // Check if this looks like a formula
      const looksLikeFormula = formulaPatterns.some(pattern => pattern.test(text));
      if (!looksLikeFormula) continue;
      
      // Find the best matching formula
      const matchingFormula = findBestMatchingFormula(text, validFormulas);
      if (matchingFormula) {
        // Replace the element content with KaTeX rendered formula
        const htmlElement = element as HTMLElement;
        const originalStyles = htmlElement.style.cssText;
        
        // Create a wrapper to preserve positioning
        const wrapper = document.createElement('span');
        wrapper.className = 'pptx-formula-replaced';
        wrapper.innerHTML = matchingFormula.html;
        wrapper.style.cssText = `
          display: inline-block;
          ${originalStyles}
        `;
        
        // Replace the content
        htmlElement.innerHTML = '';
        htmlElement.appendChild(wrapper);
        htmlElement.classList.add('formula-replaced');
        
        processedElements.add(element);
        replacedCount++;
        
        console.log(`[PPT] Replaced formula text: "${text.substring(0, 50)}..." with KaTeX`);
      }
    }
    
    // Strategy 2: If no direct replacements, try to find formula containers
    // and append KaTeX formulas near them
    if (replacedCount === 0 && validFormulas.length > 0) {
      // Look for elements that might be formula containers (empty or with minimal content)
      const potentialContainers = slideElement.querySelectorAll('.block, [style*="position: absolute"]');
      
      for (const container of Array.from(potentialContainers)) {
        const htmlContainer = container as HTMLElement;
        const text = htmlContainer.textContent?.trim() || '';
        
        // Check if this container has formula-like text
        if (text.length > 0 && text.length < 150) {
          const looksLikeFormula = formulaPatterns.some(pattern => pattern.test(text));
          if (looksLikeFormula && validFormulas.length > replacedCount) {
            const formula = validFormulas[replacedCount];
            
            // Append the KaTeX formula
            const formulaDiv = document.createElement('div');
            formulaDiv.className = 'pptx-formula-appended';
            formulaDiv.innerHTML = formula.html;
            formulaDiv.style.cssText = `
              margin-top: 4px;
              text-align: center;
            `;
            
            htmlContainer.appendChild(formulaDiv);
            replacedCount++;
            
            console.log(`[PPT] Appended formula to container with text: "${text.substring(0, 30)}..."`);
          }
        }
      }
    }
    
    console.log(`[PPT] Replaced ${replacedCount} formulas with KaTeX`);
    return replacedCount > 0;
  }

  /**
   * Find the best matching formula for a given text
   * Uses fuzzy matching based on common formula elements
   */
  function findBestMatchingFormula(
    text: string,
    formulas: Array<{ latex: string; html: string }>
  ): { latex: string; html: string } | null {
    if (formulas.length === 0) return null;
    
    // Normalize the text for comparison
    const normalizedText = text
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[(){}[\]]/g, '');
    
    let bestMatch: { latex: string; html: string } | null = null;
    let bestScore = 0;
    
    for (const formula of formulas) {
      // Extract key elements from LaTeX
      const latexElements = extractLatexElements(formula.latex);
      
      // Calculate match score
      let score = 0;
      for (const element of latexElements) {
        if (normalizedText.includes(element.toLowerCase())) {
          score += element.length;
        }
      }
      
      // Bonus for similar length
      const lengthRatio = Math.min(normalizedText.length, formula.latex.length) / 
                          Math.max(normalizedText.length, formula.latex.length);
      score *= (0.5 + lengthRatio * 0.5);
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = formula;
      }
    }
    
    // Only return if we have a reasonable match
    return bestScore > 3 ? bestMatch : null;
  }

  /**
   * Extract key elements from LaTeX for matching
   */
  function extractLatexElements(latex: string): string[] {
    const elements: string[] = [];
    
    // Extract variable names (single letters)
    const vars = latex.match(/[a-zA-Z]/g) || [];
    elements.push(...vars);
    
    // Extract numbers
    const nums = latex.match(/\d+/g) || [];
    elements.push(...nums);
    
    // Extract Greek letters (without backslash)
    const greekMatch = latex.match(/\\(alpha|beta|gamma|delta|epsilon|theta|lambda|mu|nu|pi|sigma|tau|phi|psi|omega)/gi) || [];
    for (const match of greekMatch) {
      elements.push(match.replace('\\', ''));
    }
    
    // Extract function names
    const funcMatch = latex.match(/\\(frac|sqrt|sum|prod|int|log|ln|sin|cos|tan|exp)/gi) || [];
    for (const match of funcMatch) {
      elements.push(match.replace('\\', ''));
    }
    
    return elements;
  }

  /**
   * Inject formulas into the slide
   * This handles the case where pptx-preview renders titles but not OMML formulas
   * 
   * Strategy: 
   * 1. First try to find empty blocks that might be formula placeholders
   * 2. If that fails, create an inline formula display that doesn't cover content
   */
  function injectFormulasIntoSlide(
    slideElement: HTMLElement,
    formulas: Array<{ latex: string; html: string }>,
    _existingTextLength: number
  ): void {
    if (formulas.length === 0) return;
    
    // Filter to only valid KaTeX formulas
    const validFormulas = formulas.filter(f => f.html?.includes('katex'));
    
    console.log(`[PPT] Valid formulas to inject: ${validFormulas.length} out of ${formulas.length}`);
    
    if (validFormulas.length === 0) {
      console.warn('[PPT] No valid KaTeX formulas to inject');
      return;
    }
    
    // Strategy 1: Try to find empty blocks that might be formula placeholders
    // pptx-preview sometimes creates empty divs/spans where OMML formulas should be
    const emptyBlocks = slideElement.querySelectorAll('.block, [class*="text"], p, span, div');
    let formulaIndex = 0;
    
    for (const block of Array.from(emptyBlocks)) {
      if (formulaIndex >= validFormulas.length) break;
      
      const htmlBlock = block as HTMLElement;
      const text = htmlBlock.textContent?.trim() || '';
      const hasChildren = htmlBlock.children.length > 0;
      
      // Check if this block is empty or contains only whitespace/special chars
      // This might be a formula placeholder
      if (text === '' && !hasChildren) {
        const formula = validFormulas[formulaIndex];
        htmlBlock.innerHTML = formula.html;
        htmlBlock.classList.add('formula-injected');
        htmlBlock.style.overflow = 'visible';
        formulaIndex++;
        console.log(`[PPT] Injected formula ${formulaIndex} into empty block`);
      }
    }
    
    // Strategy 2: If we still have formulas left, create a semi-transparent overlay
    // that shows formulas without completely covering the slide
    if (formulaIndex < validFormulas.length) {
      const remainingFormulas = validFormulas.slice(formulaIndex);
      console.log(`[PPT] ${remainingFormulas.length} formulas remaining, creating overlay`);
      
      const container = document.createElement('div');
      container.className = 'pptx-formula-container';
      
      // Position in the center-bottom area, semi-transparent
      container.style.cssText = `
        position: absolute;
        bottom: 8%;
        left: 10%;
        right: 10%;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        align-items: center;
        gap: 12px;
        padding: 16px 24px;
        font-size: 22px;
        line-height: 1.6;
        color: #333;
        background: rgba(255, 255, 255, 0.92);
        border-radius: 8px;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
        z-index: 10;
        max-height: 50%;
        overflow-y: auto;
      `;
      
      for (const formula of remainingFormulas) {
        const item = document.createElement('div');
        item.className = 'pptx-formula-item';
        item.innerHTML = formula.html;
        item.style.cssText = `
          text-align: center;
          padding: 6px 0;
          width: 100%;
        `;
        container.appendChild(item);
      }
      
      slideElement.appendChild(container);
    }
    
    console.log(`[PPT] Successfully injected ${validFormulas.length} formulas`);
  }

  // Wheel navigation with improved debouncing
  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const now = Date.now();
    // Increase debounce time for smoother transitions
    if (now - lastWheelTime.current < 300) return;
    // Increase threshold for more intentional scrolling
    if (Math.abs(event.deltaY) < 40) return;

    lastWheelTime.current = now;
    setIsTransitioning(true);
    onNavigate(event.deltaY > 0 ? 'next' : 'prev');
  }, [onNavigate]);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => container.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel]);

  // Keyboard navigation with smooth transitions
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if typing in an input
      if ((event.target as HTMLElement)?.tagName === 'INPUT' ||
          (event.target as HTMLElement)?.tagName === 'TEXTAREA') {
        return;
      }

      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          event.preventDefault();
          setIsTransitioning(true);
          onNavigate('prev');
          break;
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
          event.preventDefault();
          setIsTransitioning(true);
          onNavigate('next');
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNavigate]);

  return (
    <div
      ref={containerRef}
      className="flex-1 flex items-center justify-center overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, hsl(var(--muted) / 0.3) 0%, hsl(var(--muted) / 0.1) 100%)',
      }}
      tabIndex={0}
      role="region"
      aria-label="Slide viewer"
    >
      {currentSlide ? (
        <div
          className={cn(
            "relative bg-white rounded-lg overflow-hidden",
            "shadow-[0_4px_20px_rgba(0,0,0,0.1),0_8px_40px_rgba(0,0,0,0.08)]",
            "ring-1 ring-black/5",
            "transition-opacity duration-200 ease-out",
            isTransitioning && "opacity-90"
          )}
          style={{ width: slideWidth, height: slideHeight }}
        >
          <div
            ref={slideContainerRef}
            className={cn(
              "absolute inset-0",
              currentSlide.hasError && "flex items-center justify-center bg-destructive/5"
            )}
          >
            {currentSlide.hasError && (
              <div className="text-center p-4">
                <p className="text-destructive font-medium">Failed to render slide</p>
              </div>
            )}
            {!currentSlide.element && !currentSlide.hasError && (
              <div className="absolute inset-0 flex items-center justify-center bg-white">
                <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center text-muted-foreground">
          <p>No slide to display</p>
        </div>
      )}
    </div>
  );
}
