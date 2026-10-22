"use client";

import { createContext } from 'react';

/** relativeTo is an asset path (for example a stylesheet), relative to the source document. */
export type AsyncAssetResolver = (href: string, relativeTo?: string) => Promise<Blob | null>;
export interface AssetSource { identity: string; resolveAsset: AsyncAssetResolver }
export const AssetSourceContext = createContext<AssetSource | null>(null);
