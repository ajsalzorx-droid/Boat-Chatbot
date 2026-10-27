/**
 * Provider-neutral contract for LLM text generation. The chatbot engine depends only on this, so
 * switching providers never touches the WhatsApp integration or the engine.
 */

export interface AiChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiGenerateRequest {
  /** Trusted instructions and company data. */
  system: string;
  /** Conversation turns; customer text is always a `user` turn, never part of `system`. */
  messages: AiChatMessage[];
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface AiGenerateResult {
  text: string;
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  generate(request: AiGenerateRequest): Promise<AiGenerateResult>;
}

export class AiProviderError extends Error {
  readonly kind: "timeout" | "rate_limited" | "unavailable" | "rejected" | "empty";

  constructor(kind: AiProviderError["kind"], message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiProviderError";
    this.kind = kind;
  }
}
