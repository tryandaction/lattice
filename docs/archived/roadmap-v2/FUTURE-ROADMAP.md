# Future Roadmap - Mobile, Tablet, AI Integration

## Overview

This document outlines **future features** that are NOT part of the current sprint but represent the long-term vision for Lattice. These features require significant investment and may have cost implications.

**Current Focus**: Zero-cost, local-first features that can be implemented now.

**Future Focus**: Platform expansion and AI-powered features.

---

## Phase A: Mobile & Tablet Adaptation

### Priority: Future (Post-v1.0)
### Estimated Effort: High (40-60 hours)
### Dependencies: Core features stable

### A1. Responsive UI for Small Screens

**Goal**: Make Lattice usable on phones and tablets.

**Key Changes**:
- Collapsible sidebar (already started)
- Touch-friendly button sizes (44px minimum)
- Swipe gestures for navigation
- Pinch-to-zoom for documents
- Virtual keyboard considerations

**Implementation Approach**:
```typescript
// Breakpoints
const BREAKPOINTS = {
  mobile: 640,
  tablet: 1024,
  desktop: 1280,
};

// Responsive hook
function useResponsive() {
  const [device, setDevice] = useState<'mobile' | 'tablet' | 'desktop'>('desktop');

  useEffect(() => {
    const checkDevice = () => {
      const width = window.innerWidth;
      if (width < BREAKPOINTS.mobile) setDevice('mobile');
      else if (width < BREAKPOINTS.tablet) setDevice('tablet');
      else setDevice('desktop');
    };

    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => window.removeEventListener('resize', checkDevice);
  }, []);

  return device;
}
```

### A2. Touch Gesture Support

**Goal**: Natural touch interactions for tablets.

**Gestures**:
- Two-finger pinch: Zoom
- Two-finger scroll: Pan
- Swipe left/right: Page navigation
- Long press: Context menu
- Double tap: Zoom to fit

**Implementation**:
```typescript
import { useGesture } from '@use-gesture/react';

function useTouchGestures(containerRef) {
  useGesture({
    onPinch: ({ offset: [scale] }) => {
      setZoom(scale);
    },
    onDrag: ({ offset: [x, y] }) => {
      setPan({ x, y });
    },
    onDoubleTap: () => {
      resetView();
    },
  }, {
    target: containerRef,
    eventOptions: { passive: false },
  });
}
```

### A3. Mobile-Optimized Annotation

**Goal**: Annotation on touchscreens.

**Features**:
- Finger-friendly color picker
- Simplified toolbar
- Easy text selection on mobile
- Stylus support for precision

---

## Phase B: Tablet Handwriting Features

### Priority: Future (Post-v1.0)
### Estimated Effort: Very High (60-80 hours)
### Dependencies: Mobile adaptation complete

### B1. Stylus Handwriting Input

**Goal**: Write notes by hand on tablet with stylus.

**Features**:
- Pressure sensitivity
- Palm rejection
- Smooth ink rendering
- Variable stroke width

**Technology Options**:
- HTML Canvas with pointer events
- SVG path rendering
- WebGL for performance
- Dedicated handwriting library (e.g., myscript, handwriting.js)

### B2. Handwriting to Text (OCR)

**Goal**: Convert handwritten notes to editable text.

**Approaches**:

#### Option 1: Local OCR (Zero-Cost)
- Tesseract.js (WASM-based OCR)
- Limited accuracy for handwriting
- Works offline

```typescript
import Tesseract from 'tesseract.js';

async function recognizeHandwriting(imageData: ImageData): Promise<string> {
  const result = await Tesseract.recognize(imageData, 'eng+chi_sim');
  return result.data.text;
}
```

#### Option 2: Cloud OCR (Has Cost)
- Google Cloud Vision API
- Azure Computer Vision
- AWS Textract
- High accuracy
- Requires API keys and usage fees

#### Option 3: On-Device ML (Future)
- TensorFlow.js with custom model
- Train on handwriting datasets
- No cloud dependency
- Significant development effort

### B3. Smart Layout & Formatting

**Goal**: Auto-format recognized text into structured notes.

**Features**:
- Detect headings (larger text)
- Detect lists (bullet patterns)
- Detect formulas (math symbols)
- Convert to Markdown

**This is complex and may require AI assistance.**

---

## Phase C: AI Integration

### Priority: Future (Post-v1.0)
### Estimated Effort: Varies by feature
### Dependencies: Consider cost model

### C1. Local AI Options (Zero-Cost)

These can run locally without API costs:

#### Ollama Integration
```typescript
// Use local Ollama instance for AI features
async function queryLocalLLM(prompt: string): Promise<string> {
  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      model: 'llama2',
      prompt,
    }),
  });
  return response.json();
}
```

#### Features with Local AI:
- Summarize highlighted text
- Explain formula
- Suggest related concepts
- Answer questions about document

### C2. Cloud AI Options (Has Cost)

For higher quality, consider:

#### OpenAI API
- GPT-4 for complex reasoning
- Embeddings for semantic search
- Requires API key and budget

#### Anthropic Claude API
- Claude for analysis
- Similar cost model to OpenAI

#### Cost Mitigation:
- User provides their own API key
- Usage limits/warnings
- Local cache to reduce calls

### C3. Potential AI Features

| Feature | Local Possible? | Cloud Recommended? |
|---------|-----------------|-------------------|
| Text summarization | Yes (limited) | Yes (better) |
| Formula explanation | Possible | Yes |
| Document Q&A | Yes (RAG) | Yes |
| Auto-tagging | Yes | Yes |
| Translation | Yes (limited) | Yes |
| Grammar check | Yes | Yes |
| Citation extraction | Possible | Yes |

### C4. RAG (Retrieval Augmented Generation)

**Goal**: AI that understands your entire library.

**Architecture**:
```
User Query → Embedding → Vector Search → Context → LLM → Answer
```

**Local Implementation**:
- Use sentence-transformers for embeddings
- ChromaDB or similar for vector store
- Ollama for generation

**This is a significant feature requiring dedicated development.**

---

## Phase D: Advanced Features

### D1. Collaboration (Future)

**Options**:
- Real-time collaboration (requires backend)
- File sharing via cloud storage
- Export/import annotation bundles

### D2. Plugin System

**Goal**: Allow community extensions.

**Architecture**:
```typescript
interface LatticePlugin {
  name: string;
  version: string;
  init(api: PluginAPI): void;
  destroy(): void;
}

// Plugin can:
// - Add menu items
// - Add tools
// - Process documents
// - Integrate with external services
```

### D3. Cross-Platform Sync

**Options**:
- iCloud/Google Drive integration
- Custom sync server (has cost)
- Peer-to-peer sync (complex)

---

## Cost Considerations

### Zero-Cost Stack (Current Focus)
- ✅ Local file storage (File System Access API)
- ✅ Browser-based processing
- ✅ Tauri for desktop
- ✅ No backend required

### Low-Cost Options
- Self-hosted sync (user's own server)
- User-provided API keys for AI
- WebRTC for P2P features

### Cost-Incurring Features
- Cloud OCR services
- Cloud AI services
- Hosted collaboration backend
- App Store distribution

---

## Implementation Timeline Suggestion

### v1.0 (Current Sprint)
Focus on bugs and core feature polish.

### v1.1
- Mobile-responsive UI
- Basic touch support

### v1.2
- Tablet optimization
- Stylus support for ink

### v2.0
- Handwriting recognition (local OCR)
- Basic AI features (local Ollama)

### v2.x
- Cloud AI integration (optional)
- Collaboration features (optional)
- Plugin system

---

## Community Feedback Needed

Before investing in future features, gather user feedback on:

1. **Platform Priority**: Mobile vs Tablet vs Desktop?
2. **AI Importance**: How important is AI assistance?
3. **Cost Tolerance**: Would users pay for advanced features?
4. **Handwriting Usage**: Do STEM users prefer typing or handwriting?
5. **Collaboration Need**: Individual tool vs team tool?

---

## Technical Debt to Address First

Before adding major features, address:

1. Test coverage improvement
2. Performance optimization
3. Accessibility improvements
4. Documentation completeness
5. Error handling consistency

---

## Conclusion

The future of Lattice is exciting, with many possibilities for expansion. However, maintaining the **zero-cost, local-first** philosophy is important. Any cloud features should be:

- **Optional** (core features work without them)
- **User-controlled** (bring your own API key)
- **Transparent** (clear about what uses cloud)

Focus on making the current features **excellent** before expanding scope.
