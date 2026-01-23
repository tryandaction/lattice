# Export Feature Integration Guide

**Quick guide to integrate the new export functionality into your Lattice editor**

---

## 📦 What's Included

### New Files Created
1. **`src/lib/export-utils.ts`** - Core export functionality
2. **`src/components/editor/export-button.tsx`** - UI components

### Export Formats Supported
- ✅ **Markdown** (.md) - Raw markdown with all syntax
- ✅ **HTML** (.html) - Rendered formulas with KaTeX
- ✅ **PDF** (.pdf) - Via browser print dialog

---

## 🚀 Quick Integration

### Option 1: Full Export Button (Recommended)

Add to your editor toolbar:

```tsx
import { ExportButton } from '@/components/editor/export-button';

function YourEditor() {
  const [content, setContent] = useState('# My Document\n\nContent...');
  
  return (
    <div className="editor-container">
      {/* Toolbar */}
      <div className="toolbar">
        <ExportButton 
          content={content} 
          filename="my-document"
        />
        {/* Other toolbar buttons */}
      </div>
      
      {/* Editor */}
      <div className="editor">
        {/* Your editor component */}
      </div>
    </div>
  );
}
```

### Option 2: Compact Export Button (Icon Only)

For minimal UI:

```tsx
import { ExportButtonCompact } from '@/components/editor/export-button';

function YourEditor() {
  const [content, setContent] = useState('# My Document\n\nContent...');
  
  return (
    <div className="editor-container">
      <div className="toolbar">
        <ExportButtonCompact 
          content={content} 
          filename="my-document"
        />
      </div>
    </div>
  );
}
```

### Option 3: Programmatic Export

Use the utility functions directly:

```tsx
import { ExportUtils } from '@/lib/export-utils';

// Export markdown
ExportUtils.exportMarkdown(content, {
  filename: 'document.md'
});

// Export HTML
await ExportUtils.exportHTML(content, {
  filename: 'document.html',
  title: 'My Document',
  includeCSS: true,
  darkMode: false
});

// Export PDF
await ExportUtils.exportPDF(content, {
  title: 'My Document'
});
```

---

## 🎨 Styling

The export buttons use Tailwind CSS classes. If you need custom styling:

```tsx
<ExportButton 
  content={content}
  filename="document"
  className="custom-export-button"
/>
```

Or modify the component directly in `src/components/editor/export-button.tsx`.

---

## 🔧 Configuration Options

### ExportOptions (Markdown)
```typescript
{
  filename?: string;        // Default: 'document.md'
  includeStyles?: boolean;  // Not used for markdown
  renderMath?: boolean;     // Not used for markdown
}
```

### HTMLExportOptions
```typescript
{
  filename?: string;        // Default: 'document.html'
  title?: string;           // Document title
  includeCSS?: boolean;     // Include styling (default: true)
  darkMode?: boolean;       // Use dark theme (default: false)
}
```

### PDFExportOptions
```typescript
{
  filename?: string;        // Not used (browser print dialog)
  title?: string;           // Document title
  includeCSS?: boolean;     // Include styling (default: true)
  darkMode?: boolean;       // Use dark theme (default: false)
  pageSize?: 'A4' | 'Letter';  // Future: page size
  margin?: string;          // Future: page margins
}
```

---

## 📝 Example: ObsidianMarkdownViewer Integration

Add export button to the markdown viewer:

```tsx
// In src/components/editor/obsidian-markdown-viewer.tsx

import { ExportButtonCompact } from './export-button';

export function ObsidianMarkdownViewer({ ... }) {
  // ... existing code ...
  
  return (
    <div className="markdown-viewer">
      {/* Header with export button */}
      <div className="viewer-header">
        <h2>{fileName}</h2>
        <ExportButtonCompact 
          content={content}
          filename={fileName.replace(/\.md$/, '')}
        />
      </div>
      
      {/* Editor */}
      <LivePreviewEditor ... />
    </div>
  );
}
```

---

## 🎯 Features

### Markdown Export
- Preserves all markdown syntax exactly
- No conversion or rendering
- Perfect for sharing with other markdown editors

### HTML Export
- Renders math formulas using KaTeX
- Includes professional CSS styling
- Self-contained (includes KaTeX CDN link)
- Supports dark mode
- Print-friendly

### PDF Export
- Opens browser print dialog
- User can choose printer or "Save as PDF"
- Print-optimized layout
- Rendered formulas
- Professional typography

---

## 🐛 Troubleshooting

### Issue: Export button doesn't appear
**Solution**: Check that you've imported the component correctly:
```tsx
import { ExportButton } from '@/components/editor/export-button';
```

### Issue: Math formulas don't render in HTML export
**Solution**: Ensure KaTeX is loading correctly. Check browser console for errors.

### Issue: PDF export opens blank window
**Solution**: Check browser popup blocker settings. Allow popups for your site.

### Issue: Export fails with error
**Solution**: Check browser console for detailed error message. Common issues:
- Content is empty
- KaTeX failed to load
- Browser doesn't support required APIs

---

## 🔍 Testing

### Test Markdown Export
1. Create a document with various markdown elements
2. Click Export → Markdown
3. Open the downloaded .md file in a text editor
4. Verify all syntax is preserved

### Test HTML Export
1. Create a document with math formulas
2. Click Export → HTML
3. Open the downloaded .html file in a browser
4. Verify formulas are rendered correctly

### Test PDF Export
1. Create a document with formulas and formatting
2. Click Export → PDF
3. In the print dialog, choose "Save as PDF"
4. Verify the PDF looks professional

---

## 📊 Performance

### Export Times (Approximate)
- **Markdown**: Instant (<10ms)
- **HTML**: Fast (~100-500ms depending on formula count)
- **PDF**: Depends on browser print dialog

### File Sizes (Approximate)
- **Markdown**: Same as source (~1KB per page)
- **HTML**: Larger due to CSS and KaTeX (~50KB + content)
- **PDF**: Varies by content (~100KB-1MB)

---

## 🎨 Customization

### Custom CSS for HTML Export

Edit `getExportCSS()` in `src/lib/export-utils.ts`:

```typescript
function getExportCSS(darkMode: boolean): string {
  return `
    /* Your custom CSS here */
    body {
      font-family: 'Your Font', sans-serif;
      /* ... */
    }
  `;
}
```

### Custom Export Formats

Add new export format to `export-utils.ts`:

```typescript
export async function exportLaTeX(content: string, options: ExportOptions = {}): Promise<void> {
  // Convert markdown to LaTeX
  const latex = markdownToLaTeX(content);
  
  // Download
  const blob = new Blob([latex], { type: 'text/x-latex;charset=utf-8' });
  downloadBlob(blob, options.filename || 'document.tex');
}
```

Then add to the export button menu.

---

## 🚀 Advanced Usage

### Export with Custom Styling

```typescript
import { ExportUtils } from '@/lib/export-utils';

// Custom HTML export
const htmlContent = await markdownToHTML(content, { renderMath: true });
const customHTML = `
<!DOCTYPE html>
<html>
<head>
  <title>My Custom Export</title>
  <style>
    /* Your custom CSS */
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>
`;

const blob = new Blob([customHTML], { type: 'text/html' });
// Download blob...
```

### Batch Export

```typescript
async function exportAllDocuments(documents: Array<{ content: string; filename: string }>) {
  for (const doc of documents) {
    await ExportUtils.exportHTML(doc.content, {
      filename: `${doc.filename}.html`,
      title: doc.filename
    });
    
    // Wait a bit between exports to avoid overwhelming the browser
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
```

---

## 📚 API Reference

### ExportUtils.exportMarkdown()
```typescript
function exportMarkdown(content: string, options?: ExportOptions): void
```
Exports raw markdown content.

### ExportUtils.exportHTML()
```typescript
async function exportHTML(content: string, options?: HTMLExportOptions): Promise<void>
```
Exports HTML with rendered formulas.

### ExportUtils.exportPDF()
```typescript
async function exportPDF(content: string, options?: PDFExportOptions): Promise<void>
```
Opens browser print dialog for PDF export.

---

## ✅ Checklist

Before deploying:
- [ ] Export button integrated into UI
- [ ] Tested markdown export
- [ ] Tested HTML export with formulas
- [ ] Tested PDF export
- [ ] Verified styling looks good
- [ ] Tested with large documents
- [ ] Tested error handling
- [ ] Checked browser console for errors

---

## 🎉 You're Done!

The export feature is now integrated. Users can export their documents in 3 formats with professional styling and rendered formulas.

**Need help?** Check the implementation in:
- `src/lib/export-utils.ts` - Core logic
- `src/components/editor/export-button.tsx` - UI component
- `FINAL_IMPLEMENTATION_SUMMARY.md` - Complete overview
