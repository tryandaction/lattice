/**
 * Markdown Error Handler
 *
 * Provides consistent error handling across all markdown rendering components.
 * Handles KaTeX rendering failures, image loading errors, and other async operations.
 */

import { logger } from './logger';

export type ErrorType = 'math' | 'image' | 'decoration' | 'generic';

export interface ErrorContext {
  type: ErrorType;
  widget?: string;
  latex?: string;
  imageUrl?: string;
  error: Error;
  metadata?: Record<string, unknown>;
}

/**
 * Retry helper with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 100
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Retry failed'); // Should never reach here
}

/**
 * Markdown Error Handler
 */
export class MarkdownErrorHandler {
  /**
   * Handle math rendering errors
   */
  static handleMathError(
    error: Error,
    latex: string,
    container: HTMLElement,
    widget: string
  ): void {
    logger.error('KaTeX rendering failed', {
      latex: latex.substring(0, 100), // Truncate long latex
      widget,
      error: error.message,
    });

    this.renderMathErrorUI(container, latex);
  }

  /**
   * Handle image loading errors
   */
  static handleImageError(
    error: Error,
    imageUrl: string,
    container: HTMLElement,
    widget: string
  ): void {
    logger.error('Image loading failed', {
      imageUrl,
      widget,
      error: error.message,
    });

    this.renderImageErrorUI(container, imageUrl);
  }

  /**
   * Handle generic async operation errors
   */
  static handleGenericError(
    error: Error,
    context: string,
    widget: string
  ): void {
    logger.error('Async operation failed', {
      context,
      widget,
      error: error.message,
    });
  }

  /**
   * Render error UI for math rendering failures
   */
  private static renderMathErrorUI(container: HTMLElement, latex: string): void {
    container.textContent = '⚠️ Math rendering failed';
    container.classList.add('math-error');
    container.title = `Failed to render: ${latex.substring(0, 50)}${latex.length > 50 ? '...' : ''}`;
    container.style.color = '#ef4444';
    container.style.cursor = 'help';
  }

  /**
   * Render error UI for image loading failures
   */
  private static renderImageErrorUI(container: HTMLElement, imageUrl: string): void {
    container.textContent = '🖼️ Image failed to load';
    container.classList.add('image-error');
    container.title = `Failed to load: ${imageUrl}`;
    container.style.color = '#ef4444';
    container.style.cursor = 'help';
  }

  /**
   * Load KaTeX with retry logic
   */
  static async loadKaTeXWithRetry(
    loadFn: () => Promise<void>,
    latex: string,
    maxRetries: number = 3
  ): Promise<void> {
    return retryWithBackoff(loadFn, maxRetries, 100);
  }
}
