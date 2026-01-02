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
    it('should render nothing when status is ready', () => {
      const { container } = render(<KernelStatus status="ready" />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Error state', () => {
    it('should render nothing when status is error', () => {
      const { container } = render(<KernelStatus status="error" />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Loading state', () => {
    it('should render loading indicator when status is loading', () => {
      const { container } = render(<KernelStatus status="loading" />);

      expect(container.textContent).toContain('Initializing Python...');
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

      expect(container.textContent).toContain('Running...');
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

      expect(container.firstChild?.className).toContain('custom-class');
    });

    it('should apply custom className when running', () => {
      const { container } = render(
        <KernelStatus status="running" className="custom-class" />
      );

      expect(container.firstChild?.className).toContain('custom-class');
    });
  });
});
