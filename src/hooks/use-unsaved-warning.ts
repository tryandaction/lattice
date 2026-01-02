/**
 * Unsaved Changes Warning Hook
 * 
 * Warns users before closing the browser/tab when there are unsaved changes.
 * Uses the beforeunload event to show a browser-native confirmation dialog.
 */

import { useEffect } from "react";
import { useContentCacheStore } from "@/stores/content-cache-store";

/**
 * Hook to warn users before closing browser with unsaved changes.
 * 
 * When there are unsaved changes in any tab, this hook will:
 * 1. Show a browser-native confirmation dialog when user tries to close/refresh
 * 2. The dialog message is controlled by the browser (cannot be customized)
 * 
 * Usage:
 * ```tsx
 * function App() {
 *   useUnsavedWarning();
 *   return <div>...</div>;
 * }
 * ```
 */
export function useUnsavedWarning(): void {
  const getUnsavedTabs = useContentCacheStore((state) => state.getUnsavedTabs);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const unsavedTabs = getUnsavedTabs();
      
      if (unsavedTabs.length > 0) {
        // Standard way to trigger the browser's confirmation dialog
        e.preventDefault();
        // Chrome requires returnValue to be set
        e.returnValue = '';
        // Some browsers use the return value as the message (deprecated)
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [getUnsavedTabs]);
}

/**
 * Hook to check if there are any unsaved changes.
 * 
 * @returns true if there are unsaved changes in any tab
 */
export function useHasUnsavedChanges(): boolean {
  const getUnsavedTabs = useContentCacheStore((state) => state.getUnsavedTabs);
  const unsavedTabs = getUnsavedTabs();
  return unsavedTabs.length > 0;
}
