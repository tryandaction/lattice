/**
 * Tests for OutputArea Component
 * 
 * Tests rendering of text, image, and error outputs.
 * 
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { OutputArea } from '../output-area';
import type { ExecutionOutput } from '@/lib/python-worker-manager';

describe('OutputArea', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Empty state', () => {
    it('should render nothing when outputs array is empty', () => {
      const { container } = render(<OutputArea outputs={[]} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Text outputs', () => {
    it('should render text output with monospace font', () => {
      const outputs: ExecutionOutput[] = [
        { type: 'text', content: 'Hello, World!' }
      ];

      const { container } = render(<OutputArea outputs={outputs} />);

      const textElement = container.querySelector('pre');
      expect(textElement).toBeTruthy();
      expect(textElement?.textContent).toBe('Hello, World!');
      expect(textElement?.className).toContain('font-mono');
    });

    it('should render multiple text outputs', () => {
      const outputs: ExecutionOutput[] = [
        { type: 'text', content: 'Line 1' },
        { type: 'text', content: 'Line 2' },
        { type: 'text', content: 'Line 3' }
      ];

      const { container } = render(<OutputArea outputs={outputs} />);

      const preElements = container.querySelectorAll('pre');
      expect(preElements.length).toBe(3);
      expect(preElements[0].textContent).toBe('Line 1');
      expect(preElements[1].textContent).toBe('Line 2');
      expect(preElements[2].textContent).toBe('Line 3');
    });

    it('should preserve whitespace in text output', () => {
      const outputs: ExecutionOutput[] = [
        { type: 'text', content: '  indented\n    more indented' }
      ];

      const { container } = render(<OutputArea outputs={outputs} />);

      const textElement = container.querySelector('pre');
      expect(textElement?.className).toContain('whitespace-pre-wrap');
    });
  });

  describe('Image outputs', () => {
    it('should render image output', () => {
      const outputs: ExecutionOutput[] = [
        { type: 'image', content: 'data:image/png;base64,iVBORw0KGgo=' }
      ];

      const { container } = render(<OutputArea outputs={outputs} />);

      const imgElement = container.querySelector('img');
      expect(imgElement).toBeTruthy();
      expect(imgElement?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
      expect(imgElement?.getAttribute('alt')).toBe('Plot output');
    });

    it('should constrain image max-width', () => {
      const outputs: ExecutionOutput[] = [
        { type: 'image', content: 'data:image/png;base64,test' }
      ];

      const { container } = render(<OutputArea outputs={outputs} />);

      const imgElement = container.querySelector('img');
      expect(imgElement?.className).toContain('max-w-full');
    });
  });

  describe('Error outputs', () => {
    it('should render error output with error styling', () => {
      const outputs: ExecutionOutput[] = [
        { type: 'error', content: 'NameError: name "x" is not defined' }
      ];

      const { container } = render(<OutputArea outputs={outputs} />);

      const errorElement = container.querySelector('pre');
      expect(errorElement).toBeTruthy();
      expect(errorElement?.textContent).toContain('NameError');
      expect(errorElement?.className).toContain('text-destructive');
    });

    it('should render error with traceback', () => {
      const outputs: ExecutionOutput[] = [
        { 
          type: 'error', 
          content: 'ZeroDivisionError: division by zero\n\nTraceback:\n  File "<stdin>", line 1' 
        }
      ];

      const { container } = render(<OutputArea outputs={outputs} />);

      const errorElement = container.querySelector('pre');
      expect(errorElement?.textContent).toContain('ZeroDivisionError');
      expect(errorElement?.textContent).toContain('Traceback');
    });
  });

  describe('Mixed outputs', () => {
    it('should render mixed output types in order', () => {
      const outputs: ExecutionOutput[] = [
        { type: 'text', content: 'Starting computation...' },
        { type: 'text', content: 'Result: 42' },
        { type: 'image', content: 'data:image/png;base64,plot' },
        { type: 'error', content: 'Warning: deprecated function' }
      ];

      const { container } = render(<OutputArea outputs={outputs} />);

      // All outputs should be rendered
      expect(container.textContent).toContain('Starting computation...');
      expect(container.textContent).toContain('Result: 42');
      expect(container.querySelector('img')).toBeTruthy();
      expect(container.textContent).toContain('Warning');

      // Should be in a container with spacing
      const firstChild = container.firstChild as HTMLElement | null;
      expect(firstChild?.className).toContain('space-y-2');
    });
  });

  describe('Custom className', () => {
    it('should apply custom className', () => {
      const outputs: ExecutionOutput[] = [
        { type: 'text', content: 'test' }
      ];

      const { container } = render(
        <OutputArea outputs={outputs} className="custom-class" />
      );

      const firstChild = container.firstChild as HTMLElement | null;
      expect(firstChild?.className).toContain('custom-class');
    });
  });
});
