"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { init } from "pptx-preview";
import { PowerPointViewerProps, SlideData, LAYOUT_CONSTANTS } from "@/types/ppt-viewer";
import { calculateViewerLayout, detectSlideAspectRatio } from "@/lib/ppt-viewer-layout";
import { navigate, getJumpFromKeyboard } from "@/lib/ppt-navigation";
import { extractFormulasFromPptx, extractTextFromPptx, SlideFormulas, SlideTextContent } from "@/lib/pptx-formula-extractor";
import { PPTLoadingIndicator } from "./ppt-loading-indicator";
import { ThumbnailPanel } from "./ppt-thumbnail-panel";
import { MainSlideArea } from "./ppt-main-slide-area";

/**
 * PowerPoint Viewer Component
 * 
 * A comprehensive PPTX file viewer with:
 * - Left-side thumbnail navigation
 * - Adaptive layout
 * - Keyboard and mouse wheel navigation
 * - Formula rendering support (OMML extraction and KaTeX rendering)
 * - Loading progress indicator
 */
export function PowerPointViewer({ content, fileName }: PowerPointViewerProps) {
  // State
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [slideAspectRatio, setSlideAspectRatio] = useState(LAYOUT_CONSTANTS.DEFAULT_ASPECT_RATIO);
  const [slideFormulas, setSlideFormulas] = useState<SlideFormulas[]>([]);
  const [slideTexts, setSlideTexts] = useState<SlideTextContent[]>([]);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const pptxContainerRef = useRef<HTMLDivElement>(null);
  const previewerRef = useRef<ReturnType<typeof init> | null>(null);

  // Calculate layout based on container size
  const layout = useMemo(() => {
    return calculateViewerLayout(
      containerSize.width,
      containerSize.height,
      slideAspectRatio
    );
  }, [containerSize, slideAspectRatio]);

  // Observe container size changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize({ width, height });
      }
    });

    resizeObserver.observe(container);
    
    // Initial size
    const rect = container.getBoundingClientRect();
    setContainerSize({ width: rect.width, height: rect.height });

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Load and render PPTX file
  useEffect(() => {
    const container = pptxContainerRef.current;
    if (!content || !container) return;

    const loadPPTX = async () => {
      try {
        setIsLoading(true);
        setLoadingProgress(10);
        setLoadingStatus("Parsing presentation...");
        setError(null);

        // Create separate buffer copies upfront to avoid detachment issues
        // Each operation gets its own copy of the buffer
        const contentForFormulas = content.slice(0);
        const contentForTexts = content.slice(0);
        const contentForPreview = content.slice(0);

        // Extract formulas from PPTX file first
        setLoadingProgress(15);
        setLoadingStatus("Extracting formulas...");

        try {
          const formulas = await extractFormulasFromPptx(contentForFormulas);
          setSlideFormulas(formulas);
          const totalFormulas = formulas.reduce((sum, s) => sum + s.formulas.length, 0);
          console.log(`[PPT] Extracted ${totalFormulas} formulas from ${formulas.length} slides`);

          // Log details for each slide with formulas
          formulas.forEach(sf => {
            if (sf.formulas.length > 0) {
              console.log(`[PPT] Slide ${sf.slideIndex}: ${sf.formulas.length} formulas`);
              sf.formulas.forEach((f, i) => {
                console.log(`  [${i}] LaTeX: ${f.latex?.substring(0, 80) || 'EMPTY'}`);
              });
            }
          });

          // Also extract text content using separate buffer
          const texts = await extractTextFromPptx(contentForTexts);
          setSlideTexts(texts);
          console.log(`[PPT] Extracted text from ${texts.length} slides`);
          texts.forEach(st => {
            if (st.paragraphs.length > 0) {
              console.log(`[PPT] Slide ${st.slideIndex}: ${st.paragraphs.length} paragraphs`);
            }
          });
        } catch (formulaError) {
          console.warn('[PPT] Formula/text extraction failed:', formulaError);
          // Continue without formulas - don't block slide rendering
        }

        // Initialize pptx-preview with larger dimensions to capture all content
        // Use 2560x1920 to support both 16:9 and 4:3 aspect ratios at high resolution
        const previewer = init(container, {
          width: 2560,
          height: 1920,
        });
        previewerRef.current = previewer;

        setLoadingProgress(30);
        setLoadingStatus("Rendering slides...");

        // Preview the PPTX file using the dedicated buffer copy
        await previewer.preview(contentForPreview);

        setLoadingProgress(70);
        setLoadingStatus("Processing slides...");

        // Wait for DOM to be fully rendered
        await new Promise(resolve => setTimeout(resolve, 500));

        // Extract rendered slides from the container
        // Check if container is still available (component might have unmounted)
        if (!container.isConnected) {
          console.warn('[PPT] Container ref is null after async operation, component may have unmounted');
          return;
        }
        
        // Debug: Log the container structure
        console.log('[PPT] Container HTML structure:', container.innerHTML?.substring(0, 500) || 'empty');
        
        // pptx-preview renders slides - find the actual slide elements
        let slideDivs: Element[] = [];
        
        // Check for wrapper div that contains all slides
        const wrapper = container.querySelector('.pptx-wrapper') || container.firstElementChild;
        
        if (wrapper) {
          console.log('[PPT] Found wrapper:', wrapper.tagName, wrapper.className);
          console.log('[PPT] Wrapper children count:', wrapper.children.length);
          
          // pptx-preview renders slides as section elements
          // Try to find section elements first
          const sections = wrapper.querySelectorAll('section');
          if (sections.length > 0) {
            slideDivs = Array.from(sections);
            console.log('[PPT] Found sections:', sections.length);
          } else {
            // Fallback: Get direct children of wrapper, excluding style/script
            slideDivs = Array.from(wrapper.children).filter(child => {
              const tagName = child.tagName.toLowerCase();
              return tagName !== 'style' && tagName !== 'script';
            });
          }
        }
        
        // If still no slides, try container's direct children
        if (slideDivs.length === 0) {
          const sections = container.querySelectorAll('section');
          if (sections.length > 0) {
            slideDivs = Array.from(sections);
          } else {
            slideDivs = Array.from(container.children).filter(child => {
              const tagName = child.tagName.toLowerCase();
              return tagName !== 'style' && tagName !== 'script';
            });
          }
        }
        
        console.log('[PPT] Total slides found:', slideDivs.length);
        if (slideDivs.length > 0) {
          const firstSlide = slideDivs[0] as HTMLElement;
          console.log('[PPT] First slide:', firstSlide.tagName, 'size:', firstSlide.offsetWidth, 'x', firstSlide.offsetHeight);
          console.log('[PPT] First slide style:', firstSlide.style.cssText);
        }

        setLoadingProgress(85);

        // Create slide data array
        const slideDataArray: SlideData[] = slideDivs.map((element, index) => ({
          index,
          element: element as HTMLElement,
          thumbnailElement: null,
          hasError: false,
        }));

        // Detect aspect ratio from first slide if available
        if (slideDivs.length > 0) {
          const firstSlide = slideDivs[0] as HTMLElement;
          const width = firstSlide.offsetWidth || 960;
          const height = firstSlide.offsetHeight || 540;
          setSlideAspectRatio(detectSlideAspectRatio(width, height));
        }

        setSlides(slideDataArray);
        // Ensure we start from the first slide
        setCurrentSlideIndex(0);
        setLoadingProgress(100);
        setLoadingStatus("Complete");

        // Small delay before hiding loading indicator for smooth transition
        setTimeout(() => {
          setIsLoading(false);
        }, 300);

      } catch (err) {
        console.error("Error loading PPTX:", err);
        setError(err instanceof Error ? err.message : "Failed to load presentation");
        setIsLoading(false);
      }
    };

    loadPPTX();

    return () => {
      // Cleanup - safely clear the container
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [content]);

  // Handle slide navigation
  const handleNavigate = useCallback((direction: 'prev' | 'next') => {
    const result = navigate(currentSlideIndex, slides.length, direction);
    if (result.changed) {
      setCurrentSlideIndex(result.newIndex);
    }
  }, [currentSlideIndex, slides.length]);

  // Handle thumbnail click
  const handleSlideSelect = useCallback((index: number) => {
    if (index >= 0 && index < slides.length) {
      setCurrentSlideIndex(index);
    }
  }, [slides.length]);

  // Handle keyboard navigation for Home/End
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const jump = getJumpFromKeyboard(event);
      if (jump) {
        event.preventDefault();
        if (jump === 'first') {
          setCurrentSlideIndex(0);
        } else {
          setCurrentSlideIndex(slides.length - 1);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [slides.length]);

  // Get current slide and its formulas
  const currentSlide = slides[currentSlideIndex] || null;
  const currentFormulas = slideFormulas.find(sf => sf.slideIndex === currentSlideIndex)?.formulas || [];
  const currentTexts = slideTexts.find(st => st.slideIndex === currentSlideIndex)?.paragraphs || [];

  // Error state
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 bg-background">
        <div className="text-center">
          <p className="text-destructive font-medium">Error loading presentation</p>
          <p className="text-sm text-muted-foreground mt-2">{error}</p>
          <p className="text-xs text-muted-foreground mt-4">{fileName}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full bg-background overflow-hidden"
    >
      {/* Hidden container for pptx-preview rendering - must be large enough for any slide */}
      <div
        ref={pptxContainerRef}
        className="absolute opacity-0 pointer-events-none"
        style={{ 
          width: '2560px', 
          height: '1920px', 
          left: '-9999px',
          top: '0px',
          overflow: 'visible',
          position: 'absolute',
        }}
      />

      {/* Loading indicator */}
      <PPTLoadingIndicator
        progress={loadingProgress}
        status={loadingStatus}
        isVisible={isLoading}
      />

      {/* Main content (hidden while loading) */}
      {!isLoading && slides.length > 0 && (
        <>
          {/* Thumbnail panel */}
          <ThumbnailPanel
            slides={slides}
            currentSlideIndex={currentSlideIndex}
            onSlideSelect={handleSlideSelect}
            panelWidth={layout.thumbnailPanelWidth}
            containerHeight={containerSize.height}
            slidesWithFormulas={slideFormulas.filter(sf => sf.formulas.length > 0).map(sf => sf.slideIndex)}
            slideFormulas={slideFormulas}
            slideTexts={slideTexts}
          />

          {/* Main slide area */}
          <MainSlideArea
            currentSlide={currentSlide}
            slideScale={layout.slideScale}
            slideWidth={layout.slideWidth}
            slideHeight={layout.slideHeight}
            onNavigate={handleNavigate}
            extractedFormulas={currentFormulas}
            extractedTexts={currentTexts}
          />
        </>
      )}

      {/* Empty state */}
      {!isLoading && slides.length === 0 && !error && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">No slides found in presentation</p>
        </div>
      )}
    </div>
  );
}
