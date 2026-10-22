"use client";

import { useEffect, useMemo, useRef } from "react";
import type { VSCodeHostWebviewContent } from "@/lib/vscode-extension-host/types";
import {
  buildVSCodeWebviewDocument,
  type VSCodeWebviewThemeKind,
} from "@/lib/vscode-extension-host/webview-document";

interface VSCodeWebviewFrameProps {
  content: VSCodeHostWebviewContent;
  onMessage: (viewId: string, message: unknown) => unknown[] | Promise<unknown[]>;
  drainMessages: (viewId: string) => unknown[] | Promise<unknown[]>;
}

const HOST_MESSAGE_POLL_INTERVAL_MS = 250;

function currentThemeKind(): VSCodeWebviewThemeKind {
  if (typeof window === "undefined") return "light";
  return window.document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function VSCodeWebviewFrame({ content, onMessage, drainMessages }: VSCodeWebviewFrameProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollGenerationRef = useRef(0);
  const initialThemeKind = useMemo(() => currentThemeKind(), []);
  const webviewDocument = useMemo(
    () => buildVSCodeWebviewDocument({ ...content, themeKind: initialThemeKind }),
    [content, initialThemeKind],
  );

  const applyFrameTheme = () => {
    const themeKind = currentThemeKind();
    const themeClass = themeKind === "dark" ? "vscode-dark" : "vscode-light";
    const frameDocument = frameRef.current?.contentDocument;
    for (const element of [frameDocument?.documentElement, frameDocument?.body]) {
      if (!element) continue;
      element.classList.remove("vscode-light", "vscode-dark", "vscode-high-contrast", "vscode-high-contrast-light");
      element.classList.add(themeClass);
      element.dataset.vscodeThemeKind = themeKind;
    }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (
        !data ||
        data.type !== "lattice-vscode-webview-message" ||
        data.viewId !== content.viewId
      ) {
        return;
      }
      void Promise.resolve(onMessage(content.viewId, data.message)).then((messages) => {
        for (const message of Array.isArray(messages) ? messages : []) {
          frameRef.current?.contentWindow?.postMessage({
            type: "lattice-vscode-host-message",
            viewId: content.viewId,
            message,
          }, "*");
        }
      });
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [content.viewId, onMessage]);

  const postInitialMessages = () => {
    for (const message of content.messages ?? []) {
      frameRef.current?.contentWindow?.postMessage({
        type: "lattice-vscode-host-message",
        viewId: content.viewId,
        message,
      }, "*");
    }
  };

  const postHostMessages = (messages: unknown) => {
    for (const message of Array.isArray(messages) ? messages : []) {
      frameRef.current?.contentWindow?.postMessage({
        type: "lattice-vscode-host-message",
        viewId: content.viewId,
        message,
      }, "*");
    }
  };

  const startMessagePolling = () => {
    const generation = ++pollGenerationRef.current;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);

    const poll = async () => {
      try {
        postHostMessages(await drainMessages(content.viewId));
      } finally {
        if (pollGenerationRef.current === generation) {
          pollTimerRef.current = setTimeout(() => void poll(), HOST_MESSAGE_POLL_INTERVAL_MS);
        }
      }
    };

    pollTimerRef.current = setTimeout(() => void poll(), HOST_MESSAGE_POLL_INTERVAL_MS);
  };

  useEffect(() => () => {
    pollGenerationRef.current += 1;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(applyFrameTheme);
    observer.observe(window.document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <iframe
      ref={frameRef}
      title={`${content.title} webview`}
      className="block h-full min-h-0 w-full border-0 bg-background"
      sandbox={webviewDocument.sandbox}
      srcDoc={webviewDocument.html}
      onLoad={() => {
        applyFrameTheme();
        postInitialMessages();
        startMessagePolling();
      }}
    />
  );
}
