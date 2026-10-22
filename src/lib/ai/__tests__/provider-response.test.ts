import { describe, expect, it, vi } from "vitest";
import { extractProviderText, extractStreamTextDelta, parseSseJson } from "../provider-response";
import { createAiStreamAccumulator } from "../stream-accumulator";

describe("provider response normalization", () => {
  it("ignores an empty data heartbeat and keeps reading subsequent events", async () => {
    const response = new Response('data:\n\ndata: {"value":"after heartbeat"}\n\ndata: [DONE]\n\n');
    const events = [];
    for await (const event of parseSseJson(response)) events.push(event);
    expect(events).toEqual([{ value: "after heartbeat" }]);
  });

  it("cancels a still-open SSE connection on DONE without waiting for native shutdown", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: {"value":1}\n\ndata: [DONE]\n\n')); },
      cancel,
    }));
    const events = [];
    for await (const event of parseSseJson(response)) events.push(event);
    expect(events).toEqual([{ value: 1 }]);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(response.body!.locked).toBe(false);
  });

  it("cancels when the consumer returns early and tolerates cancellation failure", async () => {
    const cancel = vi.fn(() => Promise.reject(new Error("connection already gone")));
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: {"value":1}\n\n')); },
      cancel,
    }));
    const iterator = parseSseJson(response)[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ value: 1 });
    await expect(iterator.return!()).resolves.toMatchObject({ done: true });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(response.body!.locked).toBe(false);
  });

  it("preserves the original stream read error during cleanup", async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error("original read failure")); },
    }));
    await expect(parseSseJson(response)[Symbol.asyncIterator]().next()).rejects.toThrow("original read failure");
    expect(response.body!.locked).toBe(false);
  });

  it("joins text content parts from OpenAI-compatible responses", () => {
    expect(extractProviderText([
      { type: "text", text: "第一段" },
      { type: "image", data: "ignored" },
      { type: "text", text: "第二段" },
    ])).toBe("第一段第二段");
  });

  it("does not expose reasoning_content as the final answer", () => {
    expect(extractProviderText({ reasoning_content: "internal chain of thought" })).toBe("");
  });

  it("normalizes streamed content parts and ignores reasoning-only deltas", () => {
    expect(extractStreamTextDelta({ content: [{ type: "text", text: "delta" }] })).toBe("delta");
    expect(extractStreamTextDelta({ reasoning_content: "internal" })).toBe("");
  });

  it("accumulates one final assistant body and exposes terminal errors", () => {
    const accumulator = createAiStreamAccumulator();
    accumulator.append("第一段");
    accumulator.append("第二段");
    expect(accumulator.hasText()).toBe(true);
    expect(accumulator.text()).toBe("第一段第二段");
    accumulator.finish();
    expect(accumulator.text()).toBe("第一段第二段");

    const failed = createAiStreamAccumulator();
    failed.append("partial");
    failed.error("provider timeout");
    expect(failed.isTerminal()).toBe(true);
    expect(failed.errorMessage()).toBe("provider timeout");
  });

  it("parses SSE events split across chunks and rejects responses without a body", async () => {
    const encoder = new TextEncoder();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hel'));
        controller.enqueue(encoder.encode('lo"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: {"done":true}\n\n'));
        controller.close();
      },
    }));

    const events: Record<string, unknown>[] = [];
    for await (const event of parseSseJson(response)) events.push(event);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ choices: [{ delta: { content: "hello" } }] });
    expect(events[2]).toMatchObject({ done: true });

    await expect(async () => {
      for await (const _event of parseSseJson(new Response(null))) {
        // consume the iterator
      }
    }).rejects.toThrow("Streaming response body is unavailable");
  });
});
