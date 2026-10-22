import { describe, expect, it } from "vitest";
import { createDefaultAiProviderProfile } from "../provider-profiles";
import { buildProtocolRequest, parseProtocolResponse, parseProtocolStream } from "../protocol-adapters";
import type { AiMessage } from "../types";

const messages: AiMessage[] = [
  { role: "system", content: "You are precise." },
  { role: "user", content: "Explain this." },
];

describe("AI protocol adapters", () => {
  const imageMessages: AiMessage[] = [{ role: 'user', content: [
    { type: 'text', text: 'Inspect the pixels.' },
    { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
  ] }];

  it.each(['openai-chat-completions', 'openai-responses', 'anthropic-messages', 'gemini-generate-content', 'ollama-native'] as const)('preserves real image bytes in %s request bodies', (protocol) => {
    const profile = createDefaultAiProviderProfile('custom-openai-compatible', { id: 'image-profile', model: 'vision-model' });
    const body = JSON.parse(String(buildProtocolRequest(protocol, profile, '', imageMessages).init.body));
    const text = { type: 'text', text: 'Inspect the pixels.' };
    if (protocol === 'openai-chat-completions') expect(body.messages[0].content).toEqual([text, { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }]);
    if (protocol === 'openai-responses') expect(body.input[0].content).toEqual([{ type: 'input_text', text: text.text }, { type: 'input_image', image_url: 'data:image/png;base64,iVBORw0KGgo=' }]);
    if (protocol === 'anthropic-messages') expect(body.messages[0].content).toEqual([text, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }]);
    if (protocol === 'gemini-generate-content') expect(body.contents[0].parts).toEqual([{ text: text.text }, { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } }]);
    if (protocol === 'ollama-native') expect(body.messages[0]).toEqual({ role: 'user', content: text.text, images: ['iVBORw0KGgo='] });
  });

  it('merges adjacent Anthropic roles without flattening or losing image blocks', () => {
    const profile = createDefaultAiProviderProfile('anthropic', { id: 'image-profile' });
    const body = JSON.parse(String(buildProtocolRequest('anthropic-messages', profile, '', [imageMessages[0], { role: 'user', content: 'Follow-up' }]).init.body));
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'Inspect the pixels.' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
      { type: 'text', text: 'Follow-up' },
    ]);
  });

  it.each(['openai-chat-completions', 'openai-responses', 'anthropic-messages', 'gemini-generate-content', 'ollama-native'] as const)('rejects unsafe or incomplete image content for %s', (protocol) => {
    const profile = createDefaultAiProviderProfile('custom-openai-compatible', { id: 'image-profile' });
    expect(() => buildProtocolRequest(protocol, profile, '', [{ role: 'user', content: [{ type: 'image', data: 'x', mimeType: 'image/svg+xml' }] }])).toThrow(/image/i);
  });

  it('bounds raw image bytes including sent images replayed from history', () => {
    const profile = createDefaultAiProviderProfile('custom-openai-compatible', { id: 'image-budget' });
    const data = 'A'.repeat(Math.ceil(10 * 1024 * 1024 / 3) * 4);
    const image: AiMessage = { role: 'user', content: [{ type: 'image', data, mimeType: 'image/png' }] };
    // Base64 expansion makes this one slightly exceed the individual raw-byte ceiling.
    expect(() => buildProtocolRequest('ollama-native', profile, '', [image])).toThrow(/10 MB/);
    const boundedData = data.slice(0, -4);
    const boundedImage: AiMessage = { role: 'user', content: [{ type: 'image', data: boundedData, mimeType: 'image/png' }] };
    expect(() => buildProtocolRequest('openai-chat-completions', profile, '', [boundedImage, boundedImage, boundedImage, boundedImage])).toThrow(/32 MB/);
  });

  it.each([
    ['anthropic-messages', { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Partial' } }],
    ['openai-responses', { type: 'response.output_text.delta', delta: 'Partial' }],
    ['openai-chat-completions', { choices: [{ delta: { content: 'Partial' } }] }],
    ['gemini-generate-content', { candidates: [{ content: { parts: [{ text: 'Partial' }] } }] }],
    ['ollama-native', { message: { content: 'Partial' }, done: false }],
  ] as const)('reports an incomplete stream instead of success on premature %s EOF', async (protocol, frame) => {
    const events = [];
    for await (const event of parseProtocolStream(protocol, new Response('data: ' + JSON.stringify(frame) + '\n\n'))) events.push(event);
    expect(events[0]).toEqual({ type: 'text', text: 'Partial' });
    expect(events.at(-1)).toMatchObject({ type: 'error', error: expect.stringMatching(/completion|incomplete/i) });
    expect(events.some(event => event.type === 'done')).toBe(false);
  });
  it.each([
    ['gemini-generate-content', { candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: 'Tail' }] }, finishReason: 'STOP' }] }],
    ['ollama-native', { message: { content: 'Tail' }, done: true, done_reason: 'stop' }],
  ] as const)('preserves text on the final %s frame', async (protocol, frame) => {
    const events = [];
    for await (const event of parseProtocolStream(protocol, new Response('data: ' + JSON.stringify(frame)))) events.push(event);
    expect(events).toEqual([{ type: 'text', text: 'Tail' }, { type: 'done' }]);
  });
  it('does not silently discard a damaged SSE frame before the DONE marker', async () => {
    const events = [];
    for await (const event of parseProtocolStream('openai-chat-completions', new Response('data: {broken\n\ndata: [DONE]\n\n'))) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: 'error' });
  });

  it.each(['openai-chat-completions', 'openai-responses', 'anthropic-messages', 'gemini-generate-content', 'ollama-native'] as const)('respects the configured model output ceiling for %s', (protocol) => {
    const profile = createDefaultAiProviderProfile('custom-openai-compatible', { id: 'bounded', model: 'configured-model' });
    profile.models = [{ id: 'configured-model', name: 'Configured model', enabled: true, contextWindow: 128000, maxOutputTokens: 2048 }];
    const body = JSON.parse(String(buildProtocolRequest(protocol, profile, '', messages, { maxTokens: 128000 }).init.body));
    expect(body.max_tokens ?? body.max_output_tokens ?? body.generationConfig?.maxOutputTokens ?? body.options?.num_predict).toBe(2048);
  });

  it("builds OpenAI Chat Completions requests with profile headers", () => {
    const profile = createDefaultAiProviderProfile("openrouter", { id: "router" });
    const request = buildProtocolRequest("openai-chat-completions", profile, "secret", messages, { model: "openai/gpt-4.1-mini", stream: false });
    expect(request.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toMatchObject({ Authorization: "Bearer secret", "Content-Type": "application/json" });
    expect(JSON.parse(String(request.init.body))).toMatchObject({ model: "openai/gpt-4.1-mini", messages });
  });

  it("builds Responses requests and normalizes output text", async () => {
    const profile = createDefaultAiProviderProfile("openai-responses", { id: "responses" });
    const request = buildProtocolRequest("openai-responses", profile, "secret", messages, { model: "gpt-5", stream: true });
    expect(request.url).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(String(request.init.body))).toMatchObject({ model: "gpt-5", input: messages, stream: true });
    const result = await parseProtocolResponse("openai-responses", new Response(JSON.stringify({ model: "gpt-5", output_text: "Answer" })), "gpt-5");
    expect(result).toMatchObject({ text: "Answer", model: "gpt-5" });
  });

  it("uses Gemini's documented API key header", () => {
    const profile = createDefaultAiProviderProfile("gemini", { id: "gemini-profile", model: "gemini-2.5-flash" });
    const request = buildProtocolRequest("gemini-generate-content", profile, "secret", messages);
    expect(request.init.headers).toMatchObject({ "x-goog-api-key": "secret" });
    expect(request.init.headers).not.toHaveProperty("api-key");
  });

  it("places query-key credentials in the request URL without leaking them into headers", () => {
    const profile = {
      ...createDefaultAiProviderProfile("custom-openai-compatible", {
        id: "query-key-profile",
        baseUrl: "https://gateway.example/v1",
      }),
      authMode: "query-key" as const,
    };
    const request = buildProtocolRequest("openai-chat-completions", profile, "secret value", messages);

    expect(request.url).toBe("https://gateway.example/v1/chat/completions?key=secret+value");
    expect(request.init.headers).not.toHaveProperty("x-api-key");
    expect(request.init.headers).not.toHaveProperty("Authorization");
  });

  it("uses Azure OpenAI's v1 compatibility endpoint with the deployment model", () => {
    const profile = createDefaultAiProviderProfile("azure-openai", {
      id: "azure-profile",
      baseUrl: "https://example.openai.azure.com/openai/v1",
      model: "research-deployment",
    });
    const request = buildProtocolRequest("openai-chat-completions", profile, "secret", messages);
    expect(request.url).toBe("https://example.openai.azure.com/openai/v1/chat/completions");
    expect(request.init.headers).toMatchObject({ "api-key": "secret" });
    expect(JSON.parse(String(request.init.body))).toMatchObject({ model: "research-deployment" });
  });

  it("builds an Anthropic Messages request with separated system content", () => {
    const profile = createDefaultAiProviderProfile("anthropic", { id: "anthropic-profile", model: "claude-sonnet-4-5-20250929" });
    const request = buildProtocolRequest("anthropic-messages", profile, "sk-ant-secret", messages);
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.init.headers).toMatchObject({
      "x-api-key": "sk-ant-secret",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    });
    expect(JSON.parse(String(request.init.body))).toMatchObject({
      model: "claude-sonnet-4-5-20250929",
      system: "You are precise.",
      messages: [{ role: "user", content: "Explain this." }],
    });

    const custom = createDefaultAiProviderProfile("custom-anthropic-messages", {
      id: "custom-anthropic",
      baseUrl: "https://gateway.example/v1",
      model: "claude-sonnet-4-5-20250929",
    });
    const customRequest = buildProtocolRequest("anthropic-messages", custom, "key", messages);
    expect(customRequest.url).toBe("https://gateway.example/v1/messages");
  });

  it("normalizes Anthropic message safety, usage and stream errors", async () => {
    const profile = createDefaultAiProviderProfile("anthropic", { id: "anthropic-profile", model: "claude-sonnet-4-5-20250929" });
    const safetyRequest = buildProtocolRequest("anthropic-messages", profile, "secret", [{ role: "assistant", content: "out of order" }]);
    expect(JSON.parse(String(safetyRequest.init.body))).toMatchObject({
      messages: [
        { role: "user", content: "" },
        { role: "assistant", content: "out of order" },
      ],
    });

    const result = await parseProtocolResponse("anthropic-messages", new Response(JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      content: [{ type: "text", text: "Answer" }],
      usage: { input_tokens: 12, output_tokens: 5 },
    })), "claude-sonnet-4-5-20250929");
    expect(result).toMatchObject({
      text: "Answer",
      usage: { promptTokens: 12, completionTokens: 5, totalTokens: 17 },
    });

    const streamResponse = new Response([
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
      '',
      'data: {"type":"error","error":{"message":"Overloaded"}}',
      '',
    ].join("\n"));
    const events = [];
    for await (const event of parseProtocolStream("anthropic-messages", streamResponse)) events.push(event);
    expect(events).toEqual([
      { type: "text", text: "Hi" },
      { type: "error", error: "Overloaded" },
    ]);
  });

  it("parses Chat and Responses SSE text deltas", async () => {
    const chatEvent = JSON.stringify({ choices: [{ delta: { content: "Hello" } }] });
    const chatResponse = new Response(`data: ${chatEvent}\n\ndata: [DONE]\n`);
    const chatEvents = [];
    for await (const event of parseProtocolStream("openai-chat-completions", chatResponse)) chatEvents.push(event);
    expect(chatEvents).toEqual([{ type: "text", text: "Hello" }, { type: "done" }]);

    const responsesResponse = new Response('data: {"type":"response.output_text.delta","delta":"World"}\n\ndata: {"type":"response.completed"}\n');
    const responseEvents = [];
    for await (const event of parseProtocolStream("openai-responses", responsesResponse)) responseEvents.push(event);
    expect(responseEvents).toEqual([{ type: "text", text: "World" }, { type: "done" }]);
  });
});
