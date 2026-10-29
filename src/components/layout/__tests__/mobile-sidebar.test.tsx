import { act, cleanup, render, screen } from '@testing-library/react';
import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileSidebar } from '../mobile-sidebar';

type DragInfo = { offset: { x: number }; velocity: { x: number } };
const animation = vi.hoisted(() => ({
  start: vi.fn(async () => undefined),
  onDragEnd: null as ((event: unknown, info: DragInfo) => void) | null,
}));

vi.mock('framer-motion', async () => {
  const { forwardRef } = await import('react');
  type MotionDivProps = ComponentPropsWithoutRef<'div'> & {
    initial?: unknown; animate?: unknown; exit?: unknown; variants?: unknown;
    drag?: unknown; dragConstraints?: unknown; dragElastic?: unknown;
    onDragEnd?: (event: unknown, info: DragInfo) => void;
  };
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    useAnimation: () => animation,
    motion: { div: forwardRef(({ initial, animate, exit, variants, drag, dragConstraints, dragElastic, onDragEnd, ...props }: MotionDivProps, ref: Ref<HTMLDivElement>) => {
      void [initial, animate, exit, variants, drag, dragConstraints, dragElastic];
      if (onDragEnd) animation.onDragEnd = onDragEnd;
      return <div {...props} ref={ref} />;
    }) },
  };
});

beforeEach(() => { animation.start.mockClear(); animation.onDragEnd = null; });
afterEach(cleanup);

describe('MobileSidebar visibility animation', () => {
  it('starts the open animation when the sidebar becomes open', () => {
    const { rerender } = render(<MobileSidebar isOpen={false} onClose={vi.fn()}>Cloud library</MobileSidebar>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(animation.start).not.toHaveBeenCalled();
    rerender(<MobileSidebar isOpen onClose={vi.fn()}>Cloud library</MobileSidebar>);
    expect(screen.getByRole('dialog', { name: 'Navigation sidebar' })).toBeTruthy();
    expect(animation.start).toHaveBeenCalledWith('open');
  });

  it('starts the open animation when mounted open and when reopened', () => {
    const onClose = vi.fn();
    const { rerender } = render(<MobileSidebar isOpen onClose={onClose}>Cloud library</MobileSidebar>);
    expect(animation.start).toHaveBeenCalledTimes(1);
    expect(animation.start).toHaveBeenLastCalledWith('open');
    rerender(<MobileSidebar isOpen={false} onClose={onClose}>Cloud library</MobileSidebar>);
    rerender(<MobileSidebar isOpen onClose={onClose}>Cloud library</MobileSidebar>);
    expect(animation.start).toHaveBeenCalledTimes(2);
    expect(animation.start).toHaveBeenLastCalledWith('open');
  });

  it('retains swipe-close and short-drag snap-back behavior', () => {
    const onClose = vi.fn();
    render(<MobileSidebar isOpen onClose={onClose}>Cloud library</MobileSidebar>);
    animation.start.mockClear();
    act(() => animation.onDragEnd?.({}, { offset: { x: -60 }, velocity: { x: 0 } }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(animation.start).not.toHaveBeenCalled();
    act(() => animation.onDragEnd?.({}, { offset: { x: -10 }, velocity: { x: 0 } }));
    expect(animation.start).toHaveBeenCalledWith('open');
    act(() => animation.onDragEnd?.({}, { offset: { x: -10 }, velocity: { x: -600 } }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
