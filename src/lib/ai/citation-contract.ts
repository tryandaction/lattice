import { parseLinkTarget } from "@/lib/link-router/parse-link-target";
import { getFileExtension, getRendererForExtension } from "@/lib/file-utils";
import { normalizeWorkspacePath, safeDecodeLinkTarget, toSystemPath } from "@/lib/link-router/path-utils";
import { attachEvidenceAnchor } from "@/lib/link-router/evidence-target";
import { findReferenceTextRange } from "@/lib/reference-text-range";
import type { LinkTarget } from "@/lib/link-router/types";
import type { EvidenceRef } from "./types";

const MAX_BOUNDED_QUOTE_LENGTH = 240;

export interface CitationLocation {
  page?: number;
  line?: number;
  cell?: string;
  heading?: string;
  annotation?: string;
}

export interface CitationContract {
  stableId: string;
  /** Compatibility lookup for previously saved answers; ambiguous old ids are rejected. */
  legacyStableId?: string;
  /** Historical file-URL identities retained for already saved answers. */
  compatibilityStableIds?: string[];
  sourceGroupId: string;
  sourceKind: EvidenceRef["kind"];
  canonicalPath: string;
  basename: string;
  displayTitle: string;
  targetType: LinkTarget["type"] | "unresolved" | "cloud_resource";
  location: CitationLocation;
  /** Flattened location fields for consumers that do not need the nested object. */
  page?: number;
  line?: number;
  cell?: string;
  heading?: string;
  annotation?: string;
  boundedQuote?: string;
  preview?: string;
  navigationTarget: LinkTarget | null;
  resolutionStatus: "bound" | "unresolved";
  evidenceRef: EvidenceRef;
}

export interface CitationSourceGroup {
  sourceGroupId: string;
  sourceKind: EvidenceRef["kind"];
  canonicalPath: string;
  basename: string;
  displayTitle: string;
  passageCount: number;
  passages: CitationContract[];
}

export type StrictAiLinkClassification =
  | { kind: "plain_text" }
  | { kind: "external_url"; href: string }
  | { kind: "workspace_file"; href: string; citation: CitationContract }
  | { kind: "citation"; href: string; citation: CitationContract };

function deterministicId(prefix: string, value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function boundedText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length <= MAX_BOUNDED_QUOTE_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_BOUNDED_QUOTE_LENGTH - 1).trimEnd()}...`;
}

function normalizedQuoteIdentity(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s.,;:!?"'`]+$/g, "")
    .trim();
}

function sourceFamily(ref: EvidenceRef, canonicalPath: string): string {
  if (ref.kind === "pdf_page" || ref.kind === "pdf_annotation" || /\.pdf$/i.test(canonicalPath)) {
    return "pdf";
  }
  return "workspace";
}

function basenameFromPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

function displayTitleForRef(ref: EvidenceRef, basename: string): string {
  const label = ref.label.trim();
  if (!label || label.includes("/") || label.includes("\\") || label.includes("#")) {
    return basename;
  }
  return label;
}

function targetLocation(target: LinkTarget | null, ref: EvidenceRef): CitationLocation {
  if (!target) {
    return {
      page: ref.anchor?.page,
      line: ref.anchor?.lineStart,
      cell: ref.anchor?.cellId,
      heading: ref.anchor?.heading,
    };
  }

  switch (target.type) {
    case "pdf_page":
      return { page: target.page };
    case "pdf_annotation":
      return { page: target.page, annotation: target.annotationId };
    case "code_line":
      return { line: target.line };
    case "notebook_cell":
      return { cell: target.cellId };
    case "workspace_heading":
      return { heading: target.heading };
    case "workspace_text":
      return {};
    default:
      return {};
  }
}

function withEvidenceAnchor(target: LinkTarget | null, ref: EvidenceRef): LinkTarget | null {
  if (!target) return null;
  return attachEvidenceAnchor(target, {
    ...ref.anchor,
    snippet: ref.anchor?.snippet,
  });
}

function locationIdentity(location: CitationLocation): string {
  return [
    location.page ? `page:${location.page}` : "",
    location.line ? `line:${location.line}` : "",
    location.cell ? `cell:${location.cell}` : "",
    location.heading ? `heading:${location.heading}` : "",
    location.annotation ? `annotation:${location.annotation}` : "",
  ].filter(Boolean).join("|");
}

function targetIdentity(target: LinkTarget): string {
  switch (target.type) {
    case "external_url":
      return `external:${target.url}`;
    case "system_path":
      return `system:${target.path}`;
    case "workspace_file":
      return `file:${target.path}`;
    case "workspace_heading":
      return `heading:${target.path}#${target.heading}`;
    case "workspace_text":
      return `workspace-text:${target.path}#${normalizedQuoteIdentity(target.snippet)}`;
    case "pdf_page":
      return `pdf-page:${target.path}#${target.page}`;
    case "pdf_annotation":
      return `pdf-annotation:${target.path}#${target.annotationId}:${target.page ?? ""}`;
    case "code_line":
      return `code-line:${target.path}#${target.line}`;
    case "notebook_cell":
      return `notebook-cell:${target.path}#${target.cellId}`;
  }
}

export function canonicalCitationPath(locator: string): string {
  const fragmentIndex = locator.indexOf("#");
  const withoutFragment = fragmentIndex >= 0 ? locator.slice(0, fragmentIndex) : locator;
  const queryIndex = withoutFragment.indexOf("?");
  const path = queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment;
  return normalizeWorkspacePath(path.startsWith("file://") ? toSystemPath(path) : safeDecodeLinkTarget(path));
}

export function buildCitationContract(ref: EvidenceRef): CitationContract {
  if (ref.cloudIdentity) {
    const cloud = ref.cloudIdentity;
    const fragment = new URLSearchParams(ref.locator.split('#', 2)[1] ?? '');
    const page = ref.anchor?.page ?? (Number(fragment.get('page') || 0) || undefined);
    const line = ref.anchor?.lineStart ?? (Number(fragment.get('line') || 0) || undefined);
    const cell = ref.anchor?.cellId ?? fragment.get('cell') ?? undefined;
    const location = { ...(page ? { page } : {}), ...(line ? { line } : {}), ...(cell ? { cell } : {}) };
    const identity = [cloud.resourceId, cloud.version, locationIdentity(location), ref.anchor?.snippet ?? ref.preview ?? ''].join('|');
    return { stableId: deterministicId('citation-v2', identity), sourceGroupId: deterministicId('cloud-source', cloud.resourceId),
      sourceKind: ref.kind, canonicalPath: cloud.resourceId, basename: cloud.name, displayTitle: cloud.name, targetType: 'cloud_resource',
      location, ...location, boundedQuote: boundedText(ref.anchor?.snippet ?? ref.preview), preview: boundedText(ref.preview),
      navigationTarget: null, resolutionStatus: 'bound', evidenceRef: ref };
  }
  const canonicalPath = canonicalCitationPath(ref.locator);
  const basename = basenameFromPath(canonicalPath);
  const parsedTarget = parseLinkTarget(ref.locator, { pathMode: "workspace" }).target;
  const navigationTarget = withEvidenceAnchor(parsedTarget, ref);
  const location = targetLocation(navigationTarget, ref);
  const boundedQuote = boundedText(ref.anchor?.snippet ?? ref.preview);
  const sourceIdentity = `${sourceFamily(ref, canonicalPath)}:${canonicalPath}`;
  const passageIdentity = [
    sourceIdentity,
    locationIdentity(location),
    (ref.anchor?.snippet ?? ref.preview ?? "").normalize("NFKC").replace(/\s+/g, " ").trim(),
  ].join("|");
  const legacyFileUrlPath = ref.locator.startsWith("file://")
    ? normalizeWorkspacePath(safeDecodeLinkTarget(ref.locator.split("#", 1)[0].split("?", 1)[0]))
    : undefined;
  const legacyFileUrlSource = legacyFileUrlPath ? `${sourceFamily(ref, legacyFileUrlPath)}:${legacyFileUrlPath}` : undefined;

  return {
    stableId: deterministicId("citation-v2", passageIdentity),
    legacyStableId: deterministicId("citation", [sourceIdentity.toLocaleLowerCase(), locationIdentity(location), normalizedQuoteIdentity(boundedQuote)].join("|")),
    ...(legacyFileUrlSource ? { compatibilityStableIds: [
      deterministicId("citation-v2", [legacyFileUrlSource, locationIdentity(location), (ref.anchor?.snippet ?? ref.preview ?? "").normalize("NFKC").replace(/\s+/g, " ").trim()].join("|")),
      deterministicId("citation", [legacyFileUrlSource.toLocaleLowerCase(), locationIdentity(location), normalizedQuoteIdentity(boundedQuote)].join("|")),
    ] } : {}),
    sourceGroupId: deterministicId("source", sourceIdentity),
    sourceKind: ref.kind,
    canonicalPath,
    basename,
    displayTitle: displayTitleForRef(ref, basename),
    targetType: navigationTarget?.type ?? "unresolved",
    location,
    ...(location.page !== undefined ? { page: location.page } : {}),
    ...(location.line !== undefined ? { line: location.line } : {}),
    ...(location.cell !== undefined ? { cell: location.cell } : {}),
    ...(location.heading !== undefined ? { heading: location.heading } : {}),
    ...(location.annotation !== undefined ? { annotation: location.annotation } : {}),
    boundedQuote,
    preview: boundedText(ref.preview),
    navigationTarget,
    resolutionStatus: navigationTarget ? "bound" : "unresolved",
    evidenceRef: ref,
  };
}

export function buildCitationContracts(refs: EvidenceRef[]): CitationContract[] {
  return dedupeCitationContracts(refs.map(buildCitationContract));
}

export function dedupeCitationContracts(contracts: CitationContract[]): CitationContract[] {
  return Array.from(new Map(contracts.map((contract) => [contract.stableId, contract])).values());
}

export function groupCitationContracts(contracts: CitationContract[]): CitationSourceGroup[] {
  const groups = new Map<string, CitationSourceGroup>();
  for (const contract of dedupeCitationContracts(contracts)) {
    const group = groups.get(contract.sourceGroupId);
    if (group) {
      group.passages.push(contract);
      group.passageCount = group.passages.length;
      if (group.displayTitle !== contract.displayTitle) {
        group.displayTitle = group.basename;
      }
      continue;
    }
    groups.set(contract.sourceGroupId, {
      sourceGroupId: contract.sourceGroupId,
      sourceKind: contract.sourceKind,
      canonicalPath: contract.canonicalPath,
      basename: contract.basename,
      displayTitle: contract.displayTitle,
      passageCount: 1,
      passages: [contract],
    });
  }
  return Array.from(groups.values());
}

export function citationNavigationHref(contract: CitationContract): string | null {
  const cloud = contract.evidenceRef.cloudIdentity;
  if (cloud) {
    const fragment = contract.page ? `page=${contract.page}` : contract.cell ? `cell=${encodeURIComponent(contract.cell)}` : contract.line ? `line=${contract.line}` : '';
    return `/library?library=${encodeURIComponent(cloud.libraryId)}&item=${encodeURIComponent(cloud.itemId)}${fragment ? '#' + fragment : ''}`;
  }
  const target = contract.navigationTarget;
  if (!target) return null;
  const path = "path" in target ? target.path.split("/").map((part, index) => index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)).join("/") : "";
  switch (target.type) {
    case "external_url":
      return target.url;
    case "system_path":
      return target.path;
    case "workspace_file":
      return path;
    case "workspace_heading":
      return `${path}#${encodeURIComponent(target.heading)}`;
    case "pdf_page":
      return `${path}#page=${target.page}${target.snippet ? `&text=${encodeURIComponent(target.snippet)}` : ""}`;
    case "pdf_annotation": {
      const page = target.page ? `&page=${target.page}` : "";
      return `${path}#annotation=${encodeURIComponent(target.annotationId)}${page}`;
    }
    case "code_line":
      return `${path}#line=${target.line}`;
    case "notebook_cell":
      return `${path}#cell=${encodeURIComponent(target.cellId)}`;
    case "workspace_text":
      return `${path}#text=${encodeURIComponent(target.snippet)}`;
  }
}

/** Whether a source can identify actual content, rather than just open a file/page. */
export function isPreciseCitation(contract: CitationContract): boolean {
  if (contract.evidenceRef.cloudIdentity) return Boolean(contract.evidenceRef.anchor?.snippet?.trim() && (contract.page || contract.line || contract.cell));
  const target = contract.navigationTarget;
  if (!target) return false;
  if (target.type === "pdf_page") {
    return Boolean(target.snippet?.trim() || target.rects?.some((rect) => (
      [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
      && rect.left >= 0 && rect.top >= 0 && rect.width > 0 && rect.height > 0
      && rect.left + rect.width <= 1 && rect.top + rect.height <= 1
    )));
  }
  return ["pdf_annotation", "workspace_text", "code_line", "notebook_cell"].includes(target.type);
}

function resolveCitationQuote(contract: CitationContract, quote: string): CitationContract | null {
  if (!quote.trim() || quote.length > 600) return null;
  if (contract.evidenceRef.cloudIdentity) {
    const supplied = contract.evidenceRef.preview ?? contract.evidenceRef.anchor?.snippet ?? '';
    const range = findReferenceTextRange(supplied, quote, { pdfTypography: Boolean(contract.page) });
    return range ? buildCitationContract({ ...contract.evidenceRef, preview: supplied.slice(range.from, range.to),
      anchor: { ...contract.evidenceRef.anchor, snippet: supplied.slice(range.from, range.to) } }) : null;
  }
  if (contract.page && contract.evidenceRef.anchor?.page && contract.page !== contract.evidenceRef.anchor.page) return null;
  const target = contract.navigationTarget;
  if (!target || !["pdf_page", "workspace_text", "workspace_file", "workspace_heading", "code_line"].includes(target.type)) return null;
  if (target.type !== "pdf_page" && !/\.(?:md|mdx|markdown)$/i.test(contract.canonicalPath)
    && getRendererForExtension(getFileExtension(contract.canonicalPath)) !== "code") return null;
  const options = { pdfTypography: target.type === "pdf_page" };
  if (target.type === "pdf_page" && target.snippet) {
    const anchoredRange = findReferenceTextRange(target.snippet, quote, options);
    if (anchoredRange?.from === 0 && anchoredRange.to === target.snippet.length) return contract;
  }
  const suppliedText = contract.evidenceRef.preview ?? contract.evidenceRef.anchor?.snippet ?? "";
  const range = findReferenceTextRange(suppliedText, quote, options);
  // A page/file context is not a disambiguating anchor. Require a unique real quote.
  if (!range) return null;
  const originalQuote = suppliedText.slice(range.from, range.to);
  const locator = `${contract.canonicalPath.split("/").map((part, index) => index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)).join("/")}#${target.type === "pdf_page" ? `page=${target.page}&` : ""}text=${encodeURIComponent(originalQuote)}`;
  return buildCitationContract({
    ...contract.evidenceRef,
    locator,
    preview: originalQuote,
    anchor: { ...(target.type === "pdf_page" ? { page: target.page } : {}), snippet: originalQuote },
  });
}

export function classifyStrictAiLink(
  href: string,
  contracts: CitationContract[],
): StrictAiLinkClassification {
  const normalized = href.trim();
  const citationToken = normalized.match(/^citation:([a-z0-9-]+)(?:\?quote=([^&#]*))?$/i);
  if (citationToken) {
    const matches = contracts.filter((contract) => contract.stableId === citationToken[1] || contract.legacyStableId === citationToken[1] || contract.compatibilityStableIds?.includes(citationToken[1]));
    let citation = matches.length === 1 ? matches[0] : undefined;
    if (citation && citationToken[2] !== undefined) {
      try { citation = resolveCitationQuote(citation, decodeURIComponent(citationToken[2])) ?? undefined; }
      catch { return { kind: "plain_text" }; }
    }
    const resolvedHref = citation ? citationNavigationHref(citation) : null;
    return citation && resolvedHref && isPreciseCitation(citation)
      ? { kind: "citation", href: resolvedHref, citation }
      : { kind: "plain_text" };
  }

  if (/^(?:https?:\/\/|mailto:)/i.test(normalized)) {
    return { kind: "external_url", href: normalized };
  }

  if (normalized.startsWith('/library?')) {
    const matches = contracts.filter(contract => contract.evidenceRef.cloudIdentity && citationNavigationHref(contract) === normalized && isPreciseCitation(contract));
    return matches.length === 1 ? { kind: 'citation', href: normalized, citation: matches[0] } : { kind: 'plain_text' };
  }

  const target = parseLinkTarget(normalized, { pathMode: "workspace" }).target;
  if (!target || target.type === "external_url" || target.type === "system_path") {
    return { kind: "plain_text" };
  }
  if (target.type === "workspace_file" || (target.type === "pdf_page" && !target.snippet?.trim())) {
    return { kind: "plain_text" };
  }

  const targetPath = "path" in target ? normalizeWorkspacePath(target.path) : canonicalCitationPath(normalized);
  const candidates = contracts.filter((candidate) => {
    if (candidate.canonicalPath !== targetPath || !candidate.navigationTarget) return false;
    if (target.type === "workspace_text") return true;
    return targetIdentity(candidate.navigationTarget) === targetIdentity(target);
  });
  let citation: CitationContract | undefined = candidates[0];
  if ((target.type === "pdf_page" || target.type === "workspace_text") && target.snippet?.trim()) {
    const matches = dedupeCitationContracts(candidates
      .map((candidate) => resolveCitationQuote(candidate, target.snippet!))
      .filter((candidate): candidate is CitationContract => candidate !== null));
    citation = matches.length === 1 ? matches[0] : undefined;
  }

  return citation && isPreciseCitation(citation)
    ? { kind: "workspace_file", href: normalized, citation }
    : { kind: "plain_text" };
}
