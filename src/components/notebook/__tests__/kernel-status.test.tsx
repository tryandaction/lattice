/**
 * Tests for KernelStatus Component
 * 
 * Tests the loading and running status indicators.
 * 
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { KernelStatus } from '../kernel-status';

describe('KernelStatus', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Idle state', () => {
    it('should render nothing when status is idle', () => {
      const { container } = render(<KernelStatus status="idle" />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Ready state', () => {
    it('should render ready indicator when status is ready', () => {
      const { container } = render(<KernelStatus status="ready" />);
      expect(container.textContent).toContain('Kernel ready');
    });
  });

  describe('Error state', () => {
    it('should render error indicator when status is error', () => {
      const { container } = render(<KernelStatus status="error" />);
      expect(container.textContent).toContain('Kernel error');
    });
    
    it('should render custom error message when provided', () => {
      const { container } = render(<KernelStatus status="error" error="Custom error" />);
      expect(container.textContent).toContain('Custom error');
    });
  });

  describe('Loading state', () => {
    it('should render loading indicator when status is loading', () => {
      const { container } = render(<KernelStatus status="loading" />);

      expect(container.textContent).toContain('Initializing Python kernel...');
    });

    it('should show progress bar during loading', () => {
      const { container } = render(<KernelStatus status="loading" />);

      // Should have a progress bar element
      const progressBar = container.querySelector('.bg-primary');
      expect(progressBar).toBeTruthy();
    });
  });

  describe('Running state', () => {
    it('should render running indicator when status is running', () => {
      const { container } = render(<KernelStatus status="running" />);

      expect(container.textContent).toContain('Executing...');
    });

    it('should show spinner during running', () => {
      const { container } = render(<KernelStatus status="running" />);

      // Should have a spinning SVG
      const spinner = container.querySelector('.animate-spin');
      expect(spinner).toBeTruthy();
    });
  });

  describe('Custom className', () => {
    it('should apply custom className when loading', () => {
      const { container } = render(
        <KernelStatus status="loading" className="custom-class" />
      );

      const firstChild = container.firstChild as HTMLElement | null;
      expect(firstChild?.className).toContain('custom-class');
    });

    it('should apply custom className when running', () => {
      const { container } = render(
        <KernelStatus status="running" className="custom-class" />
      );

      const firstChild = container.firstChild as HTMLElement | null;
      expect(firstChild?.className).toContain('custom-class');
    });
  });
});
