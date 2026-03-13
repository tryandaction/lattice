/**
 * Kernel Manager 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PyodideKernel } from '../pyodide-kernel';
import type { IKernelManager, ExecutionResult, KernelStatus } from '../kernel-manager';

describe('PyodideKernel', () => {
  let kernel: IKernelManager;

  beforeEach(() => {
    kernel = new PyodideKernel();
  });

  afterEach(async () => {
    if (kernel) {
      await kernel.shutdown();
    }
  });

  describe('初始化', () => {
    it('应该成功初始化', async () => {
      await kernel.initialize();
      expect(kernel.getStatus()).toBe('idle');
    }, 30000);

    it('应该只初始化一次', async () => {
      await kernel.initialize();
      await kernel.initialize();
      expect(kernel.getStatus()).toBe('idle');
    }, 30000);
  });

  describe('状态管理', () => {
    it('应该正确报告初始状态', () => {
      expect(kernel.getStatus()).toBe('idle');
    });

    it('应该在初始化时更新状态', async () => {
      const statuses: KernelStatus[] = [];
      kernel.onStatusChange((status) => {
        statuses.push(status);
      });

      await kernel.initialize();

      expect(statuses).toContain('starting');
      expect(statuses[statuses.length - 1]).toBe('idle');
    }, 30000);

    it('应该在执行时更新状态', async () => {
      await kernel.initialize();

      const statuses: KernelStatus[] = [];
      kernel.onStatusChange((status) => {
        statuses.push(status);
      });

      await kernel.execute('print("test")');

      expect(statuses).toContain('busy');
      expect(statuses[statuses.length - 1]).toBe('idle');
    }, 30000);
  });

  describe('代码执行', () => {
    beforeEach(async () => {
      await kernel.initialize();
    }, 30000);

    it('应该执行简单的 print 语句', async () => {
      const result = await kernel.execute('print("Hello, World!")');

      expect(result.status).toBe('ok');
      expect(result.outputs).toHaveLength(1);
      expect(result.outputs[0].type).toBe('stream');

      const output = result.outputs[0];
      if (output.type === 'stream') {
        expect(output.content.name).toBe('stdout');
        expect(output.content.text).toContain('Hello, World!');
      }
    }, 30000);

    it('应该执行数学计算', async () => {
      const result = await kernel.execute('2 + 2');

      expect(result.status).toBe('ok');
      expect(result.outputs.length).toBeGreaterThan(0);

      const lastOutput = result.outputs[result.outputs.length - 1];
      expect(['execute_result', 'stream']).toContain(lastOutput.type);
    }, 30000);

    it('应该处理多行代码', async () => {
      const code = `
x = 10
y = 20
print(x + y)
`;
      const result = await kernel.execute(code);

      expect(result.status).toBe('ok');
      expect(result.outputs.some(o =>
        o.type === 'stream' &&
        o.content.name === 'stdout' &&
        o.content.text.includes('30')
      )).toBe(true);
    }, 30000);

    it('应该捕获错误', async () => {
      const result = await kernel.execute('1 / 0');

      expect(result.status).toBe('error');
      expect(result.outputs.some(o => o.type === 'error')).toBe(true);

      const errorOutput = result.outputs.find(o => o.type === 'error');
      if (errorOutput && errorOutput.type === 'error') {
        expect(errorOutput.content.ename).toBeTruthy();
        expect(errorOutput.content.evalue).toBeTruthy();
      }
    }, 30000);

    it('应该处理语法错误', async () => {
      const result = await kernel.execute('print("missing quote)');

      expect(result.status).toBe('error');
      expect(result.outputs.some(o => o.type === 'error')).toBe(true);
    }, 30000);

    it('应该处理未定义变量', async () => {
      const result = await kernel.execute('undefined_variable');

      expect(result.status).toBe('error');
      expect(result.outputs.some(o => o.type === 'error')).toBe(true);
    }, 30000);
  });

  describe('变量管理', () => {
    beforeEach(async () => {
      await kernel.initialize();
    }, 30000);

    it('应该获取定义的变量', async () => {
      await kernel.execute('x = 42');
      await kernel.execute('y = "hello"');

      const variables = await kernel.getVariables();

      expect(variables).toHaveProperty('x');
      expect(variables).toHaveProperty('y');
      expect(variables.x.type).toBe('int');
      expect(variables.y.type).toBe('str');
    }, 30000);

    it('应该过滤内部变量', async () => {
      await kernel.execute('x = 1');

      const variables = await kernel.getVariables();

      expect(variables).not.toHaveProperty('__name__');
      expect(variables).not.toHaveProperty('__builtins__');
    }, 30000);
  });

  describe('Kernel 重启', () => {
    beforeEach(async () => {
      await kernel.initialize();
    }, 30000);

    it('应该清除变量', async () => {
      await kernel.execute('x = 42');

      let variables = await kernel.getVariables();
      expect(variables).toHaveProperty('x');

      await kernel.restart();

      variables = await kernel.getVariables();
      expect(variables).not.toHaveProperty('x');
    }, 60000);

    it('应该重置执行计数', async () => {
      await kernel.execute('1 + 1');
      await kernel.execute('2 + 2');

      await kernel.restart();

      const result = await kernel.execute('3 + 3');
      expect(result.executionCount).toBe(1);
    }, 60000);
  });

  describe('输出回调', () => {
    beforeEach(async () => {
      await kernel.initialize();
    }, 30000);

    it('应该触发输出回调', async () => {
      const outputs: any[] = [];
      kernel.onOutput((output) => {
        outputs.push(output);
      });

      await kernel.execute('print("test")');

      expect(outputs.length).toBeGreaterThan(0);
      expect(outputs.some(o => o.type === 'stream')).toBe(true);
    }, 30000);

    it('应该允许取消订阅', async () => {
      const outputs: any[] = [];
      const unsubscribe = kernel.onOutput((output) => {
        outputs.push(output);
      });

      await kernel.execute('print("test1")');
      const count1 = outputs.length;

      unsubscribe();

      await kernel.execute('print("test2")');
      const count2 = outputs.length;

      expect(count2).toBe(count1);
    }, 30000);
  });

  describe('代码补全', () => {
    beforeEach(async () => {
      await kernel.initialize();
    }, 30000);

    it('应该返回空补全结果（Pyodide 不支持）', async () => {
      const result = await kernel.complete('pri', 3);

      expect(result.matches).toEqual([]);
      expect(result.cursorStart).toBe(3);
      expect(result.cursorEnd).toBe(3);
    }, 30000);
  });

  describe('代码检查', () => {
    beforeEach(async () => {
      await kernel.initialize();
    }, 30000);

    it('应该返回未找到（Pyodide 不支持）', async () => {
      const result = await kernel.inspect('print', 5);

      expect(result.found).toBe(false);
    }, 30000);
  });

  describe('Kernel 关闭', () => {
    it('应该成功关闭', async () => {
      await kernel.initialize();
      await kernel.shutdown();

      expect(kernel.getStatus()).toBe('idle');
    }, 30000);
  });
});
