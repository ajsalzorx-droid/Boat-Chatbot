import { AiProviderError, type AiGenerateRequest, type AiGenerateResult, type AiProvider } from "./types";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Gemini "thinking" models count their reasoning tokens against maxOutputTokens, which can use up
 * the whole budget before any answer text is produced. Reply length is still enforced by the engine.
 */
const THINKING_HEADROOM_TOKENS = 1024;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
}

/** Google Gemini implementation of the AI provider contract (REST, no SDK dependency). */
export class GeminiProvider implements AiProvider {
  readonly name = "gemini";
  readonly model: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { apiKey: string; model: string; fetch?: typeof fetch }) {
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    const body = {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: request.messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      generationConfig: { maxOutputTokens: request.maxOutputTokens + THINKING_HEADROOM_TOKENS },
    };

    let response: Response;
    try {
      // Retries are owned by the job queue; fail fast so the bot can fall back.
      response = await this.fetchImpl(`${API_BASE}/models/${encodeURIComponent(this.model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(request.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new AiProviderError("timeout", "AI provider timed out", { cause: error });
      }
      throw new AiProviderError("unavailable", "AI provider unreachable", { cause: error });
    }

    if (!response.ok) throw mapStatus(response.status);

    let data: GeminiResponse;
    try {
      data = (await response.json()) as GeminiResponse;
    } catch (error) {
      throw new AiProviderError("unavailable", "AI provider returned an invalid response", { cause: error });
    }

    if (data.promptFeedback?.blockReason) throw new AiProviderError("rejected", "AI provider blocked the request");

    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .filter((part) => !part.thought && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (!text) throw new AiProviderError("empty", "The model returned no text");

    return {
      text,
      model: data.modelVersion ?? this.model,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? null,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
      },
    };
  }
}

function mapStatus(status: number): AiProviderError {
  if (status === 429) return new AiProviderError("rate_limited", "AI provider rate limited");
  if (status === 408 || status === 504) return new AiProviderError("timeout", "AI provider timed out");
  if (status >= 500) return new AiProviderError("unavailable", "AI provider unavailable");
  return new AiProviderError("rejected", "AI provider rejected the request");
}
