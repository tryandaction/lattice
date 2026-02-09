'use client';

import { useState } from 'react';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { decorationCoordinatorExtension } from '@/components/editor/codemirror/live-preview/decoration-coordinator';
import { cursorContextPlugin } from '@/components/editor/codemirror/live-preview/cursor-context-plugin';

interface PerformanceResult {
  documentLines: number;
  documentSize: number;
  renderTime: number;
  timestamp: string;
}

export default function PerformanceTestPage() {
  const [results, setResults] = useState<PerformanceResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTest, setCurrentTest] = useState<string>('');

  const runTest = async (lines: number) => {
    setIsLoading(true);
    setCurrentTest(`Testing ${lines} lines...`);

    try {
      // 加载测试文档
      const response = await fetch(`/docs/tests/performance-test-${lines}-lines.md`);
      const content = await response.text();

      // 创建临时编辑器
      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      document.body.appendChild(container);

      // 测量渲染时间
      const startTime = performance.now();

      const state = EditorState.create({
        doc: content,
        extensions: [
          markdown(),
          cursorContextPlugin,
          decorationCoordinatorExtension,
        ],
      });

      const view = new EditorView({
        state,
        parent: container,
      });

      const endTime = performance.now();

      // 记录结果
      const result: PerformanceResult = {
        documentLines: state.doc.lines,
        documentSize: state.doc.length,
        renderTime: endTime - startTime,
        timestamp: new Date().toISOString(),
      };

      setResults(prev => [...prev, result]);

      // 清理
      view.destroy();
      document.body.removeChild(container);

      setCurrentTest(`✅ Completed ${lines} lines test`);
    } catch (error) {
      console.error('Test failed:', error);
      setCurrentTest(`❌ Failed ${lines} lines test`);
    } finally {
      setIsLoading(false);
    }
  };

  const runAllTests = async () => {
    setResults([]);
    await runTest(500);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await runTest(2000);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await runTest(10000);
  };

  const getRating = (timePerLine: number): string => {
    if (timePerLine < 0.01) return '⭐⭐⭐⭐⭐ Excellent';
    if (timePerLine < 0.05) return '⭐⭐⭐⭐ Good';
    if (timePerLine < 0.1) return '⭐⭐⭐ Fair';
    if (timePerLine < 0.5) return '⭐⭐ Poor';
    return '⭐ Very Poor';
  };

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Performance Test Dashboard</h1>

      <div className="mb-8 space-x-4">
        <button
          onClick={() => runTest(500)}
          disabled={isLoading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
        >
          Test 500 Lines
        </button>
        <button
          onClick={() => runTest(2000)}
          disabled={isLoading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
        >
          Test 2000 Lines
        </button>
        <button
          onClick={() => runTest(10000)}
          disabled={isLoading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
        >
          Test 10000 Lines
        </button>
        <button
          onClick={runAllTests}
          disabled={isLoading}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400"
        >
          Run All Tests
        </button>
      </div>

      {currentTest && (
        <div className="mb-4 p-4 bg-blue-100 rounded">
          {currentTest}
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-8">
          <h2 className="text-2xl font-bold mb-4">Test Results</h2>

          <table className="w-full border-collapse border border-gray-300">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-300 p-2">Document</th>
                <th className="border border-gray-300 p-2">Lines</th>
                <th className="border border-gray-300 p-2">Size (KB)</th>
                <th className="border border-gray-300 p-2">Render Time (ms)</th>
                <th className="border border-gray-300 p-2">Time/Line (ms)</th>
                <th className="border border-gray-300 p-2">Rating</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result, index) => {
                const timePerLine = result.renderTime / result.documentLines;
                return (
                  <tr key={index}>
                    <td className="border border-gray-300 p-2">Test {index + 1}</td>
                    <td className="border border-gray-300 p-2">{result.documentLines.toLocaleString()}</td>
                    <td className="border border-gray-300 p-2">{(result.documentSize / 1024).toFixed(2)}</td>
                    <td className="border border-gray-300 p-2">{result.renderTime.toFixed(2)}</td>
                    <td className="border border-gray-300 p-2">{timePerLine.toFixed(4)}</td>
                    <td className="border border-gray-300 p-2">{getRating(timePerLine)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-6 p-4 bg-gray-100 rounded">
            <h3 className="text-xl font-bold mb-2">Summary</h3>
            <p>
              <strong>Average Render Time:</strong>{' '}
              {(results.reduce((sum, r) => sum + r.renderTime, 0) / results.length).toFixed(2)}ms
            </p>
            <p>
              <strong>Total Tests:</strong> {results.length}
            </p>
          </div>
        </div>
      )}

      <div className="mt-8 p-4 bg-yellow-100 rounded">
        <h3 className="text-xl font-bold mb-2">Performance Targets</h3>
        <ul className="list-disc list-inside">
          <li>⭐⭐⭐⭐⭐ Excellent: &lt; 0.01ms per line</li>
          <li>⭐⭐⭐⭐ Good: &lt; 0.05ms per line</li>
          <li>⭐⭐⭐ Fair: &lt; 0.1ms per line</li>
          <li>⭐⭐ Poor: &lt; 0.5ms per line</li>
          <li>⭐ Very Poor: &gt; 0.5ms per line</li>
        </ul>
      </div>
    </div>
  );
}
