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
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(async (registrations) => {
        await Promise.all(registrations.map(async (registration) => {
          await registration.unregister();
          console.info('[SW] Unregistered service worker');
        }));

        if ('caches' in window) {
          const cacheNames = await window.caches.keys();
          await Promise.all(cacheNames.map(async (cacheName) => {
            await window.caches.delete(cacheName);
          }));
          if (cacheNames.length > 0) {
            console.info('[SW] Cleared service worker caches');
          }
        }
      }).catch((error) => {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[SW] Failed to clear service worker state', error);
        }
      });
    } else if (typeof window !== 'undefined' && 'caches' in window) {
      window.caches.keys().then((cacheNames) => {
        return Promise.all(cacheNames.map(async (cacheName) => {
          await window.caches.delete(cacheName);
        }));
      }).catch((error) => {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[SW] Failed to clear service worker caches', error);
        }
      });
    }
  }, []);

  return null;
}
