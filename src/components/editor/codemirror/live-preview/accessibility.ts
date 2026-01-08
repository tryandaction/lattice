/**
 * Accessibility Extensions for Live Preview Editor
 * Screen reader support, focus management, and ARIA labels
 * 
 * Requirements: 14.1-14.6
 */

import { EditorView } from '@codemirror/view';
import { Extension, Compartment } from '@codemirror/state';

/**
 * Screen reader announcement helper
 */
class ScreenReaderAnnouncer {
  private container: HTMLElement | null = null;
  
  private getContainer(): HTMLElement {
    if (this.container) return this.container;
    
    // Create or find live region
    let region = document.getElementById('sr-announcer');
    if (!region) {
      region = document.createElement('div');
      region.id = 'sr-announcer';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      region.setAttribute('aria-atomic', 'true');
      region.className = 'sr-only';
      region.style.cssText = `
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      `;
      document.body.appendChild(region);
    }
    
    this.container = region;
    return region;
  }
  
  announce(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
    const container = this.getContainer();
    container.setAttribute('aria-live', priority);
    
    // Clear and set message (forces announcement)
    container.textContent = '';
    requestAnimationFrame(() => {
      container.textContent = message;
    });
  }
}

export const announcer = new ScreenReaderAnnouncer();

/**
 * Announce editor state changes
 */
export function announceChange(type: string, detail?: string): void {
  const messages: Record<string, string> = {
    'mode-live': 'Switched to Live Preview mode',
    'mode-source': 'Switched to Source mode',
    'mode-reading': 'Switched to Reading mode',
    'fold': `Folded section${detail ? `: ${detail}` : ''}`,
    'unfold': `Unfolded section${detail ? `: ${detail}` : ''}`,
    'search-open': 'Search panel opened',
    'search-close': 'Search panel closed',
    'match-found': detail || 'Match found',
    'no-match': 'No matches found',
    'replace': detail || 'Text replaced',
    'link-click': `Opening link${detail ? `: ${detail}` : ''}`,
  };
  
  const message = messages[type] || type;
  announcer.announce(message);
}

/**
 * ARIA attributes for the editor
 */
export const editorAriaAttributes = EditorView.contentAttributes.of({
  'role': 'textbox',
  'aria-multiline': 'true',
  'aria-label': 'Markdown editor',
  'aria-describedby': 'editor-description',
});

/**
 * High contrast mode support
 */
const highContrastCompartment = new Compartment();

export function createHighContrastExtension(enabled: boolean): Extension {
  if (!enabled) return [];
  
  return EditorView.theme({
    '&': {
      '--editor-bg': '#000',
      '--editor-fg': '#fff',
      '--editor-selection': '#264f78',
      '--editor-cursor': '#fff',
    },
    '.cm-content': {
      caretColor: '#fff',
    },
    '.cm-cursor': {
      borderLeftColor: '#fff',
      borderLeftWidth: '2px',
    },
    '.cm-selectionBackground': {
      backgroundColor: '#264f78 !important',
    },
    '.cm-activeLine': {
      backgroundColor: '#1a1a1a',
    },
    '.cm-bold': {
      color: '#ffff00',
    },
    '.cm-italic': {
      color: '#00ffff',
    },
    '.cm-link, .cm-wiki-link': {
      color: '#00ff00',
      textDecoration: 'underline',
    },
    '.cm-inline-code': {
      backgroundColor: '#333',
      color: '#ff00ff',
    },
  }, { dark: true });
}

/**
 * Reduced motion support
 */
export function createReducedMotionExtension(): Extension {
  // Check user preference
  if (typeof window === 'undefined') return [];
  
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  
  if (!prefersReducedMotion) return [];
  
  return EditorView.theme({
    '.cm-cursor': {
      animation: 'none !important',
    },
    '.cm-content *': {
      transition: 'none !important',
      animation: 'none !important',
    },
  });
}

/**
 * Focus management helpers
 */
export function focusEditor(view: EditorView): void {
  view.focus();
  announcer.announce('Editor focused');
}

export function focusSearchPanel(): void {
  const searchInput = document.querySelector('.cm-search-field input') as HTMLInputElement;
  if (searchInput) {
    searchInput.focus();
    announcer.announce('Search field focused');
  }
}

/**
 * Keyboard navigation helpers
 */
export const keyboardNavigationExtension = EditorView.domEventHandlers({
  keydown: (event, view) => {
    // Escape to exit search and return to editor
    if (event.key === 'Escape') {
      const searchPanel = document.querySelector('.cm-search');
      if (searchPanel) {
        view.focus();
        announcer.announce('Returned to editor');
        return false; // Let default handler close search
      }
    }
    
    // F6 to move between panels (editor, outline, etc.)
    if (event.key === 'F6') {
      // This would be handled by the parent component
      return false;
    }
    
    return false;
  },
});

/**
 * Complete accessibility extension
 */
export function createAccessibilityExtension(options: {
  highContrast?: boolean;
  reducedMotion?: boolean;
} = {}): Extension[] {
  const extensions: Extension[] = [
    editorAriaAttributes,
    keyboardNavigationExtension,
  ];
  
  if (options.highContrast) {
    extensions.push(createHighContrastExtension(true));
  }
  
  if (options.reducedMotion !== false) {
    extensions.push(createReducedMotionExtension());
  }
  
  return extensions;
}

/**
 * Add description element for screen readers
 */
export function addEditorDescription(container: HTMLElement): void {
  let desc = container.querySelector('#editor-description');
  if (!desc) {
    desc = document.createElement('div');
    desc.id = 'editor-description';
    desc.className = 'sr-only';
    desc.textContent = 'Markdown editor with live preview. Use Ctrl+E to switch modes, Ctrl+F to search, and standard text editing shortcuts.';
    container.insertBefore(desc, container.firstChild);
  }
}
