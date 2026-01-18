# Prompt 09: Image Viewer Stability - Prevent Image Disappearing

## Priority: P3 (Enhancement)

## Overview

Users report that images **disappear during editing** in the Tldraw-based image editor. This prompt implements robust mechanisms to **prevent image loss** and **auto-recover** if it occurs.

---

## Related Files

- `src/components/renderers/image-tldraw-adapter.tsx` - Main image editor
- `src/components/renderers/image-viewer.tsx` - Fallback viewer
- `src/hooks/use-annotation-system.ts` - Annotation persistence

---

## Current Problems

1. **Image Disappears**: Background image sometimes vanishes during editing
2. **No Recovery**: Once gone, user must reopen file
3. **Unclear Trigger**: Hard to reproduce, may be related to:
   - Tool switching
   - Undo/redo operations
   - Shape manipulation near image
   - Zoom operations

---

## Root Cause Analysis

### Potential Causes

1. **Accidental Deletion**: Background shape may be accidentally included in delete operations
2. **Undo Stack**: Undo may remove background shape
3. **Asset Garbage Collection**: Tldraw may garbage collect unused assets
4. **Store Reset**: Store operations may inadvertently clear background
5. **Z-Index Issues**: Background may be sent behind render area

### Investigation Code
```typescript
// Add to image-tldraw-adapter.tsx for debugging
useEffect(() => {
  if (!editor) return;

  const logState = () => {
    const shapes = editor.getCurrentPageShapes();
    const backgroundShape = shapes.find(s => s.id === createShapeId('background'));
    console.log('[ImageTldraw] Background status:', {
      exists: !!backgroundShape,
      shapeCount: shapes.length,
      backgroundId: backgroundShape?.id,
    });
  };

  editor.store.listen(() => logState(), { source: 'all' });
  logState();
}, [editor]);
```

---

## Feature 1: Protected Background Shape

### Goal
Make the background image shape impossible to accidentally delete.

### Implementation Details

#### 1.1 Custom Shape Lock
```typescript
// Extend protection beyond isLocked
const BACKGROUND_ID = createShapeId('background');

function isBackgroundShape(shapeId: TLShapeId): boolean {
  return shapeId === BACKGROUND_ID;
}

// Override delete behavior
const preventBackgroundDelete = (editor: Editor) => {
  const originalDeleteShapes = editor.deleteShapes.bind(editor);

  editor.deleteShapes = (shapes: TLShapeId[]) => {
    // Filter out background shape
    const filteredShapes = shapes.filter(id => !isBackgroundShape(id));

    if (filteredShapes.length !== shapes.length) {
      console.warn('[ImageTldraw] Prevented background deletion');
    }

    if (filteredShapes.length === 0) return;
    return originalDeleteShapes(filteredShapes);
  };
};
```

#### 1.2 Prevent Selection
```typescript
// Don't allow background to be selected
useEffect(() => {
  if (!editor) return;

  const unsubscribe = editor.store.listen(() => {
    const selectedIds = editor.getSelectedShapeIds();
    if (selectedIds.includes(BACKGROUND_ID)) {
      // Remove background from selection
      editor.setSelectedShapes(selectedIds.filter(id => id !== BACKGROUND_ID));
    }
  }, { source: 'user', scope: 'session' });

  return unsubscribe;
}, [editor]);
```

#### 1.3 Hide from UI
```typescript
// Custom component to hide background from shape list
// Tldraw's default UI shows all shapes; we hide the background
```

### Acceptance Criteria
- [ ] Background cannot be selected
- [ ] Background cannot be deleted via UI
- [ ] Background cannot be deleted via keyboard (Delete key)
- [ ] Select All does not include background

---

## Feature 2: Auto-Recovery System

### Goal
Automatically detect and recover lost background image.

### Implementation Details

#### 2.1 Background Monitor
```typescript
function useBackgroundMonitor(
  editor: Editor | null,
  imageUrl: string,
  imageSize: { width: number; height: number },
  fileName: string,
  mimeType: string
) {
  const isRecoveringRef = useRef(false);

  useEffect(() => {
    if (!editor || !imageUrl || imageSize.width === 0) return;

    const checkAndRecover = () => {
      if (isRecoveringRef.current) return;

      const shapes = editor.getCurrentPageShapes();
      const hasBackground = shapes.some(s => s.id === BACKGROUND_ID);

      if (!hasBackground) {
        console.warn('[ImageTldraw] Background lost, initiating recovery...');
        isRecoveringRef.current = true;

        // Show user feedback
        toast.info('Recovering image...', { duration: 2000 });

        // Recreate background
        createBackgroundImage(editor, imageUrl, imageSize, fileName, mimeType);

        setTimeout(() => {
          isRecoveringRef.current = false;
          console.log('[ImageTldraw] Recovery complete');
        }, 500);
      }
    };

    // Check on store changes
    const unsubscribe = editor.store.listen(() => {
      setTimeout(checkAndRecover, 50); // Debounce
    }, { source: 'all', scope: 'document' });

    // Periodic check as fallback
    const interval = setInterval(checkAndRecover, 5000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [editor, imageUrl, imageSize, fileName, mimeType]);
}
```

#### 2.2 Create Background Function
```typescript
function createBackgroundImage(
  editor: Editor,
  imageUrl: string,
  imageSize: { width: number; height: number },
  fileName: string,
  mimeType: string
): void {
  const assetId: TLAssetId = AssetRecordType.createId('background-image');

  // Check if asset exists
  const existingAsset = editor.getAsset(assetId);
  if (!existingAsset) {
    editor.createAssets([{
      id: assetId,
      type: 'image',
      typeName: 'asset',
      props: {
        name: fileName,
        src: imageUrl,
        w: imageSize.width,
        h: imageSize.height,
        mimeType: mimeType,
        isAnimated: false,
      },
      meta: {},
    }]);
  }

  // Check if shape exists
  const existingShape = editor.getShape(BACKGROUND_ID);
  if (!existingShape) {
    editor.createShape<TLImageShape>({
      id: BACKGROUND_ID,
      type: 'image',
      x: 0,
      y: 0,
      isLocked: true,
      props: {
        assetId,
        w: imageSize.width,
        h: imageSize.height,
      },
    });
  }

  // Ensure it's at the back
  editor.sendToBack([BACKGROUND_ID]);
}
```

### Acceptance Criteria
- [ ] Missing background detected within 1 second
- [ ] Auto-recovery restores image
- [ ] User notified of recovery
- [ ] Drawings preserved during recovery

---

## Feature 3: Undo/Redo Protection

### Goal
Prevent undo from removing the background image.

### Implementation Details

#### 3.1 Custom History Handler
```typescript
// Intercept undo/redo to protect background
function protectBackgroundInHistory(editor: Editor) {
  const originalUndo = editor.undo.bind(editor);
  const originalRedo = editor.redo.bind(editor);

  editor.undo = () => {
    const result = originalUndo();

    // Check if background was removed by undo
    setTimeout(() => {
      const shapes = editor.getCurrentPageShapes();
      if (!shapes.some(s => s.id === BACKGROUND_ID)) {
        // Redo to restore, then manually remove the undone action
        console.warn('[ImageTldraw] Undo removed background, recovering...');
        // Recovery logic
      }
    }, 10);

    return result;
  };

  // Similar for redo
}
```

#### 3.2 Alternative: Separate Background Layer
```typescript
// Consider using Tldraw's page system to put background on separate page
// Or use a custom rendering layer outside Tldraw's store

// This approach completely isolates background from user operations
function BackgroundImageLayer({ imageUrl, size }) {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: `url(${imageUrl})`,
        backgroundSize: 'contain',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    />
  );
}
```

### Acceptance Criteria
- [ ] Undo does not remove background
- [ ] Redo does not affect background
- [ ] Full undo history works for drawings
- [ ] Background remains stable

---

## Feature 4: Visual Feedback

### Goal
Show clear feedback about image state.

### Implementation Details

#### 4.1 Status Indicator
```typescript
function ImageStatusIndicator({ editor, imageUrl }) {
  const [status, setStatus] = useState<'ok' | 'recovering' | 'error'>('ok');

  useEffect(() => {
    if (!editor) return;

    const checkStatus = () => {
      const shapes = editor.getCurrentPageShapes();
      const hasBackground = shapes.some(s => s.id === BACKGROUND_ID);
      setStatus(hasBackground ? 'ok' : 'recovering');
    };

    editor.store.listen(checkStatus, { source: 'all' });
    checkStatus();
  }, [editor]);

  if (status === 'ok') return null;

  return (
    <div className={cn(
      "absolute top-2 right-2 px-2 py-1 rounded text-xs flex items-center gap-1",
      status === 'recovering' && "bg-yellow-100 text-yellow-800",
      status === 'error' && "bg-red-100 text-red-800"
    )}>
      {status === 'recovering' && (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          Recovering image...
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle className="h-3 w-3" />
          Image error
        </>
      )}
    </div>
  );
}
```

#### 4.2 Recovery Animation
```css
@keyframes image-recovery {
  0% { opacity: 0.5; }
  50% { opacity: 0.8; }
  100% { opacity: 1; }
}

.image-recovering {
  animation: image-recovery 0.5s ease-out;
}
```

### Acceptance Criteria
- [ ] Status indicator shows when recovering
- [ ] Animation on successful recovery
- [ ] Clear error state if recovery fails

---

## Feature 5: Fallback Mode

### Goal
If Tldraw fails completely, fall back to basic image viewer.

### Implementation Details

```typescript
function ImageTldrawAdapter({ content, fileName, mimeType, ...props }) {
  const [tldrawError, setTldrawError] = useState<Error | null>(null);
  const [recoveryAttempts, setRecoveryAttempts] = useState(0);
  const MAX_RECOVERY_ATTEMPTS = 3;

  // Track recovery attempts
  const onRecoveryNeeded = useCallback(() => {
    setRecoveryAttempts(prev => {
      const next = prev + 1;
      if (next >= MAX_RECOVERY_ATTEMPTS) {
        setTldrawError(new Error('Too many recovery attempts'));
      }
      return next;
    });
  }, []);

  // If Tldraw is failing, show basic viewer
  if (tldrawError) {
    return (
      <div className="flex flex-col h-full">
        <div className="bg-yellow-50 dark:bg-yellow-950 border-b border-yellow-200 px-4 py-2 text-sm text-yellow-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          Drawing tools unavailable. Showing read-only view.
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTldrawError(null);
              setRecoveryAttempts(0);
            }}
          >
            Retry
          </Button>
        </div>
        <ImageViewer
          content={content}
          fileName={fileName}
          mimeType={mimeType}
        />
      </div>
    );
  }

  return (
    <TldrawEditor
      onRecoveryNeeded={onRecoveryNeeded}
      {...props}
    />
  );
}
```

### Acceptance Criteria
- [ ] Falls back after 3 failed recoveries
- [ ] Shows warning message
- [ ] Retry button available
- [ ] Image still viewable

---

## Feature 6: Debug Mode

### Goal
Enable detailed logging for troubleshooting.

### Implementation Details

```typescript
// Add debug flag to localStorage
const DEBUG_IMAGE_VIEWER = localStorage.getItem('lattice:debug:imageViewer') === 'true';

function debugLog(...args: any[]) {
  if (DEBUG_IMAGE_VIEWER) {
    console.log('[ImageTldraw Debug]', ...args);
  }
}

// Log all relevant events
useEffect(() => {
  if (!editor || !DEBUG_IMAGE_VIEWER) return;

  const events = [
    'pointerdown',
    'pointerup',
    'keydown',
    'wheel',
  ];

  events.forEach(event => {
    editor.on(event as any, (e) => {
      debugLog(`Event: ${event}`, e);
    });
  });

  editor.store.listen((entry) => {
    debugLog('Store change:', entry);
  }, { source: 'all' });
}, [editor]);
```

### Acceptance Criteria
- [ ] Debug mode toggle in settings
- [ ] Detailed logs when enabled
- [ ] Helps identify root cause

---

## Testing

### Manual Test Checklist

1. **Basic Editing**
   - Open image
   - Draw shapes
   - Verify image stays

2. **Tool Switching**
   - Switch between all tools rapidly
   - Verify image stays

3. **Undo/Redo**
   - Draw, undo, redo multiple times
   - Verify image stays

4. **Select All + Delete**
   - Press Ctrl+A
   - Press Delete
   - Verify image stays, drawings deleted

5. **Zoom Operations**
   - Zoom in/out rapidly
   - Verify image stays

6. **Recovery Test**
   - Manually delete background via console
   - Verify auto-recovery kicks in
   - Verify drawings preserved

7. **Fallback Test**
   - Force error multiple times
   - Verify fallback viewer shown

---

## Implementation Priority

1. **Protection** (prevent deletion) - Do first
2. **Auto-recovery** (detect and fix) - Do second
3. **Visual feedback** (user awareness) - Do third
4. **Fallback mode** (graceful degradation) - Do fourth
5. **Debug mode** (for future issues) - Optional

---

## Notes

- Test with various image sizes
- Test with different image formats (PNG, JPG, GIF)
- Monitor memory usage during long sessions
- Consider WebGL rendering issues
- Test on different browsers/platforms
