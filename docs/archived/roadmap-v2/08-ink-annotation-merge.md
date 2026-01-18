# Prompt 08: Ink Annotation Merge - Continuous Strokes as Single Annotation

## Priority: P3 (Enhancement)

## Overview

Currently, each ink stroke may be saved as a separate annotation. This creates clutter when users draw continuous shapes or write notes. This prompt implements **intelligent stroke merging** so that continuous drawing within a time/space threshold is treated as a **single annotation**.

---

## Related Files

- `src/components/renderers/pdf-highlighter-adapter.tsx` - PDF viewer with ink support
- `src/components/renderers/ink-canvas.tsx` - Ink drawing canvas
- `src/hooks/use-ink-drawing.ts` - Ink drawing logic
- `src/types/universal-annotation.ts` - Annotation types

---

## Current Behavior

1. User starts drawing (mouse down)
2. User draws a line (mouse move)
3. User lifts pen (mouse up) → Creates annotation #1
4. User immediately draws another stroke → Creates annotation #2
5. Result: Two separate annotations for what user perceives as one drawing

## Desired Behavior

1. User draws multiple strokes within 2 seconds and nearby area
2. All strokes are merged into ONE annotation
3. User can continue adding to the drawing
4. After 2 seconds of inactivity, the annotation is finalized
5. Result: One annotation containing all strokes

---

## Feature 1: Stroke Grouping Logic

### Goal
Determine when strokes should be merged into a single annotation.

### Implementation Details

#### 1.1 Merge Criteria
```typescript
interface MergeCriteria {
  // Time threshold: merge strokes within N milliseconds
  timeThreshold: number; // Default: 2000ms

  // Distance threshold: merge if new stroke starts within N pixels of last stroke
  distanceThreshold: number; // Default: 100px

  // Same page: only merge strokes on same page
  samePage: boolean; // Default: true

  // Same color: only merge strokes of same color
  sameColor: boolean; // Default: true
}

const DEFAULT_CRITERIA: MergeCriteria = {
  timeThreshold: 2000,
  distanceThreshold: 100,
  samePage: true,
  sameColor: true,
};
```

#### 1.2 Stroke Buffer
```typescript
interface StrokeBuffer {
  strokes: InkStroke[];
  startTime: number;
  lastStrokeTime: number;
  page: number;
  color: string;
  boundingBox: BoundingBox;
}

// Track ongoing drawing session
const [strokeBuffer, setStrokeBuffer] = useState<StrokeBuffer | null>(null);
const mergeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
```

#### 1.3 Should Merge Decision
```typescript
function shouldMergeWithBuffer(
  buffer: StrokeBuffer | null,
  newStroke: InkStroke,
  criteria: MergeCriteria
): boolean {
  if (!buffer) return false;

  const now = Date.now();
  const timeSinceLastStroke = now - buffer.lastStrokeTime;

  // Time check
  if (timeSinceLastStroke > criteria.timeThreshold) {
    return false;
  }

  // Page check
  if (criteria.samePage && buffer.page !== newStroke.page) {
    return false;
  }

  // Color check
  if (criteria.sameColor && buffer.color !== newStroke.color) {
    return false;
  }

  // Distance check
  const distance = calculateDistance(
    buffer.strokes[buffer.strokes.length - 1],
    newStroke
  );
  if (distance > criteria.distanceThreshold) {
    return false;
  }

  return true;
}

function calculateDistance(stroke1: InkStroke, stroke2: InkStroke): number {
  // Get end point of stroke1
  const end1 = stroke1.points[stroke1.points.length - 1];

  // Get start point of stroke2
  const start2 = stroke2.points[0];

  return Math.sqrt(
    Math.pow(end1.x - start2.x, 2) +
    Math.pow(end1.y - start2.y, 2)
  );
}
```

### Acceptance Criteria
- [ ] Strokes within 2s are merged
- [ ] Strokes nearby are merged
- [ ] Different pages create separate annotations
- [ ] Different colors create separate annotations

---

## Feature 2: Delayed Finalization

### Goal
Wait for user to finish drawing before creating the annotation.

### Implementation Details

#### 2.1 Finalization Timer
```typescript
function useInkAnnotation(onCreateAnnotation: (ann: InkAnnotation) => void) {
  const [buffer, setBuffer] = useState<StrokeBuffer | null>(null);
  const finalizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const finalizeAnnotation = useCallback(() => {
    if (!buffer || buffer.strokes.length === 0) return;

    // Create the merged annotation
    const annotation: InkAnnotation = {
      id: generateId(),
      type: 'ink',
      page: buffer.page,
      color: buffer.color,
      strokes: buffer.strokes,
      boundingBox: buffer.boundingBox,
      createdAt: Date.now(),
    };

    onCreateAnnotation(annotation);
    setBuffer(null);
  }, [buffer, onCreateAnnotation]);

  const addStroke = useCallback((stroke: InkStroke) => {
    // Clear existing finalize timeout
    if (finalizeTimeoutRef.current) {
      clearTimeout(finalizeTimeoutRef.current);
    }

    if (shouldMergeWithBuffer(buffer, stroke, DEFAULT_CRITERIA)) {
      // Add to existing buffer
      setBuffer(prev => ({
        ...prev!,
        strokes: [...prev!.strokes, stroke],
        lastStrokeTime: Date.now(),
        boundingBox: expandBoundingBox(prev!.boundingBox, stroke),
      }));
    } else {
      // Finalize previous buffer if exists
      if (buffer) {
        finalizeAnnotation();
      }

      // Start new buffer
      setBuffer({
        strokes: [stroke],
        startTime: Date.now(),
        lastStrokeTime: Date.now(),
        page: stroke.page,
        color: stroke.color,
        boundingBox: getStrokeBoundingBox(stroke),
      });
    }

    // Set new finalize timeout
    finalizeTimeoutRef.current = setTimeout(() => {
      finalizeAnnotation();
    }, DEFAULT_CRITERIA.timeThreshold);
  }, [buffer, finalizeAnnotation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (finalizeTimeoutRef.current) {
        clearTimeout(finalizeTimeoutRef.current);
      }
      // Finalize any pending strokes
      if (buffer) {
        finalizeAnnotation();
      }
    };
  }, []);

  return { addStroke, isDrawing: buffer !== null };
}
```

#### 2.2 Visual Indicator
```typescript
// Show indicator that drawing is in progress
function InkSessionIndicator({ isDrawing, strokeCount }) {
  if (!isDrawing) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-background border rounded-full px-4 py-2 shadow-lg flex items-center gap-2 animate-in fade-in">
      <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
      <span className="text-sm">Drawing... {strokeCount} strokes</span>
      <span className="text-xs text-muted-foreground">(pause to finish)</span>
    </div>
  );
}
```

### Acceptance Criteria
- [ ] No annotation created until 2s pause
- [ ] Indicator shows drawing in progress
- [ ] Stroke count visible
- [ ] Clears when finalized

---

## Feature 3: Bounding Box Calculation

### Goal
Calculate accurate bounding box for merged strokes.

### Implementation Details

```typescript
interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function getStrokeBoundingBox(stroke: InkStroke): BoundingBox {
  const xs = stroke.points.map(p => p.x);
  const ys = stroke.points.map(p => p.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // Add padding for stroke width
  const padding = stroke.width / 2;

  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

function expandBoundingBox(box: BoundingBox, stroke: InkStroke): BoundingBox {
  const strokeBox = getStrokeBoundingBox(stroke);

  return {
    x: Math.min(box.x, strokeBox.x),
    y: Math.min(box.y, strokeBox.y),
    width: Math.max(box.x + box.width, strokeBox.x + strokeBox.width) - Math.min(box.x, strokeBox.x),
    height: Math.max(box.y + box.height, strokeBox.y + strokeBox.height) - Math.min(box.y, strokeBox.y),
  };
}

function combineBoundingBoxes(boxes: BoundingBox[]): BoundingBox {
  if (boxes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  return boxes.reduce((combined, box) => ({
    x: Math.min(combined.x, box.x),
    y: Math.min(combined.y, box.y),
    width: Math.max(combined.x + combined.width, box.x + box.width) - Math.min(combined.x, box.x),
    height: Math.max(combined.y + combined.height, box.y + box.height) - Math.min(combined.y, box.y),
  }));
}
```

### Acceptance Criteria
- [ ] Bounding box contains all strokes
- [ ] Accounts for stroke width
- [ ] Updates as strokes are added
- [ ] Used for sidebar preview

---

## Feature 4: Ink Annotation Display

### Goal
Display merged ink annotations correctly in sidebar.

### Implementation Details

#### 4.1 Ink Preview in Sidebar
```typescript
function InkAnnotationPreview({ annotation }: { annotation: InkAnnotation }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate scale to fit preview
    const { boundingBox } = annotation;
    const scale = Math.min(
      (canvas.width - 8) / boundingBox.width,
      (canvas.height - 8) / boundingBox.height,
      1 // Don't scale up
    );

    // Draw all strokes
    for (const stroke of annotation.strokes) {
      ctx.beginPath();
      ctx.strokeStyle = annotation.color;
      ctx.lineWidth = stroke.width * scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const points = stroke.points;
      if (points.length === 0) continue;

      // Translate to fit in preview
      const offsetX = (canvas.width - boundingBox.width * scale) / 2 - boundingBox.x * scale;
      const offsetY = (canvas.height - boundingBox.height * scale) / 2 - boundingBox.y * scale;

      ctx.moveTo(
        points[0].x * scale + offsetX,
        points[0].y * scale + offsetY
      );

      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(
          points[i].x * scale + offsetX,
          points[i].y * scale + offsetY
        );
      }

      ctx.stroke();
    }
  }, [annotation]);

  return (
    <canvas
      ref={canvasRef}
      width={60}
      height={40}
      className="border rounded bg-white"
    />
  );
}
```

#### 4.2 Ink Annotation Card
```typescript
function InkAnnotationCard({ annotation, isSelected, onClick }) {
  return (
    <div
      className={cn(
        "p-3 border-b cursor-pointer hover:bg-muted/50",
        isSelected && "bg-accent/20"
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        {/* Preview thumbnail */}
        <InkAnnotationPreview annotation={annotation} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Drawing</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Page {annotation.page} • {annotation.strokes.length} strokes
          </div>
        </div>

        <div
          className="w-4 h-4 rounded-full"
          style={{ backgroundColor: annotation.color }}
        />
      </div>

      {annotation.comment && (
        <p className="text-sm text-muted-foreground mt-2 italic">
          {annotation.comment}
        </p>
      )}
    </div>
  );
}
```

### Acceptance Criteria
- [ ] Preview shows all strokes
- [ ] Properly scaled to fit thumbnail
- [ ] Stroke count displayed
- [ ] Color indicator visible

---

## Feature 5: Edit Merged Ink Annotation

### Goal
Allow editing (adding strokes to) an existing ink annotation.

### Implementation Details

#### 5.1 Continue Drawing Mode
```typescript
function useContinueDrawing(annotation: InkAnnotation | null) {
  const [isEditing, setIsEditing] = useState(false);

  const startEditing = useCallback(() => {
    if (!annotation) return;
    setIsEditing(true);
    // Enter drawing mode with this annotation selected
  }, [annotation]);

  const addStrokeToAnnotation = useCallback((stroke: InkStroke) => {
    if (!annotation || !isEditing) return;

    // Update annotation with new stroke
    updateAnnotation(annotation.id, {
      strokes: [...annotation.strokes, stroke],
      boundingBox: expandBoundingBox(annotation.boundingBox, stroke),
    });
  }, [annotation, isEditing]);

  const finishEditing = useCallback(() => {
    setIsEditing(false);
  }, []);

  return { isEditing, startEditing, addStrokeToAnnotation, finishEditing };
}
```

#### 5.2 UI for Continue Drawing
```typescript
// Add "Continue Drawing" button to ink annotation card
<Button
  variant="ghost"
  size="sm"
  onClick={() => startEditing()}
  title="Continue drawing"
>
  <Pencil className="h-4 w-4 mr-1" />
  Continue
</Button>
```

### Acceptance Criteria
- [ ] Can select ink annotation to edit
- [ ] New strokes added to existing annotation
- [ ] Bounding box updates
- [ ] Can finish editing

---

## Feature 6: Configurable Merge Settings

### Goal
Allow users to adjust merge behavior.

### Implementation Details

```typescript
// In settings
function InkAnnotationSettings() {
  const { inkMergeTime, setInkMergeTime, inkMergeDistance, setInkMergeDistance } = useSettings();

  return (
    <div className="space-y-4">
      <h4 className="font-medium">Ink Annotation Settings</h4>

      <SettingItem
        label="Merge time"
        description="Strokes within this time are merged"
      >
        <div className="flex items-center gap-2">
          <Slider
            value={[inkMergeTime]}
            onValueChange={([v]) => setInkMergeTime(v)}
            min={500}
            max={5000}
            step={500}
            className="w-24"
          />
          <span className="text-sm text-muted-foreground w-12">
            {(inkMergeTime / 1000).toFixed(1)}s
          </span>
        </div>
      </SettingItem>

      <SettingItem
        label="Merge distance"
        description="Strokes within this distance are merged"
      >
        <div className="flex items-center gap-2">
          <Slider
            value={[inkMergeDistance]}
            onValueChange={([v]) => setInkMergeDistance(v)}
            min={50}
            max={300}
            step={25}
            className="w-24"
          />
          <span className="text-sm text-muted-foreground w-12">
            {inkMergeDistance}px
          </span>
        </div>
      </SettingItem>
    </div>
  );
}
```

### Acceptance Criteria
- [ ] Merge time configurable
- [ ] Merge distance configurable
- [ ] Settings persist
- [ ] Changes apply immediately

---

## Testing

### Manual Checklist

1. **Basic Merge**
   - Draw 3 strokes quickly
   - Wait 2 seconds
   - Check: One annotation created
   - Check: Contains 3 strokes

2. **Time Threshold**
   - Draw stroke 1
   - Wait 3 seconds
   - Draw stroke 2
   - Check: Two separate annotations

3. **Distance Threshold**
   - Draw in top-left corner
   - Immediately draw in bottom-right
   - Check: Two separate annotations

4. **Color Separation**
   - Draw red stroke
   - Switch to blue
   - Draw immediately
   - Check: Two separate annotations

5. **Continue Drawing**
   - Create ink annotation
   - Click "Continue"
   - Draw more strokes
   - Check: Added to same annotation

---

## Implementation Notes

- Test with stylus/tablet input
- Consider pressure sensitivity for variable stroke width
- Ensure smooth rendering during fast drawing
- Handle touch events for mobile
- Consider undo for individual strokes vs whole annotation
