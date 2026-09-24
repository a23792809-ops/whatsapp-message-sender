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
  maxTotalChars: 20_000,
  defaultTimeoutMs: 30_000,
} as const;

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface ProviderChatResult {
  content: string;
  model: string;
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
  draft: string;
  /** AI output is always a review-required draft; it can never auto-send. */
  reviewRequired: true;
}

export interface AiGenerateInput {
  provider?: AIProvider;
  template: string;
  customer: Record<string, string>;
  instructions?: string;
  tone?: string;
}

export interface AiImproveInput {
  provider?: AIProvider;
  message: string;
  instructions?: string;
  tone?: string;
}