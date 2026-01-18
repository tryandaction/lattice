# Prompt 02: Annotation System Overhaul

## Priority: P1 (High)

## Overview

Transform the PDF annotation system into a **professional-grade** annotation experience comparable to Zotero or PDF Expert. Focus on intuitive UI, sensible defaults, and powerful features for academic users.

---

## Related Files

- `src/components/renderers/pdf-highlighter-adapter.tsx` - Main PDF viewer
- `src/components/renderers/annotation-sidebar.tsx` - Sidebar component
- `src/components/renderers/pdf-annotation-sidebar.tsx` - Annotation list
- `src/hooks/use-annotation-system.ts` - Annotation logic
- `src/types/universal-annotation.ts` - Type definitions
- `src/stores/` - Related stores

---

## Feature 1: Sidebar Default State & Toggle

### Current State
- Sidebar opens by default
- Toggle button may be on wrong side
- State not persisted

### Target State
- Sidebar CLOSED by default (less distraction)
- Toggle button on LEFT (near sidebar)
- State persisted per-file
- Badge shows annotation count when closed

### Implementation Details

#### 1.1 Default State
```typescript
// In pdf-highlighter-adapter.tsx
const [showSidebar, setShowSidebar] = useState(false); // Default CLOSED

// Check localStorage for user preference
useEffect(() => {
  const savedState = localStorage.getItem(`lattice:sidebar:${fileId}`);
  if (savedState !== null) {
    setShowSidebar(savedState === 'true');
  }
}, [fileId]);

// Save state changes
useEffect(() => {
  localStorage.setItem(`lattice:sidebar:${fileId}`, String(showSidebar));
}, [showSidebar, fileId]);
```

#### 1.2 Toggle Button Redesign
```typescript
// Position on LEFT side, above sidebar when open
// Or floating on left edge when closed

function SidebarToggle({ isOpen, onToggle, annotationCount }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "fixed left-0 top-1/2 -translate-y-1/2 z-50",
        "bg-background border border-border rounded-r-lg",
        "p-2 hover:bg-muted transition-colors",
        "flex items-center gap-1"
      )}
      title={isOpen ? "Hide annotations (Ctrl+Shift+A)" : "Show annotations (Ctrl+Shift+A)"}
    >
      {isOpen ? <PanelLeftClose /> : <PanelLeft />}
      {!isOpen && annotationCount > 0 && (
        <span className="bg-primary text-primary-foreground text-xs rounded-full px-1.5">
          {annotationCount}
        </span>
      )}
    </button>
  );
}
```

#### 1.3 Keyboard Shortcut
```typescript
// Add keyboard shortcut: Ctrl+Shift+A
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      setShowSidebar(prev => !prev);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

### Acceptance Criteria
- [ ] Sidebar closed by default on first open
- [ ] Toggle button on LEFT side
- [ ] Badge shows count when closed
- [ ] Ctrl+Shift+A toggles sidebar
- [ ] State persisted across sessions

---

## Feature 2: Sidebar UI Enhancement

### Current State
- Basic list of annotations
- Limited sorting/filtering

### Target State
- Clean, organized annotation list
- Group by page or type
- Search/filter annotations
- Inline editing of comments
- Thumbnail preview of highlighted area

### Implementation Details

#### 2.1 Sidebar Header
```typescript
function SidebarHeader({ annotations, filter, setFilter, sortBy, setSortBy }) {
  return (
    <div className="p-3 border-b space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Annotations</h3>
        <span className="text-sm text-muted-foreground">
          {annotations.length} total
        </span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search annotations..."
          className="pl-8 h-8"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {/* Sort/Group */}
      <div className="flex items-center gap-2">
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="page">By Page</SelectItem>
            <SelectItem value="date">By Date</SelectItem>
            <SelectItem value="type">By Type</SelectItem>
            <SelectItem value="color">By Color</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
```

#### 2.2 Annotation Card
```typescript
function AnnotationCard({ annotation, isSelected, onSelect, onDelete, onUpdate }) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div
      className={cn(
        "p-3 border-b cursor-pointer hover:bg-muted/50 transition-colors",
        isSelected && "bg-muted"
      )}
      onClick={() => onSelect(annotation)}
    >
      {/* Header: Type icon + Page + Color indicator */}
      <div className="flex items-center gap-2 mb-1">
        <AnnotationIcon type={annotation.style.type} />
        <span className="text-xs text-muted-foreground">Page {annotation.page}</span>
        <div
          className="w-3 h-3 rounded-full ml-auto"
          style={{ backgroundColor: annotation.style.color }}
        />
      </div>

      {/* Preview text */}
      {annotation.text && (
        <p className="text-sm line-clamp-2 mb-2">
          "{annotation.text}"
        </p>
      )}

      {/* Comment */}
      {isEditing ? (
        <Textarea
          value={annotation.comment || ''}
          onChange={(e) => onUpdate({ comment: e.target.value })}
          onBlur={() => setIsEditing(false)}
          autoFocus
          className="text-sm"
          placeholder="Add a note..."
        />
      ) : (
        <p
          className="text-sm text-muted-foreground italic cursor-text"
          onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
        >
          {annotation.comment || 'Click to add note...'}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100">
        <Button variant="ghost" size="icon" className="h-6 w-6">
          <Palette className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-destructive"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
```

#### 2.3 Page Grouping
```typescript
function GroupedAnnotations({ annotations, groupBy }) {
  const grouped = useMemo(() => {
    if (groupBy === 'page') {
      return groupBy(annotations, a => a.page);
    }
    // ... other groupings
  }, [annotations, groupBy]);

  return (
    <div>
      {Object.entries(grouped).map(([key, items]) => (
        <div key={key}>
          <div className="sticky top-0 bg-background px-3 py-1 text-xs font-medium border-b">
            {groupBy === 'page' ? `Page ${key}` : key}
          </div>
          {items.map(ann => (
            <AnnotationCard key={ann.id} annotation={ann} />
          ))}
        </div>
      ))}
    </div>
  );
}
```

### Acceptance Criteria
- [ ] Search filters annotations in real-time
- [ ] Sort by page/date/type/color
- [ ] Inline comment editing
- [ ] Clear visual grouping
- [ ] Hover reveals action buttons

---

## Feature 3: Annotation Creation UX

### Current State
- May require multiple clicks
- Color selection may be awkward

### Target State
- Quick annotation with defaults
- Floating color palette
- Remember last used color
- Keyboard shortcuts for tools

### Implementation Details

#### 3.1 Quick Color Palette
```typescript
// Show floating palette after text selection
function QuickAnnotationPalette({ position, onHighlight, onClose }) {
  const colors = ['#ffeb3b', '#4caf50', '#2196f3', '#f44336', '#9c27b0'];
  const lastColor = useLocalStorage('lattice:lastColor', '#ffeb3b');

  return (
    <div
      className="absolute bg-background border rounded-lg shadow-lg p-1 flex gap-1"
      style={{ left: position.x, top: position.y }}
    >
      {colors.map(color => (
        <button
          key={color}
          className={cn(
            "w-6 h-6 rounded-full border-2",
            color === lastColor && "ring-2 ring-offset-1"
          )}
          style={{ backgroundColor: color }}
          onClick={() => {
            onHighlight(color);
            setLastColor(color);
          }}
        />
      ))}
      <button
        className="w-6 h-6 rounded-full border flex items-center justify-center"
        onClick={onClose}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
```

#### 3.2 Tool Keyboard Shortcuts
```typescript
// Keyboard shortcuts for annotation tools
const toolShortcuts = {
  'h': 'highlight',  // H for highlight
  'u': 'underline',  // U for underline
  'n': 'note',       // N for note
  'a': 'area',       // A for area selection
  'i': 'ink',        // I for ink/drawing
};

useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    const tool = toolShortcuts[e.key.toLowerCase()];
    if (tool) {
      setActiveTool(tool);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

#### 3.3 Toolbar Enhancement
```typescript
// Show current tool, allow quick switching
function AnnotationToolbar({ activeTool, setActiveTool, activeColor, setActiveColor }) {
  return (
    <div className="flex items-center gap-2 p-2 border-b">
      {/* Tool buttons with keyboard hint */}
      <TooltipProvider>
        {tools.map(tool => (
          <Tooltip key={tool.id}>
            <TooltipTrigger asChild>
              <Button
                variant={activeTool === tool.id ? "default" : "ghost"}
                size="icon"
                onClick={() => setActiveTool(tool.id)}
              >
                <tool.icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {tool.label} ({tool.shortcut.toUpperCase()})
            </TooltipContent>
          </Tooltip>
        ))}
      </TooltipProvider>

      {/* Color selector */}
      <div className="ml-auto flex items-center gap-1">
        {colors.map(color => (
          <button
            key={color}
            className={cn(
              "w-5 h-5 rounded-full",
              activeColor === color && "ring-2 ring-offset-1"
            )}
            style={{ backgroundColor: color }}
            onClick={() => setActiveColor(color)}
          />
        ))}
      </div>
    </div>
  );
}
```

### Acceptance Criteria
- [ ] Color palette appears after text selection
- [ ] Last color is remembered
- [ ] Keyboard shortcuts work (H, U, N, A, I)
- [ ] Active tool clearly indicated
- [ ] Quick tool switching

---

## Feature 4: Jump to Annotation

### Current State
- Clicking sidebar item may not scroll correctly
- Position calculation may be off

### Target State
- Click annotation → smooth scroll to exact location
- Highlight flashes to indicate position
- Works across pages

### Implementation Details

#### 4.1 Improved Jump Logic
```typescript
function jumpToAnnotation(annotation: Annotation) {
  const pageElement = document.querySelector(`[data-page-number="${annotation.page}"]`);
  if (!pageElement) return;

  // First scroll page into view
  pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Wait for scroll, then highlight
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      observer.disconnect();

      // Calculate exact position and highlight
      requestAnimationFrame(() => {
        highlightAnnotation(annotation);
      });
    }
  }, { threshold: 0.5 });

  observer.observe(pageElement);

  // Timeout fallback
  setTimeout(() => observer.disconnect(), 3000);
}

function highlightAnnotation(annotation: Annotation) {
  const element = document.querySelector(`[data-annotation-id="${annotation.id}"]`);
  if (!element) return;

  // Add highlight animation
  element.classList.add('annotation-flash');
  setTimeout(() => element.classList.remove('annotation-flash'), 2000);
}
```

#### 4.2 Flash Animation CSS
```css
@keyframes annotation-flash {
  0%, 100% { opacity: 1; }
  25%, 75% { opacity: 0.3; }
  50% { opacity: 1; }
}

.annotation-flash {
  animation: annotation-flash 1s ease-in-out 2;
  box-shadow: 0 0 0 3px var(--primary);
}
```

### Acceptance Criteria
- [ ] Click annotation → scrolls to exact position
- [ ] Annotation flashes to indicate location
- [ ] Works for annotations on any page
- [ ] Smooth scrolling animation

---

## Feature 5: Annotation Summary Header

### Current State
- No quick overview of annotations

### Target State
- Summary bar showing counts by type/color
- Quick filter by clicking summary items

### Implementation Details

```typescript
function AnnotationSummary({ annotations }) {
  const summary = useMemo(() => {
    return {
      total: annotations.length,
      byType: countBy(annotations, a => a.style.type),
      byColor: countBy(annotations, a => a.style.color),
    };
  }, [annotations]);

  return (
    <div className="p-2 border-b bg-muted/30 flex items-center gap-3 text-xs">
      <span className="font-medium">{summary.total} annotations</span>

      <div className="flex items-center gap-1">
        {Object.entries(summary.byType).map(([type, count]) => (
          <button
            key={type}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-muted"
            onClick={() => setFilter({ type })}
          >
            <TypeIcon type={type} className="h-3 w-3" />
            <span>{count}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-0.5 ml-auto">
        {Object.entries(summary.byColor).map(([color, count]) => (
          <button
            key={color}
            className="w-4 h-4 rounded-full relative"
            style={{ backgroundColor: color }}
            onClick={() => setFilter({ color })}
          >
            <span className="absolute -top-1 -right-1 text-[10px] bg-background rounded-full px-0.5">
              {count}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

### Acceptance Criteria
- [ ] Shows total count
- [ ] Shows breakdown by type
- [ ] Shows breakdown by color
- [ ] Clicking filters annotations

---

## Testing

### Manual Test Checklist

1. **Sidebar State**
   - Open PDF, verify sidebar closed
   - Toggle sidebar, close PDF
   - Reopen PDF, verify state persisted
   - Test Ctrl+Shift+A shortcut

2. **Sidebar UI**
   - Create 10+ annotations
   - Test search filtering
   - Test sort options
   - Verify grouping by page

3. **Annotation Creation**
   - Select text, verify color palette
   - Test keyboard shortcuts H/U/N
   - Verify last color remembered

4. **Jump to Annotation**
   - Create annotation on page 5
   - Scroll to page 1
   - Click annotation in sidebar
   - Verify scrolls and highlights

---

## Notes

- Test with PDFs that have many pages
- Consider performance with 100+ annotations
- Ensure works with all annotation types
- Test export functionality still works
