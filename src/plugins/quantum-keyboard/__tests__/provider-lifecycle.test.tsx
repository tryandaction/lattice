import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { HUDProvider } from '../provider';
import { useHUDStore } from '@/stores/hud-store';
import { useQuantumPluginRuntime } from '../runtime';

vi.mock('next/dynamic', () => ({ default: () => () => null }));

afterEach(() => {
  useQuantumPluginRuntime.setState({ active: false });
  useHUDStore.getState().closeHUD();
});

describe('Quantum Keyboard provider lifetime', () => {
  it('cancels an open request that is still resolving when the plugin unmounts', async () => {
    useQuantumPluginRuntime.setState({ active: true });
    const target = document.createElement('textarea');
    document.body.append(target);
    const provider = render(<HUDProvider />);
    target.focus();
    window.dispatchEvent(new CustomEvent('lattice-open-quantum-keyboard'));
    provider.unmount();
    useQuantumPluginRuntime.setState({ active: false });
    useHUDStore.getState().closeHUD();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(useHUDStore.getState().isOpen).toBe(false);
    target.remove();
  });

  it('stops intercepting Tab as soon as the plugin is disabled', () => {
    useQuantumPluginRuntime.setState({ active: true });
    const target = document.createElement('textarea');
    document.body.append(target);
    const provider = render(<HUDProvider />);
    try {
      target.focus();
      const activeTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      target.dispatchEvent(activeTab);
      expect(activeTab.defaultPrevented).toBe(true);
      act(() => useQuantumPluginRuntime.setState({ active: false }));
      const disabledTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      target.dispatchEvent(disabledTab);
      expect(disabledTab.defaultPrevented).toBe(false);
    } finally { provider.unmount(); target.remove(); }
  });
});
