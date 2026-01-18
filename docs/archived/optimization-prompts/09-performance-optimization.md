# Prompt 09: Performance Optimization

## Priority: P3 (Low)

## Context

While Lattice follows a "lightweight & high-performance" philosophy, there are areas where performance can be improved, especially with large files and complex content.

## Related Files

- `src/app/layout.tsx` - Root layout with providers
- `src/app/page.tsx` - Main page component
- `src/stores/workspace-store.ts` - Global state
- `src/stores/content-cache-store.ts` - Content caching
- `src/hooks/use-pane-file-content.ts` - File loading
- `src/lib/fast-save.ts` - Optimized save utilities
- `src/workers/pyodide.worker.ts` - Python worker
- `next.config.ts` - Next.js configuration
- `package.json` - Dependencies

## Current Issues

### Issue 1: Initial Load Time
- Bundle size could be smaller
- Too many components loaded eagerly
- Font loading blocks render
- No loading skeleton during hydration

### Issue 2: Large File Handling
- PDFs with many pages slow to load
- Large code files cause editor lag
- Big notebooks freeze the UI
- Image files loaded at full resolution

### Issue 3: Memory Usage
- Closed files remain in memory
- Annotation data not cleaned up
- Editor instances not properly disposed
- Worker memory not released

### Issue 4: Render Performance
- Unnecessary re-renders in file tree
- Tab bar re-renders on every change
- Annotation layer re-renders too often
- Math rendering blocks main thread

### Issue 5: State Management
- Store subscriptions too broad
- Derived state recalculated unnecessarily
- No memoization of expensive computations
- State updates not batched

## Tasks

### Task 1: Optimize Initial Load
```
1. Analyze bundle with next-bundle-analyzer
2. Implement dynamic imports for heavy components
3. Optimize font loading strategy
4. Add loading skeleton for initial render
5. Defer non-critical JavaScript
```

### Task 2: Improve Large File Handling
```
1. Implement PDF page virtualization
2. Add virtual scrolling for large code files
3. Implement notebook cell virtualization
4. Add image lazy loading with thumbnails
5. Set file size limits with warnings
```

### Task 3: Reduce Memory Usage
```
1. Implement LRU cache for file content
2. Clean up annotations on file close
3. Properly dispose editor instances
4. Release worker memory after execution
5. Add memory usage monitoring
```

### Task 4: Optimize Rendering
```
1. Add React.memo to file tree nodes
2. Optimize tab bar with useMemo
3. Throttle annotation layer updates
4. Move math rendering to worker
5. Implement render batching
```

### Task 5: Optimize State Management
```
1. Use selective store subscriptions
2. Implement derived state caching
3. Add useMemo for expensive computations
4. Batch state updates with unstable_batchedUpdates
5. Profile and fix re-render issues
```

## Acceptance Criteria

- [ ] Initial load under 2 seconds on 3G
- [ ] 100-page PDF loads without freezing
- [ ] 10,000-line code file scrolls smoothly
- [ ] Memory stays under 500MB with 10 files open
- [ ] No unnecessary re-renders in React DevTools

## Testing

```bash
# Bundle analysis
npm run build
npx next-bundle-analyzer

# Performance profiling
1. Open Chrome DevTools Performance tab
2. Record while opening large files
3. Analyze flame chart for bottlenecks

# Memory profiling
1. Open Chrome DevTools Memory tab
2. Take heap snapshots before/after operations
3. Look for memory leaks
```

## Performance Metrics to Track

```
Core Web Vitals:
- LCP (Largest Contentful Paint): < 2.5s
- FID (First Input Delay): < 100ms
- CLS (Cumulative Layout Shift): < 0.1

Custom Metrics:
- Time to Interactive: < 3s
- File Open Time: < 500ms for < 1MB files
- Save Time: < 200ms
- Memory per open file: < 50MB average
```

## Optimization Techniques

### Code Splitting
```typescript
// Dynamic import for heavy components
const PDFViewer = dynamic(() => import('./pdf-viewer'), {
  loading: () => <LoadingSkeleton />,
  ssr: false,
});
```

### Memoization
```typescript
// Memoize expensive computations
const processedData = useMemo(() => {
  return expensiveComputation(data);
}, [data]);

// Memoize components
const MemoizedComponent = React.memo(Component);
```

### Virtual Scrolling
```typescript
// Use react-window for large lists
import { FixedSizeList } from 'react-window';

<FixedSizeList
  height={400}
  itemCount={items.length}
  itemSize={35}
>
  {Row}
</FixedSizeList>
```

### Web Workers
```typescript
// Offload heavy computation to worker
const worker = new Worker('worker.js');
worker.postMessage(data);
worker.onmessage = (e) => setResult(e.data);
```

## Notes

- Profile before optimizing - don't guess
- Focus on user-perceived performance
- Consider adding performance monitoring (e.g., Sentry)
- Test on low-end devices
- Document performance requirements in specs
