# Controlled Performance And Evidence Navigation Design

## Goal

Keep Lattice responsive when many large files and annotations are open, while making AI answers sufficiently explanatory and every PDF evidence reference navigable to its page and quoted passage.

## Constraints

- Preserve existing Draft, Proposal, Approval, annotation, PDF reading, and workspace behavior.
- Do not add shell, network, MCP, direct-write, autonomous coding, Git automation, or new permission capabilities.
- Never evict dirty editor content.
- Keep AI inspection surfaces progressive and optional.
- Work with the current dirty tree and do not revert unrelated changes.

## Performance Architecture

### PDF resources

The active PDF owns visible canvas and text layers. Inactive PDF tabs retain only bounded warm state: document identity, view state, and a small recent-page text cache. Canvas backing stores, DOM text layers, annotation layers, and page render tasks are released when pages leave the render window or the viewer unmounts.

Canvas resolution is bounded by a total pixel budget in addition to device pixel ratio. Page rendering continues to use the visible-page scheduler, but background reference parsing becomes demand-driven instead of parsing the final twelve pages after every open.

### Cache policy

- PDF page text models use a per-document LRU with visible and actively requested pages touched most recently.
- Binary and text content cache entries have bounded clean-entry capacity; dirty entries are pinned.
- The warm PDF policy targets the current document plus the two most recently used document states. Older documents retain serializable view state only.
- Cache eviction is observable in unit tests and never changes persisted document content.

### Annotation rendering and persistence

Annotations are indexed by page once per collection update. PDF overlays consume only annotations for rendered pages. The sidebar uses windowed rows with stable handlers and deferred filtering so hundreds of annotations do not mount simultaneously.

Annotation mutations produce one immutable snapshot, coalesce rapid edits, and serialize only after the interaction settles. Persistence remains the existing sidecar write path and retains retry/error behavior.

## AI Answer Architecture

### Context ingestion

Extracted PDF text is parsed into page-aware context nodes. Oversized nodes are divided into bounded chunks instead of being dropped wholesale. Query-relevant chunks and annotated pages are prioritized, while the prompt records truncation honestly.

Each PDF page node emits an `EvidenceRef` containing:

- canonical workspace locator with `#page=N`;
- `anchor.page`;
- a bounded exact snippet;
- normalized rectangles when already known.

### Adaptive teaching response

Ordinary greetings and simple factual questions stay short. Explanatory requests such as “详细解释”, “为什么”, formula/code/paper explanations ask the model for direct answer, core idea, step-by-step reasoning, a minimal verifiable example, evidence, and a useful next question only when each section is relevant. The UI parser remains optional and does not fabricate absent sections.

## Evidence Navigation

AI chat uses a strict link policy. External URLs and recognizable workspace document targets remain clickable; arbitrary model-generated relative strings such as `4,2,2` render as plain text.

Evidence chips are source-specific actions. Clicking a chip:

1. resolves the canonical workspace root and opens or activates the source file;
2. queues the PDF page navigation before the viewer mounts;
3. applies known evidence rectangles immediately, or resolves the stored snippet against the page text model;
4. scrolls to the passage and shows a temporary, non-persistent highlight;
5. keeps “Open evidence” as the separate action for the inspector.

This reuses the existing link-navigation store, PDF canonical text model, and transient AI annotation store. Confirmation remains the only operation that converts a transient highlight into a persistent annotation.

## Performance Budgets

- No unbounded growth in page text, clean content, reference-preview, or canvas caches.
- At most visible pages plus one-page buffer own full PDF layers.
- Annotation sidebar mounts a bounded row window for 200 or more annotations.
- Warm tab switch target: p95 below 300 ms; cold restore target: p95 below 800 ms in the diagnostic fixture.
- Search, selection, annotation edits, and composer input should avoid tasks longer than 50 ms in the stress fixture.
- Repeated navigation through a large PDF must reach a stable memory plateau rather than grow monotonically.

## Verification

Unit tests cover LRU eviction, dirty-entry pinning, canvas release, page indexing, coalesced saves, oversized context chunking, PDF page evidence anchors, adaptive prompts, strict chat links, and evidence navigation.

Browser diagnostics cover many open tabs, a long PDF, 200 annotations, repeated page navigation, rapid annotation filtering, and repeated evidence jumps. Desktop verification records renderer/GPU memory before and after the stress loop, then runs the repository QA gate and packages the desktop product without Git commit or push.
