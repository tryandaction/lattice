/**
 * Shared Library permission matrix.
 *
 * Pure, deterministic role → capability lookup. This is a UX guard only: the
 * real authorization always happens in the API/RLS/Worker boundary. It never
 * reads React state and never touches the network.
 *
 * The matrix is built as an additive role ladder mirroring the shared design
 * (section 7.3):
 *   viewer ⊂ commenter ⊂ editor ⊂ admin ⊂ owner
 */

import type { Capability, LibraryRole } from "./domain";
import { SharedLibraryError } from "./errors";

const VIEWER_CAPABILITIES: readonly Capability[] = ["library.read", "item.read"];

const COMMENTER_CAPABILITIES: readonly Capability[] = [
  "annotation.create",
  "comment.create",
  "comment.editOwn",
];

const EDITOR_CAPABILITIES: readonly Capability[] = [
  "item.create",
  "item.update",
  "item.move",
  "item.delete",
  "itemChild.create",
  "version.create",
];

const ADMIN_CAPABILITIES: readonly Capability[] = [
  "member.manage",
  "collection.manage",
  "item.restore",
  "library.update",
  "comment.editOthers",
];

const OWNER_CAPABILITIES: readonly Capability[] = ["library.delete"];

function buildCapabilitySet(...groups: readonly (readonly Capability[])[]): ReadonlySet<Capability> {
  return new Set<Capability>(groups.flat());
}

const CAPABILITIES_BY_ROLE: Record<LibraryRole, ReadonlySet<Capability>> = {
  viewer: buildCapabilitySet(VIEWER_CAPABILITIES),
  commenter: buildCapabilitySet(VIEWER_CAPABILITIES, COMMENTER_CAPABILITIES),
  editor: buildCapabilitySet(VIEWER_CAPABILITIES, COMMENTER_CAPABILITIES, EDITOR_CAPABILITIES),
  admin: buildCapabilitySet(
    VIEWER_CAPABILITIES,
    COMMENTER_CAPABILITIES,
    EDITOR_CAPABILITIES,
    ADMIN_CAPABILITIES,
  ),
  owner: buildCapabilitySet(
    VIEWER_CAPABILITIES,
    COMMENTER_CAPABILITIES,
    EDITOR_CAPABILITIES,
    ADMIN_CAPABILITIES,
    OWNER_CAPABILITIES,
  ),
};

export function can(role: LibraryRole, capability: Capability): boolean {
  return CAPABILITIES_BY_ROLE[role].has(capability);
}

export function assertCan(role: LibraryRole, capability: Capability): void {
  if (!can(role, capability)) {
    throw new SharedLibraryError({
      code: "PERMISSION_DENIED",
      message: `Role "${role}" is not allowed to perform "${capability}"`,
      retryable: false,
    });
  }
}
