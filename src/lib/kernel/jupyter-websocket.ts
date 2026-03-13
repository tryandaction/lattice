/**
 * Jupyter WebSocket 客户端
 *
 * 管理与 Jupyter Kernel 的 WebSocket 连接
 * 支持 Shell、IOPub、Stdin、Control 四个通道
 */

import type {
  JupyterMessage,
  MessageType,
  MessageContentMap,
} from './jupyter-messages';

// ============================================================================
// WebSocket 通道类型
// ============================================================================

export type ChannelType = 'shell' | 'iopub' | 'stdin' | 'control';

// ============================================================================
// 连接状态
// ============================================================================

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

// ============================================================================
// 消息处理器
// ============================================================================

export type MessageHandler<T extends MessageType = MessageType> = (
  message: JupyterMessage<any>
) => void;

// ============================================================================
// WebSocket 通道
// ============================================================================

class JupyterWebSocketChannel {
  private ws: WebSocket | null = null;
  private url: string;
  private channelType: ChannelType;
  private messageHandlers: Map<MessageType, Set<MessageHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private state: ConnectionState = 'disconnected';
  private stateChangeCallbacks: Set<(state: ConnectionState) => void> = new Set();

  constructor(url: string, channelType: ChannelType) {
    this.url = url;
    this.channelType = channelType;
  }

  /**
   * 连接 WebSocket
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.setState('connecting');
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log(`[${this.channelType}] WebSocket connected`);
          this.setState('connected');
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          console.error(`[${this.channelType}] WebSocket error:`, error);
          this.setState('error');
        };

        this.ws.onclose = () => {
          console.log(`[${this.channelType}] WebSocket closed`);
          this.setState('disconnected');
          this.stopHeartbeat();
          this.attemptReconnect();
        };
      } catch (error) {
        this.setState('error');
        reject(error);
      }
    });
  }

  /**
   * 发送消息
   */
  send<T extends MessageType>(message: JupyterMessage<any>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`[${this.channelType}] WebSocket not connected`);
    }

    const serialized = JSON.stringify(message);
    this.ws.send(serialized);
  }

  /**
   * 监听消息
   */
  on<T extends MessageType>(
    msgType: T,
    handler: MessageHandler<T>
  ): () => void {
    if (!this.messageHandlers.has(msgType)) {
      this.messageHandlers.set(msgType, new Set());
    }
    this.messageHandlers.get(msgType)!.add(handler as MessageHandler);

    // 返回取消监听函数
    return () => {
      const handlers = this.messageHandlers.get(msgType);
      if (handlers) {
        handlers.delete(handler as MessageHandler);
      }
    };
  }

  /**
   * 监听状态变化
   */
  onStateChange(callback: (state: ConnectionState) => void): () => void {
    this.stateChangeCallbacks.add(callback);
    return () => {
      this.stateChangeCallbacks.delete(callback);
    };
  }

  /**
   * 获取当前状态
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * 关闭连接
   */
  close(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('disconnected');
  }

  /**
   * 处理接收到的消息
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as JupyterMessage;
      const msgType = message.header.msg_type as MessageType;

      // 调用对应的消息处理器
      const handlers = this.messageHandlers.get(msgType);
      if (handlers) {
        handlers.forEach((handler) => handler(message));
      }
    } catch (error) {
      console.error(`[${this.channelType}] Failed to parse message:`, error);
    }
  }

  /**
   * 设置状态
   */
  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.stateChangeCallbacks.forEach((callback) => callback(state));
    }
  }

  /**
   * 尝试重连
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[${this.channelType}] Max reconnect attempts reached`);
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `[${this.channelType}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    setTimeout(() => {
      this.connect().catch((error) => {
        console.error(`[${this.channelType}] Reconnect failed:`, error);
      });
    }, delay);
  }

  /**
   * 启动心跳检测
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // 发送 ping（Jupyter 使用 kernel_info_request 作为心跳）
        // 这里简化处理，实际可以发送 kernel_info_request
      }
    }, 30000); // 30 秒
  }

  /**
   * 停止心跳检测
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}

// ============================================================================
// Jupyter WebSocket 管理器
// ============================================================================

export class JupyterWebSocketManager {
  private shellChannel: JupyterWebSocketChannel | null = null;
  private iopubChannel: JupyterWebSocketChannel | null = null;
  private stdinChannel: JupyterWebSocketChannel | null = null;
  private controlChannel: JupyterWebSocketChannel | null = null;
  private baseUrl: string;
  private kernelId: string;

  constructor(baseUrl: string, kernelId: string) {
    this.baseUrl = baseUrl;
    this.kernelId = kernelId;
  }

  /**
   * 连接所有通道
   */
  async connect(): Promise<void> {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws');

    // 创建通道
    this.shellChannel = new JupyterWebSocketChannel(
      `${wsUrl}/api/kernels/${this.kernelId}/channels?session_id=lattice`,
      'shell'
    );
    this.iopubChannel = new JupyterWebSocketChannel(
      `${wsUrl}/api/kernels/${this.kernelId}/channels?session_id=lattice`,
      'iopub'
    );
    this.controlChannel = new JupyterWebSocketChannel(
      `${wsUrl}/api/kernels/${this.kernelId}/channels?session_id=lattice`,
      'control'
    );

    // 连接所有通道
    await Promise.all([
      this.shellChannel.connect(),
      this.iopubChannel.connect(),
      this.controlChannel.connect(),
    ]);
  }

  /**
   * 获取 Shell 通道
   */
  getShellChannel(): JupyterWebSocketChannel {
    if (!this.shellChannel) {
      throw new Error('Shell channel not initialized');
    }
    return this.shellChannel;
  }

  /**
   * 获取 IOPub 通道
   */
  getIOPubChannel(): JupyterWebSocketChannel {
    if (!this.iopubChannel) {
      throw new Error('IOPub channel not initialized');
    }
    return this.iopubChannel;
  }

  /**
   * 获取 Stdin 通道
   */
  getStdinChannel(): JupyterWebSocketChannel | null {
    return this.stdinChannel;
  }

  /**
   * 获取 Control 通道
   */
  getControlChannel(): JupyterWebSocketChannel {
    if (!this.controlChannel) {
      throw new Error('Control channel not initialized');
    }
    return this.controlChannel;
  }

  /**
   * 关闭所有通道
   */
  close(): void {
    this.shellChannel?.close();
    this.iopubChannel?.close();
    this.stdinChannel?.close();
    this.controlChannel?.close();

    this.shellChannel = null;
    this.iopubChannel = null;
    this.stdinChannel = null;
    this.controlChannel = null;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return (
      this.shellChannel?.getState() === 'connected' &&
      this.iopubChannel?.getState() === 'connected' &&
      this.controlChannel?.getState() === 'connected'
    );
  }
}
