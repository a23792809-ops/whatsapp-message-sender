export type AIProvider = 'openai' | 'deepseek';

export const SUPPORTED_PROVIDERS: readonly AIProvider[] = ['openai', 'deepseek'];

export const PROVIDER_ENDPOINTS: Record<AIProvider, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
};

// Sensible defaults; model names are always overridable via env vars and are
// never guaranteed to exist forever on the provider side.
export const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: 'gpt-4o-mini',
  deepseek: 'deepseek-chat',
};

export const AI_LIMITS = {
  maxTemplateLength: 8000,
  maxMessageLength: 8000,
  maxInstructionsLength: 2000,
  maxToneLength: 100,
  maxCustomerKeys: 50,
  maxCustomerValueLength: 500,
  maxLanguageLength: 32,
  maxBusinessContextLength: 1000,
  maxTotalChars: 20_000,
  defaultTimeoutMs: 30_000,
} as const;

/**
 * Language is free-form but constrained to a safe BCP-47-ish shape so it can be
 * embedded in a prompt without smuggling arbitrary content.
 */
export const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/;

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/** Real token counts reported by the provider. Never estimated or invented. */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderChatResult {
  content: string;
  model: string;
  /** null when the provider did not report usage; we never invent numbers. */
  usage: AiUsage | null;
}

/**
 * Provider abstraction: the AiService only talks to ProviderAdapter, so the
 * application never depends directly on the OpenAI or DeepSeek SDK/endpoints.
 */
export interface ProviderAdapter {
  readonly provider: AIProvider;
  readonly model: string;
  chat(messages: ChatMessage[]): Promise<ProviderChatResult>;
}

export type AiErrorCode = 'timeout' | 'network' | 'http' | 'invalid_response';

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly code: AiErrorCode,
    public readonly provider?: AIProvider,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export interface AiDraftResult {
  provider: AIProvider;
  model: string;
  /** The generated message text. Always a draft, never auto-sent. */
  content: string;
  /** Template placeholders found in the generated content. */
  variables: string[];
  /** Provider-reported token usage, or null when the provider omitted it. */
  usage: AiUsage | null;
  /** Always true: AI output requires human review before it can be used. */
  reviewRequired: true;
}

export interface AiSharedInput {
  provider?: AIProvider;
  instructions?: string;
  tone?: string;
  language?: string;
  businessContext?: string;
}

export interface AiGenerateInput extends AiSharedInput {
  template: string;
  customer: Record<string, string>;
}

export interface AiImproveInput extends AiSharedInput {
  message: string;
}

/**
 * Rewrites an existing message for one specific customer by merging the values
 * that customer actually has. Unlike generate/improve this intentionally
 * substitutes the provided variables; it still refuses invented ones.
 */
export interface AiPersonalizeInput extends AiSharedInput {
  message: string;
  customer: Record<string, string>;
}