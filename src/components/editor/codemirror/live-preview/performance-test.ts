/**
 * Performance Test Utilities
 *
 * 用于测试 decoration-coordinator 的性能
 */

import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { getCacheStats } from './decoration-coordinator';

export interface PerformanceMetrics {
  documentLines: number;
  documentSize: number;
  parseTime: number;
  renderTime: number;
  totalTime: number;
  cacheHitRate: number;
  memoryUsage?: number;
}

/**
 * 测量文档解析和渲染性能
 */
export function measurePerformance(view: EditorView): PerformanceMetrics {
  const doc = view.state.doc;
  const startTime = performance.now();

  // 获取缓存统计
  const cacheStatsBefore = getCacheStats();

  // 触发重新渲染
  view.dispatch({
    effects: [],
  });

  const endTime = performance.now();

  // 获取缓存统计
  const cacheStatsAfter = getCacheStats();

  // 计算缓存命中率
  const cacheHitRate = cacheStatsAfter.size > 0
    ? (cacheStatsAfter.size / cacheStatsAfter.maxSize) * 100
    : 0;

  return {
    documentLines: doc.lines,
    documentSize: doc.length,
    parseTime: 0, // 无法单独测量
    renderTime: endTime - startTime,
    totalTime: endTime - startTime,
    cacheHitRate,
    memoryUsage: (performance as any).memory?.usedJSHeapSize,
  };
}

/**
 * 运行性能测试套件
 */
export async function runPerformanceTests(view: EditorView): Promise<void> {
  console.group('🚀 Performance Test Results');

  // 测试1: 初始渲染
  console.log('\n📊 Test 1: Initial Render');
  const metrics1 = measurePerformance(view);
  logMetrics(metrics1);

  // 测试2: 滚动性能（模拟）
  console.log('\n📊 Test 2: Scroll Performance');
  const scrollStart = performance.now();
  view.dispatch({
    effects: [],
    scrollIntoView: true,
  });
  const scrollEnd = performance.now();
  console.log(`Scroll time: ${(scrollEnd - scrollStart).toFixed(2)}ms`);

  // 测试3: 编辑性能
  console.log('\n📊 Test 3: Edit Performance');
  const editStart = performance.now();
  view.dispatch({
    changes: { from: 0, insert: '# New Heading\n\n' },
  });
  const editEnd = performance.now();
  console.log(`Edit time: ${(editEnd - editStart).toFixed(2)}ms`);

  // 测试4: 缓存效率
  console.log('\n📊 Test 4: Cache Efficiency');
  const cacheStats = getCacheStats();
  console.log(`Cache size: ${cacheStats.size} / ${cacheStats.maxSize}`);
  console.log(`Cache usage: ${((cacheStats.size / cacheStats.maxSize) * 100).toFixed(2)}%`);

  console.groupEnd();
}

/**
 * 输出性能指标
 */
function logMetrics(metrics: PerformanceMetrics): void {
  console.log(`Document lines: ${metrics.documentLines.toLocaleString()}`);
  console.log(`Document size: ${(metrics.documentSize / 1024).toFixed(2)} KB`);
  console.log(`Render time: ${metrics.renderTime.toFixed(2)}ms`);
  console.log(`Total time: ${metrics.totalTime.toFixed(2)}ms`);
  console.log(`Cache hit rate: ${metrics.cacheHitRate.toFixed(2)}%`);

  if (metrics.memoryUsage) {
    console.log(`Memory usage: ${(metrics.memoryUsage / 1024 / 1024).toFixed(2)} MB`);
  }

  // 性能评级
  const rating = getPerformanceRating(metrics);
  console.log(`Performance rating: ${rating}`);
}

/**
 * 获取性能评级
 */
function getPerformanceRating(metrics: PerformanceMetrics): string {
  const timePerLine = metrics.totalTime / metrics.documentLines;

  if (timePerLine < 0.01) return '⭐⭐⭐⭐⭐ Excellent';
  if (timePerLine < 0.05) return '⭐⭐⭐⭐ Good';
  if (timePerLine < 0.1) return '⭐⭐⭐ Fair';
  if (timePerLine < 0.5) return '⭐⭐ Poor';
  return '⭐ Very Poor';
}

/**
 * 创建性能测试报告
 */
export function createPerformanceReport(metrics: PerformanceMetrics[]): string {
  let report = '# Performance Test Report\n\n';
  report += `**Generated:** ${new Date().toISOString()}\n\n`;
  report += '## Test Results\n\n';
  report += '| Document | Lines | Size (KB) | Render Time (ms) | Rating |\n';
  report += '|----------|-------|-----------|------------------|--------|\n';

  metrics.forEach((m, i) => {
    const rating = getPerformanceRating(m);
    report += `| Test ${i + 1} | ${m.documentLines.toLocaleString()} | ${(m.documentSize / 1024).toFixed(2)} | ${m.renderTime.toFixed(2)} | ${rating} |\n`;
  });

  report += '\n## Performance Metrics\n\n';
  report += '### Average Performance\n\n';

  const avgRenderTime = metrics.reduce((sum, m) => sum + m.renderTime, 0) / metrics.length;
  const avgCacheHitRate = metrics.reduce((sum, m) => sum + m.cacheHitRate, 0) / metrics.length;

  report += `- **Average Render Time:** ${avgRenderTime.toFixed(2)}ms\n`;
  report += `- **Average Cache Hit Rate:** ${avgCacheHitRate.toFixed(2)}%\n`;

  return report;
}
