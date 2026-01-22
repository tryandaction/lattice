"use client";

import { useEffect } from 'react';

/**
 * Service Worker Registration - DISABLED
 *
 * The service worker was causing critical issues with Next.js static export.
 * This component now actively unregisters any existing service workers.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    // Unregister any existing service workers
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          registration.unregister();
          console.log('[SW] Unregistered service worker');
        });
      });
    }
  }, []);

  return null;
}
