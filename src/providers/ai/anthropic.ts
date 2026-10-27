import Anthropic from "@anthropic-ai/sdk";

import { AiProviderError, type AiGenerateRequest, type AiGenerateResult, type AiProvider } from "./types";

/** Anthropic Claude implementation of the AI provider contract. */
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;

  constructor(options: { apiKey: string; model: string; client?: Anthropic }) {
    this.model = options.model;
    // Retries are owned by the job queue; the SDK must fail fast so the bot can fall back.
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 0 });
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: request.maxOutputTokens,
          system: request.system,
          messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
        },
        { timeout: request.timeoutMs, signal: AbortSignal.timeout(request.timeoutMs + 500) },
      );
    } catch (error) {
      throw mapError(error);
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (!text) throw new AiProviderError("empty", "The model returned no text");

    return {
      text,
      model: response.model,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
  }
}

function mapError(error: unknown): AiProviderError {
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiProviderError("timeout", "AI provider timed out", { cause: error });
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new AiProviderError("timeout", "AI provider timed out", { cause: error });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiProviderError("rate_limited", "AI provider rate limited", { cause: error });
  }
  if (error instanceof Anthropic.APIError && (error.status === undefined || error.status >= 500)) {
    return new AiProviderError("unavailable", "AI provider unavailable", { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiProviderError("unavailable", "AI provider unreachable", { cause: error });
  }
  return new AiProviderError("rejected", "AI provider rejected the request", { cause: error });
}
