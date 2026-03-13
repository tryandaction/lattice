/**
 * Jupyter Messages 单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  createMessageHeader,
  createMessage,
  type MessageHeader,
  type ExecuteRequestContent,
  type StreamContent,
} from '../jupyter-messages';

describe('Jupyter Messages', () => {
  describe('createMessageHeader', () => {
    it('应该创建有效的消息头', () => {
      const header = createMessageHeader('execute_request', 'test-session', 'test-user');

      expect(header.msg_id).toBeTruthy();
      expect(header.msg_type).toBe('execute_request');
      expect(header.username).toBe('test-user');
      expect(header.session).toBe('test-session');
      expect(header.date).toBeTruthy();
      expect(header.version).toBe('5.3');
    });

    it('应该使用默认用户名', () => {
      const header = createMessageHeader('execute_request', 'test-session');

      expect(header.username).toBe('lattice');
    });

    it('应该生成唯一的消息 ID', () => {
      const header1 = createMessageHeader('execute_request', 'session1');
      const header2 = createMessageHeader('execute_request', 'session1');

      expect(header1.msg_id).not.toBe(header2.msg_id);
    });

    it('应该生成有效的 ISO 8601 时间戳', () => {
      const header = createMessageHeader('execute_request', 'test-session');

      expect(() => new Date(header.date)).not.toThrow();
      expect(new Date(header.date).toISOString()).toBe(header.date);
    });
  });

  describe('createMessage', () => {
    it('应该创建 execute_request 消息', () => {
      const content: ExecuteRequestContent = {
        code: 'print("hello")',
        silent: false,
        store_history: true,
        allow_stdin: false,
        stop_on_error: true,
      };

      const message = createMessage('execute_request', content, 'test-session');

      expect(message.header.msg_type).toBe('execute_request');
      expect(message.content).toEqual(content);
      expect(message.parent_header).toEqual({});
      expect(message.metadata).toEqual({});
      expect(message.buffers).toEqual([]);
    });

    it('应该创建 stream 消息', () => {
      const content: StreamContent = {
        name: 'stdout',
        text: 'Hello, World!',
      };

      const message = createMessage('stream', content, 'test-session');

      expect(message.header.msg_type).toBe('stream');
      expect(message.content).toEqual(content);
    });

    it('应该包含父消息头', () => {
      const parentHeader: Partial<MessageHeader> = {
        msg_id: 'parent-msg-id',
        msg_type: 'execute_request',
      };

      const content: StreamContent = {
        name: 'stdout',
        text: 'output',
      };

      const message = createMessage('stream', content, 'test-session', parentHeader);

      expect(message.parent_header).toEqual(parentHeader);
    });

    it('应该创建有效的消息结构', () => {
      const content: ExecuteRequestContent = {
        code: 'x = 1',
        silent: false,
        store_history: true,
        allow_stdin: false,
        stop_on_error: true,
      };

      const message = createMessage('execute_request', content, 'test-session');

      expect(message).toHaveProperty('header');
      expect(message).toHaveProperty('parent_header');
      expect(message).toHaveProperty('metadata');
      expect(message).toHaveProperty('content');
      expect(message).toHaveProperty('buffers');
    });
  });

  describe('类型安全', () => {
    it('应该正确推断消息内容类型', () => {
      const content: ExecuteRequestContent = {
        code: 'test',
        silent: false,
        store_history: true,
        allow_stdin: false,
        stop_on_error: true,
      };

      const message = createMessage('execute_request', content, 'session');

      // TypeScript 应该知道 message.content 的类型
      expect(message.content.code).toBe('test');
      expect(message.content.silent).toBe(false);
    });
  });
});
