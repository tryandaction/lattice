/**
 * AI Agent — Multi-step autonomous task executor
 * Based on function calling, loops until task is complete
 * Built-in tools: readFile, searchFiles, getSelection, replaceText
 */

import type {
  AiMessage,
  AiTool,
  AiToolCall,
  AgentStep,
  AgentTask,
} from './types';
import { getActiveProvider } from './inline-actions';
import { searchIndex, getWorkspaceIndex } from './workspace-indexer';

// --- Built-in Tools ---

const builtInTools: AiTool[] = [
  {
    name: 'readFile',
    description: 'Read the contents of a file in the workspace',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace root' },
      },
      required: ['path'],
    },
  },
  {
    name: 'searchFiles',
    description: 'Search workspace files by name, content summary, headings, or exports',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'listFiles',
    description: 'List all indexed files in the workspace',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'replaceText',
    description: 'Replace text in a file. Provide the file path, the old text to find, and the new text to replace it with.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        oldText: { type: 'string', description: 'Text to find' },
        newText: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'oldText', 'newText'],
    },
  },
  {
    name: 'taskComplete',
    description: 'Signal that the task is complete and provide the final result summary',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Summary of what was accomplished' },
      },
      required: ['summary'],
    },
  },
];

// --- Tool Executor ---

type FileReader = (path: string) => Promise<string>;
type FileWriter = (path: string, content: string) => Promise<void>;

export interface AgentDeps {
  readFile: FileReader;
  writeFile: FileWriter;
}

async function executeTool(
  call: AiToolCall,
  deps: AgentDeps,
): Promise<string> {
  const args = call.arguments;
  switch (call.name) {
    case 'readFile': {
      const path = args.path as string;
      try {
        const content = await deps.readFile(path);
        return content.length > 8000 ? content.slice(0, 8000) + '\n...[truncated]' : content;
      } catch (err) {
        return `Error reading file: ${(err as Error).message}`;
      }
    }
    case 'searchFiles': {
      const results = searchIndex(args.query as string, (args.limit as number) ?? 10);
      if (results.length === 0) return 'No files found matching query.';
      return results.map(f => `${f.path} (${f.size}B)${f.exports?.length ? ' exports: ' + f.exports.join(', ') : ''}`).join('\n');
    }
    case 'listFiles': {
      const index = getWorkspaceIndex();
      const paths = [...index.files.keys()];
      return paths.length > 0 ? paths.join('\n') : 'No files indexed.';
    }
    case 'replaceText': {
      const path = args.path as string;
      const oldText = args.oldText as string;
      const newText = args.newText as string;
      try {
        const content = await deps.readFile(path);
        if (!content.includes(oldText)) return `Error: old text not found in ${path}`;
        const updated = content.replace(oldText, newText);
        await deps.writeFile(path, updated);
        return `Successfully replaced text in ${path}`;
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    }
    case 'taskComplete':
      return `TASK_COMPLETE: ${args.summary}`;
    default:
      return `Unknown tool: ${call.name}`;
  }
}

// --- Agent Runner ---

const MAX_STEPS = 20;
const activeTasks = new Map<string, AgentTask>();
const taskListeners = new Set<() => void>();

function notifyTaskListeners() {
  for (const l of taskListeners) { try { l(); } catch { /* */ } }
}

export function subscribeAgentTasks(cb: () => void): () => void {
  taskListeners.add(cb);
  return () => taskListeners.delete(cb);
}

export function getAgentTask(id: string): AgentTask | undefined {
  return activeTasks.get(id);
}

export function getActiveAgentTasks(): AgentTask[] {
  return [...activeTasks.values()].filter(t => t.status === 'running');
}

/**
 * Run an agent task — loops tool calls until complete or max steps
 */
export async function runAgentTask(
  description: string,
  deps: AgentDeps,
  signal?: AbortSignal,
): Promise<AgentTask> {
  const provider = getActiveProvider();
  if (!provider) throw new Error('No AI provider configured');

  const taskId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const task: AgentTask = {
    id: taskId,
    description,
    status: 'running',
    steps: [],
  };
  activeTasks.set(taskId, task);
  notifyTaskListeners();

  const messages: AiMessage[] = [
    {
      role: 'system',
      content: `You are an AI agent that can autonomously complete coding tasks. You have access to tools to read files, search the workspace, and make edits. Use the tools to accomplish the task. When done, call taskComplete with a summary.\n\nAvailable tools: ${builtInTools.map(t => t.name).join(', ')}`,
    },
    { role: 'user', content: description },
  ];

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (signal?.aborted) {
        task.status = 'cancelled';
        notifyTaskListeners();
        return task;
      }

      const result = await provider.generate(messages, {
        temperature: 0.1,
        maxTokens: 2000,
        signal,
      });

      const text = result.text;
      task.steps.push({ type: 'thinking', content: text, timestamp: Date.now() });
      notifyTaskListeners();

      // Parse tool calls from response (format: <tool_call>{"name":"...","arguments":{...}}</tool_call>)
      const toolCallMatch = text.match(/<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/);
      if (!toolCallMatch) {
        // No tool call — agent is done or providing final response
        task.steps.push({ type: 'response', content: text, timestamp: Date.now() });
        task.status = 'completed';
        task.result = text;
        notifyTaskListeners();
        return task;
      }

      let toolCall: AiToolCall;
      try {
        const parsed = JSON.parse(toolCallMatch[1]);
        toolCall = {
          id: `call-${step}`,
          name: parsed.name,
          arguments: parsed.arguments ?? {},
        };
      } catch {
        messages.push({ role: 'assistant', content: text });
        messages.push({ role: 'user', content: 'Invalid tool call format. Use: <tool_call>{"name":"toolName","arguments":{}}</tool_call>' });
        continue;
      }

      task.steps.push({ type: 'tool_call', content: `${toolCall.name}(${JSON.stringify(toolCall.arguments)})`, toolCall, timestamp: Date.now() });
      notifyTaskListeners();

      // Execute tool
      const toolResult = await executeTool(toolCall, deps);

      task.steps.push({ type: 'tool_result', content: toolResult, toolResult: { toolCallId: toolCall.id, content: toolResult }, timestamp: Date.now() });
      notifyTaskListeners();

      // Check if task is complete
      if (toolResult.startsWith('TASK_COMPLETE:')) {
        task.status = 'completed';
        task.result = toolResult.replace('TASK_COMPLETE: ', '');
        notifyTaskListeners();
        return task;
      }

      // Feed result back to the model
      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: `Tool result for ${toolCall.name}:\n${toolResult}` });
    }

    // Max steps reached
    task.status = 'completed';
    task.result = 'Agent reached maximum step limit.';
    notifyTaskListeners();
    return task;
  } catch (err) {
    task.status = 'failed';
    task.error = (err as Error).message;
    notifyTaskListeners();
    return task;
  }
}

/**
 * Cancel a running agent task
 */
export function cancelAgentTask(taskId: string): boolean {
  const task = activeTasks.get(taskId);
  if (!task || task.status !== 'running') return false;
  task.status = 'cancelled';
  notifyTaskListeners();
  return true;
}
