import { describe, expect, it, vi } from "vitest";

import { GeminiProvider } from "@/providers/ai/gemini";
import { AiProviderError, type AiGenerateRequest } from "@/providers/ai/types";

const request: AiGenerateRequest = {
  system: "You are the assistant for Boat Seafood.",
  messages: [
    { role: "user", content: "Hi" },
    { role: "assistant", content: "Hello! How can I help?" },
    { role: "user", content: "Do you deliver?" },
  ],
  maxOutputTokens: 200,
  timeoutMs: 5_000,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function respondWith(status: number, body: unknown): typeof fetch {
  return () => Promise.resolve(jsonResponse(status, body));
}

interface SentBody {
  systemInstruction: { parts: { text: string }[] };
  contents: { role: string }[];
}

async function captureError(promise: Promise<unknown>): Promise<AiProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AiProviderError) return error;
    throw error;
  }
  throw new Error("Expected an AiProviderError");
}

describe("GeminiProvider", () => {
  it("sends system instructions separately and maps roles", async () => {
    const fetchMock = vi.fn(
      respondWith(200, {
        candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: "Yes, we deliver in Dubai." }] } }],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 8 },
        modelVersion: "gemini-3.8-flash",
      }),
    );
    const provider = new GeminiProvider({ apiKey: "test-key", model: "gemini-3.8-flash", fetch: fetchMock });

    const result = await provider.generate(request);

    expect(result).toEqual({ text: "Yes, we deliver in Dubai.", model: "gemini-3.8-flash", usage: { inputTokens: 50, outputTokens: 8 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(String(init.body)) as SentBody;
    expect(body.systemInstruction.parts[0]?.text).toBe(request.system);
    expect(body.contents.map((content) => content.role)).toEqual(["user", "model", "user"]);
  });

  it.each([
    [429, "rate_limited"],
    [503, "unavailable"],
    [504, "timeout"],
    [400, "rejected"],
    [403, "rejected"],
  ])("maps HTTP %i to %s", async (status, kind) => {
    const provider = new GeminiProvider({ apiKey: "k", model: "m", fetch: respondWith(status, { error: {} }) });
    expect((await captureError(provider.generate(request))).kind).toBe(kind);
  });

  it("treats a blocked prompt as rejected and missing text as empty", async () => {
    const blocked = new GeminiProvider({ apiKey: "k", model: "m", fetch: respondWith(200, { promptFeedback: { blockReason: "SAFETY" } }) });
    expect((await captureError(blocked.generate(request))).kind).toBe("rejected");

    const empty = new GeminiProvider({ apiKey: "k", model: "m", fetch: respondWith(200, { candidates: [{ content: { parts: [] } }] }) });
    expect((await captureError(empty.generate(request))).kind).toBe("empty");
  });

  it("maps a network timeout to timeout", async () => {
    const provider = new GeminiProvider({
      apiKey: "k",
      model: "m",
      fetch: () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
    });
    expect((await captureError(provider.generate(request))).kind).toBe("timeout");
  });
});
