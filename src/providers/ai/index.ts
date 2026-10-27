import "server-only";

import { getAiConfig, type AiProviderName } from "@/lib/config/env";

import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import type { AiProvider } from "./types";

/** One factory per supported provider; adding a provider = one entry here + its class. */
const FACTORIES: Record<Exclude<AiProviderName, "none">, (options: { apiKey: string; model: string }) => AiProvider> = {
  anthropic: (options) => new AnthropicProvider(options),
  gemini: (options) => new GeminiProvider(options),
};

export type { AiProvider } from "./types";
export { AiProviderError } from "./types";

export interface ResolvedAiProvider {
  provider: AiProvider;
  timeoutMs: number;
}

/**
 * Returns the configured provider, or null when AI is not configured. Never throws: the bot must
 * keep answering from FAQs and rules without AI.
 */
export function getAiProvider(): ResolvedAiProvider | null {
  const config = getAiConfig();
  if (!config.enabled) return null;

  return { provider: FACTORIES[config.provider]({ apiKey: config.apiKey, model: config.model }), timeoutMs: config.timeoutMs };
}
