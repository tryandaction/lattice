import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudLibraryResource, CloudLibrarySourceProvider } from '../shared-library/source-provider';
import { getCloudWorkspaceSnapshot, resetCloudWorkspaceHost, setCloudWorkspaceActive, setCloudWorkspaceProvider, setCloudWorkspaceResource, subscribeCloudWorkspaceHost } from '../cloud-workspace-host';

afterEach(resetCloudWorkspaceHost);
describe('cloud workspace host ownership', () => {
  const provider = {} as CloudLibrarySourceProvider;
  const resource = { id: 'lattice-cloud:fixture:user:library:item' } as CloudLibraryResource;

  it('retains the selected resource when hiding the surface, but marks it inactive', () => {
    setCloudWorkspaceProvider(provider);setCloudWorkspaceResource(resource);setCloudWorkspaceActive(true);
    setCloudWorkspaceActive(false);
    expect(getCloudWorkspaceSnapshot()).toEqual({ active: false, provider, resource });
  });
  it('clears the previous account source on provider replacement or logout', () => {
    setCloudWorkspaceProvider(provider);setCloudWorkspaceResource(resource);
    setCloudWorkspaceProvider({} as CloudLibrarySourceProvider);
    expect(getCloudWorkspaceSnapshot().resource).toBeNull();
    setCloudWorkspaceResource(resource);setCloudWorkspaceProvider(null);
    expect(getCloudWorkspaceSnapshot().provider).toBeNull();expect(getCloudWorkspaceSnapshot().resource).toBeNull();
    setCloudWorkspaceResource(resource);expect(getCloudWorkspaceSnapshot().resource).toBeNull();
  });
  it('notifies consumers on changes and stops after unsubscribe', () => {
    const changed=vi.fn(),unsubscribe=subscribeCloudWorkspaceHost(changed);
    setCloudWorkspaceActive(true);setCloudWorkspaceActive(true);expect(changed).toHaveBeenCalledTimes(1);
    unsubscribe();setCloudWorkspaceActive(false);expect(changed).toHaveBeenCalledTimes(1);
  });
});
