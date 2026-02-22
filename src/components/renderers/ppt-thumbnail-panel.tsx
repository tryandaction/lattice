"use client";

import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { ThumbnailPanelProps, ThumbnailItemProps } from "@/types/ppt-viewer";
import { cn } from "@/lib/utils";

/**
 * Props for ThumbnailItem with formula support
 */
interface ThumbnailItemPropsExtended extends ThumbnailItemProps {
  hasFormulas?: boolean;
  formulaCount?: number;
  slideTexts?: Array<{ text: string; isTitle?: boolean }>;
}

/**
 * Single Thumbnail Item Component
 * 
 * For slides with formulas, we show a simplified preview since
 * pptx-preview cannot render OMML formulas.
 */
function ThumbnailItem({
  slide,
  index,
  isSelected,
  onClick,
  width,
  height,
  hasFormulas,
  formulaCount = 0,
  slideTexts = [],
}: ThumbnailItemPropsExtended) {
  const thumbnailRef = useRef<HTMLDivElement>(null);
  const [isRendered, setIsRendered] = useState(false);
  const [contentStatus, setContentStatus] = useState<'loading' | 'normal' | 'empty' | 'formula'>('loading');

  // Clone and scale the slide content for thumbnail
  useEffect(() => {
    if (!thumbnailRef.current || !slide.element) return;
    if (isRendered) return;

    // Clear previous content
    thumbnailRef.current.innerHTML = '';
    
    // Clone the slide element
    const clone = slide.element.cloneNode(true) as HTMLElement;
    
    // Get original dimensions
    const originalWidth = slide.element.offsetWidth || 960;
    const originalHeight = slide.element.offsetHeight || 540;
    
    // Check if the slide has visible content from pptx-preview
    const textContent = clone.textContent?.trim() || '';
    const hasImages = clone.querySelectorAll('img').length > 0;
    const hasSvg = clone.querySelectorAll('svg').length > 0;
    
    // Determine content status
    const hasVisiblePptxContent = textContent.length > 10 || hasImages || hasSvg;
    
    if (hasFormulas && !hasVisiblePptxContent) {
      // Slide has formulas but pptx-preview couldn't render content
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setContentStatus('formula');
      setIsRendered(true);
      return;
    }
    
    if (!hasVisiblePptxContent && !hasFormulas) {
      // Truly empty slide
      setContentStatus('empty');
      setIsRendered(true);
      return;
    }
    
    // Normal slide with visible content
    setContentStatus('normal');
    
    // Calculate scale to fit thumbnail
    const scaleX = width / originalWidth;
    const scaleY = height / originalHeight;
    const scale = Math.min(scaleX, scaleY);
    
    // Create wrapper with original dimensions
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      width: ${originalWidth}px;
      height: ${originalHeight}px;
      transform: scale(${scale});
      transform-origin: top left;
      pointer-events: none;
      position: absolute;
      top: 0;
      left: 0;
    `;
    
    // Apply styling to clone
    clone.style.cssText = `
      width: ${originalWidth}px;
      height: ${originalHeight}px;
      overflow: hidden;
      position: relative;
    `;
    
    wrapper.appendChild(clone);
    thumbnailRef.current.appendChild(wrapper);
    setIsRendered(true);
  }, [slide.element, width, height, isRendered, hasFormulas]);

  // Get title from slide texts
  const slideTitle = useMemo(() => {
    const titlePara = slideTexts.find(t => t.isTitle);
    if (titlePara) return titlePara.text.substring(0, 30);
    // Fallback: get first non-empty text
    const firstText = slideTexts.find(t => t.text.length > 3 && !t.text.includes('【公式】'));
    return firstText?.text.substring(0, 30) || '';
  }, [slideTexts]);

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center gap-1.5 p-1.5 rounded-lg transition-all duration-200",
        "hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        isSelected && "bg-primary/10 ring-2 ring-primary"
      )}
      title={`Slide ${index + 1}${slideTitle ? `: ${slideTitle}` : ''}`}
    >
      {/* Thumbnail container */}
      <div
        ref={thumbnailRef}
        className={cn(
          "relative rounded-md border overflow-hidden bg-white",
          "shadow-sm hover:shadow-md transition-shadow duration-200",
          isSelected ? "border-primary border-2" : "border-border",
          slide.hasError && "border-destructive"
        )}
        style={{
          width: `${width}px`,
          height: `${height}px`,
        }}
      >
        {/* Formula slide preview - show when pptx-preview couldn't render formulas */}
        {contentStatus === 'formula' && (
          <div className="absolute inset-0 flex flex-col bg-gradient-to-br from-slate-50 to-blue-50 p-2">
            {/* Title if available */}
            {slideTitle && (
              <div className="text-[7px] font-medium text-slate-700 truncate mb-1 leading-tight">
                {slideTitle}
              </div>
            )}
            {/* Formula indicator */}
            <div className="flex-1 flex flex-col items-center justify-center">
              <div className="text-lg text-blue-600 mb-0.5">∑</div>
              <div className="text-[6px] text-slate-500">
                {formulaCount > 1 ? `${formulaCount} 公式` : '公式'}
              </div>
            </div>
            {/* Mini formula preview lines */}
            <div className="space-y-0.5 mt-auto">
              <div className="h-1 bg-slate-200 rounded w-3/4"></div>
              <div className="h-1 bg-blue-200 rounded w-1/2"></div>
              <div className="h-1 bg-slate-200 rounded w-2/3"></div>
            </div>
          </div>
        )}
        
        {/* Empty slide placeholder */}
        {contentStatus === 'empty' && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50">
            <span className="text-[8px] text-slate-400">空白页</span>
          </div>
        )}
        
        {/* Formula indicator badge - show on all slides with formulas */}
        {hasFormulas && contentStatus !== 'formula' && (
          <div className="absolute top-0.5 right-0.5 z-10 bg-blue-500 text-white text-[6px] px-1 py-0.5 rounded font-medium">
            ƒ{formulaCount > 1 ? formulaCount : ''}
          </div>
        )}
        
        {/* Error overlay */}
        {slide.hasError && (
          <div className="absolute inset-0 flex items-center justify-center bg-destructive/10">
            <span className="text-[8px] text-destructive">Error</span>
          </div>
        )}
        
        {/* Loading placeholder */}
        {!slide.element && !slide.hasError && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
            <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        )}
      </div>
      
      {/* Slide number */}
      <span className={cn(
        "text-[10px] tabular-nums",
        isSelected ? "text-primary font-semibold" : "text-muted-foreground"
      )}>
        {index + 1}
      </span>
    </button>
  );
}

/**
 * Thumbnail Panel Component
 * 
 * Displays a vertical scrollable list of slide thumbnails.
 * For slides with formulas that pptx-preview can't render,
 * shows a simplified preview with formula indicators.
 */
export function ThumbnailPanel({
  slides,
  currentSlideIndex,
  onSlideSelect,
  panelWidth,
  containerHeight,
  slidesWithFormulas = [],
  slideFormulas = [],
  slideTexts = [],
}: ThumbnailPanelProps & {
  slideFormulas?: Array<{ slideIndex: number; formulas: Array<unknown> }>;
  slideTexts?: Array<{ slideIndex: number; paragraphs: Array<{ text: string; isTitle?: boolean }> }>;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 20 });
  const isInitialMount = useRef(true);

  // Create maps for O(1) lookup
  const formulaSlideSet = useMemo(() => new Set(slidesWithFormulas), [slidesWithFormulas]);
  
  const formulaCountMap = useMemo(() => {
    const map = new Map<number, number>();
    slideFormulas.forEach(sf => {
      map.set(sf.slideIndex, sf.formulas.length);
    });
    return map;
  }, [slideFormulas]);
  
  const slideTextsMap = useMemo(() => {
    const map = new Map<number, Array<{ text: string; isTitle?: boolean }>>();
    slideTexts.forEach(st => {
      map.set(st.slideIndex, st.paragraphs);
    });
    return map;
  }, [slideTexts]);

  // Calculate thumbnail dimensions based on panel width
  const thumbnailWidth = Math.max(panelWidth - 16, 80);
  const thumbnailHeight = Math.round(thumbnailWidth / (16 / 9));
  const itemHeight = thumbnailHeight + 24;

  // Calculate visible range based on scroll position
  const updateVisibleRange = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight;
    
    const buffer = 5;
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
    const end = Math.min(slides.length, Math.ceil((scrollTop + viewportHeight) / itemHeight) + buffer);
    
    setVisibleRange({ start, end });
  }, [itemHeight, slides.length]);

  // Update visible range on scroll
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      requestAnimationFrame(updateVisibleRange);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    container.scrollTop = 0;
    updateVisibleRange();

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [updateVisibleRange, slides.length]);

  // Auto-scroll to current slide
  const scrollToCurrentSlide = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const targetScrollTop = currentSlideIndex * itemHeight - (container.clientHeight / 2) + (itemHeight / 2);
    const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, container.scrollHeight - container.clientHeight));
    
    container.scrollTo({
      top: clampedScrollTop,
      behavior: 'smooth',
    });
  }, [currentSlideIndex, itemHeight]);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    scrollToCurrentSlide();
  }, [currentSlideIndex, scrollToCurrentSlide]);

  const visibleSlides = useMemo(() => {
    return slides.slice(visibleRange.start, visibleRange.end);
  }, [slides, visibleRange]);

  if (panelWidth <= 0) {
    return null;
  }

  const totalHeight = slides.length * itemHeight;

  return (
    <div
      className="flex flex-col h-full border-r border-border"
      style={{ 
        width: `${panelWidth}px`,
        background: 'linear-gradient(180deg, hsl(var(--muted) / 0.4) 0%, hsl(var(--muted) / 0.2) 100%)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-background/50 backdrop-blur-sm">
        <span className="text-xs font-medium text-foreground">
          Slides
        </span>
        <span className="text-xs text-muted-foreground tabular-nums font-medium">
          {currentSlideIndex + 1} / {slides.length}
        </span>
      </div>
      
      {/* Scrollable thumbnail list */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin"
        style={{ maxHeight: `${containerHeight - 40}px` }}
      >
        <div
          className="relative px-2 py-2"
          style={{ height: `${totalHeight}px` }}
        >
          {visibleSlides.map((slide, idx) => {
            const actualIndex = visibleRange.start + idx;
            return (
              <div
                key={actualIndex}
                className="absolute left-2 right-2"
                style={{ top: `${actualIndex * itemHeight}px` }}
              >
                <ThumbnailItem
                  slide={slide}
                  index={actualIndex}
                  isSelected={actualIndex === currentSlideIndex}
                  onClick={() => onSlideSelect(actualIndex)}
                  width={thumbnailWidth}
                  height={thumbnailHeight}
                  hasFormulas={formulaSlideSet.has(actualIndex)}
                  formulaCount={formulaCountMap.get(actualIndex) || 0}
                  slideTexts={slideTextsMap.get(actualIndex) || []}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
