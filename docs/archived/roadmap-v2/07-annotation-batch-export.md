# Prompt 07: Annotation Batch Management & Export Fix

## Priority: P3 (Enhancement)

## Overview

Add **batch management** capabilities for annotations (select multiple, delete, export, change color) and fix **export issues** where some annotations don't display correctly after export.

---

## Related Files

- `src/components/renderers/pdf-highlighter-adapter.tsx` - PDF viewer
- `src/components/renderers/pdf-annotation-sidebar.tsx` - Annotation sidebar
- `src/lib/annotation-export.ts` - Export logic
- `src/hooks/use-annotation-system.ts` - Annotation state
- `src/types/universal-annotation.ts` - Type definitions

---

## Feature 1: Multi-Select Annotations

### Goal
Allow selecting multiple annotations for batch operations.

### Implementation Details

#### 1.1 Selection State
```typescript
// In pdf-highlighter-adapter.tsx or a new store
const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<Set<string>>(new Set());
const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);

// Toggle selection
const toggleAnnotationSelection = (id: string) => {
  setSelectedAnnotationIds(prev => {
    const newSet = new Set(prev);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    return newSet;
  });
};

// Select all
const selectAll = () => {
  setSelectedAnnotationIds(new Set(annotations.map(a => a.id)));
};

// Clear selection
const clearSelection = () => {
  setSelectedAnnotationIds(new Set());
};
```

#### 1.2 UI for Multi-Select
```typescript
// Annotation card with checkbox
function AnnotationCard({ annotation, isSelected, onToggleSelect, isMultiSelectMode }) {
  return (
    <div
      className={cn(
        "p-3 border-b cursor-pointer hover:bg-muted/50 transition-colors",
        isSelected && "bg-accent/20 border-l-4 border-l-primary"
      )}
      onClick={() => {
        if (isMultiSelectMode) {
          onToggleSelect(annotation.id);
        } else {
          // Normal click behavior
        }
      }}
    >
      {isMultiSelectMode && (
        <div className="flex items-center gap-2 mb-2">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect(annotation.id)}
          />
        </div>
      )}
      {/* ... rest of card */}
    </div>
  );
}
```

#### 1.3 Multi-Select Toolbar
```typescript
function SelectionToolbar({ selectedCount, onSelectAll, onClearSelection, onDelete, onChangeColor, onExport }) {
  if (selectedCount === 0) return null;

  return (
    <div className="sticky top-0 z-10 bg-background border-b p-2 flex items-center gap-2">
      <span className="text-sm font-medium">{selectedCount} selected</span>

      <div className="flex items-center gap-1 ml-auto">
        <Button variant="ghost" size="sm" onClick={onSelectAll}>
          Select All
        </Button>
        <Button variant="ghost" size="sm" onClick={onClearSelection}>
          Clear
        </Button>

        <div className="w-px h-4 bg-border mx-1" />

        {/* Color change dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <Palette className="h-4 w-4 mr-1" />
              Color
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {COLORS.map(color => (
              <DropdownMenuItem
                key={color}
                onClick={() => onChangeColor(color)}
              >
                <div
                  className="w-4 h-4 rounded-full mr-2"
                  style={{ backgroundColor: color }}
                />
                {COLOR_NAMES[color]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" size="sm" onClick={onExport}>
          <Download className="h-4 w-4 mr-1" />
          Export
        </Button>

        <Button variant="ghost" size="sm" className="text-destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4 mr-1" />
          Delete
        </Button>
      </div>
    </div>
  );
}
```

### Acceptance Criteria
- [ ] Checkbox appears in multi-select mode
- [ ] Ctrl+Click toggles selection
- [ ] Shift+Click selects range
- [ ] "Select All" selects all annotations
- [ ] Clear selection works
- [ ] Selected count displayed

---

## Feature 2: Batch Delete

### Goal
Delete multiple annotations at once.

### Implementation Details

#### 2.1 Delete Confirmation
```typescript
function BatchDeleteDialog({ count, onConfirm, onCancel }) {
  return (
    <AlertDialog>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {count} Annotations</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete {count} annotations? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground"
          >
            Delete {count} Annotations
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

#### 2.2 Batch Delete Logic
```typescript
const handleBatchDelete = async () => {
  const idsToDelete = Array.from(selectedAnnotationIds);

  for (const id of idsToDelete) {
    await deleteAnnotation(id);
  }

  setSelectedAnnotationIds(new Set());
  toast.success(`Deleted ${idsToDelete.length} annotations`);
};
```

### Acceptance Criteria
- [ ] Confirmation shows count
- [ ] All selected annotations deleted
- [ ] Selection cleared after delete
- [ ] Toast confirms success

---

## Feature 3: Batch Color Change

### Goal
Change color of multiple annotations at once.

### Implementation Details

```typescript
const handleBatchColorChange = async (newColor: string) => {
  const idsToUpdate = Array.from(selectedAnnotationIds);

  for (const id of idsToUpdate) {
    await updateAnnotation(id, { style: { color: newColor } });
  }

  toast.success(`Updated ${idsToUpdate.length} annotations`);
};
```

### Acceptance Criteria
- [ ] Color picker shows available colors
- [ ] All selected annotations updated
- [ ] Visual update immediate
- [ ] Toast confirms success

---

## Feature 4: Export Selected Annotations

### Goal
Export only selected annotations, not all.

### Implementation Details

#### 4.1 Export Options Dialog
```typescript
function ExportOptionsDialog({ annotations, onExport, onCancel }) {
  const [format, setFormat] = useState<'json' | 'markdown' | 'csv'>('markdown');
  const [includeText, setIncludeText] = useState(true);
  const [includeComments, setIncludeComments] = useState(true);
  const [groupByPage, setGroupByPage] = useState(true);

  return (
    <Dialog>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export {annotations.length} Annotations</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Format</label>
            <RadioGroup value={format} onValueChange={setFormat}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="markdown" id="md" />
                <Label htmlFor="md">Markdown</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="json" id="json" />
                <Label htmlFor="json">JSON</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="csv" id="csv" />
                <Label htmlFor="csv">CSV (Excel)</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Include</label>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox checked={includeText} onCheckedChange={setIncludeText} id="text" />
                <Label htmlFor="text">Highlighted text</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox checked={includeComments} onCheckedChange={setIncludeComments} id="comments" />
                <Label htmlFor="comments">Comments</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox checked={groupByPage} onCheckedChange={setGroupByPage} id="group" />
                <Label htmlFor="group">Group by page</Label>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onExport({ format, includeText, includeComments, groupByPage })}>
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

#### 4.2 Markdown Export Format
```typescript
function exportToMarkdown(annotations: Annotation[], options: ExportOptions): string {
  let markdown = `# Annotations\n\n`;
  markdown += `*Exported on ${new Date().toLocaleString()}*\n\n`;

  if (options.groupByPage) {
    const byPage = groupBy(annotations, 'page');

    for (const [page, pageAnnotations] of Object.entries(byPage)) {
      markdown += `## Page ${page}\n\n`;

      for (const ann of pageAnnotations) {
        markdown += formatAnnotation(ann, options);
      }
    }
  } else {
    for (const ann of annotations) {
      markdown += formatAnnotation(ann, options);
    }
  }

  return markdown;
}

function formatAnnotation(ann: Annotation, options: ExportOptions): string {
  let text = '';

  // Color indicator
  const colorEmoji = COLOR_EMOJI[ann.style.color] || '📝';
  text += `${colorEmoji} `;

  // Type
  text += `**${ann.style.type}**`;

  // Page (if not grouping)
  if (!options.groupByPage) {
    text += ` (Page ${ann.page})`;
  }

  text += '\n';

  // Highlighted text
  if (options.includeText && ann.text) {
    text += `> ${ann.text}\n`;
  }

  // Comment
  if (options.includeComments && ann.comment) {
    text += `\n*Note: ${ann.comment}*\n`;
  }

  text += '\n---\n\n';

  return text;
}
```

#### 4.3 CSV Export Format
```typescript
function exportToCSV(annotations: Annotation[], options: ExportOptions): string {
  const headers = ['Page', 'Type', 'Color', 'Text', 'Comment', 'Created'];
  const rows = annotations.map(ann => [
    ann.page,
    ann.style.type,
    ann.style.color,
    options.includeText ? (ann.text || '') : '',
    options.includeComments ? (ann.comment || '') : '',
    new Date(ann.createdAt).toISOString(),
  ]);

  const escape = (str: string) => `"${str.replace(/"/g, '""')}"`;
  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(escape).join(','))
  ].join('\n');

  return csv;
}
```

### Acceptance Criteria
- [ ] Can choose export format (MD, JSON, CSV)
- [ ] Can toggle what to include
- [ ] Export respects selection
- [ ] Downloaded file is correct format
- [ ] Markdown is readable

---

## Feature 5: Fix Export Display Issues

### Current Issues
- Some annotations may not display correctly after export
- Colors may be missing
- Position data may be incorrect

### Root Cause Analysis
- Coordinates may be in wrong format (normalized vs pixel)
- Text content may not be properly escaped
- Special characters in comments causing issues

### Implementation Details

#### 5.1 Fix Coordinate Export
```typescript
// Ensure consistent coordinate format
function normalizeAnnotationForExport(ann: Annotation): ExportedAnnotation {
  return {
    ...ann,
    position: {
      // Ensure 0-1 normalized coordinates
      x: clamp(ann.position.x, 0, 1),
      y: clamp(ann.position.y, 0, 1),
      width: clamp(ann.position.width, 0, 1),
      height: clamp(ann.position.height, 0, 1),
    },
    // Sanitize text content
    text: sanitizeText(ann.text),
    comment: sanitizeText(ann.comment),
  };
}

function sanitizeText(text: string | undefined): string {
  if (!text) return '';
  return text
    .replace(/\u0000/g, '') // Remove null bytes
    .replace(/[\x00-\x1F\x7F]/g, ' ') // Replace control chars
    .trim();
}
```

#### 5.2 Fix Color Export
```typescript
// Ensure color is valid hex
function validateColor(color: string): string {
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) return color;

  // Map named colors to hex
  const colorMap: Record<string, string> = {
    'yellow': '#ffeb3b',
    'green': '#4caf50',
    'blue': '#2196f3',
    'red': '#f44336',
    'purple': '#9c27b0',
  };

  return colorMap[color.toLowerCase()] || '#ffeb3b';
}
```

#### 5.3 Improve JSON Export
```typescript
function exportToJSON(annotations: Annotation[]): string {
  const exportData = {
    version: 2,
    exportedAt: new Date().toISOString(),
    app: 'Lattice',
    annotations: annotations.map(ann => ({
      id: ann.id,
      page: ann.page,
      type: ann.style.type,
      color: validateColor(ann.style.color),
      position: {
        x: ann.position.x,
        y: ann.position.y,
        width: ann.position.width,
        height: ann.position.height,
        rects: ann.position.rects?.map(r => ({
          x1: r.x1,
          y1: r.y1,
          x2: r.x2,
          y2: r.y2,
        })),
      },
      text: sanitizeText(ann.text),
      comment: sanitizeText(ann.comment),
      createdAt: ann.createdAt,
    })),
  };

  return JSON.stringify(exportData, null, 2);
}
```

### Acceptance Criteria
- [ ] All annotations export correctly
- [ ] Colors are valid hex values
- [ ] No special character issues
- [ ] Coordinates are normalized
- [ ] Exported file can be imported back

---

## Feature 6: Import Annotations

### Goal
Allow importing annotations from a JSON file.

### Implementation Details

```typescript
async function importAnnotations(file: File): Promise<Annotation[]> {
  const text = await file.text();
  const data = JSON.parse(text);

  // Validate structure
  if (!data.annotations || !Array.isArray(data.annotations)) {
    throw new Error('Invalid annotation file format');
  }

  // Convert to internal format
  return data.annotations.map(ann => ({
    id: generateId(), // New ID to avoid conflicts
    page: ann.page,
    style: {
      type: ann.type,
      color: validateColor(ann.color),
    },
    position: ann.position,
    text: ann.text,
    comment: ann.comment,
    createdAt: ann.createdAt || Date.now(),
  }));
}

// UI component
function ImportButton({ onImport }) {
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const annotations = await importAnnotations(file);
      await onImport(annotations);
      toast.success(`Imported ${annotations.length} annotations`);
    } catch (error) {
      toast.error(`Import failed: ${error.message}`);
    }
  };

  return (
    <label>
      <input
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className="hidden"
      />
      <Button variant="outline" size="sm" asChild>
        <span>
          <Upload className="h-4 w-4 mr-1" />
          Import
        </span>
      </Button>
    </label>
  );
}
```

### Acceptance Criteria
- [ ] Can select JSON file
- [ ] Validates file format
- [ ] Imports all annotations
- [ ] Handles duplicates
- [ ] Error message on invalid file

---

## Testing

### Manual Checklist

1. **Multi-Select**
   - Ctrl+Click to select multiple
   - Verify count updates
   - Clear selection works

2. **Batch Delete**
   - Select 5 annotations
   - Click delete
   - Confirm dialog shows "5"
   - All 5 deleted

3. **Batch Color**
   - Select 3 annotations
   - Change to red
   - All 3 turn red

4. **Export Formats**
   - Export as Markdown
   - Verify formatting correct
   - Export as CSV
   - Open in Excel, verify columns

5. **Import**
   - Export annotations
   - Delete them
   - Import the file
   - Verify restored

---

## Notes

- Test with special characters in comments
- Test with many annotations (100+)
- Ensure export/import round-trip works
- Consider progress indicator for large batches
