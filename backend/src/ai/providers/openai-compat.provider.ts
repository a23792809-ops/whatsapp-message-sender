import {
  AiProviderError,
  type AIProvider,
  type AiUsage,
  type ChatMessage,
  type ProviderAdapter,
  type ProviderChatResult,
} from '../ai.types.js';

/**
 * Shared implementation for OpenAI-compatible chat completions APIs
 * (OpenAI and DeepSeek use the same request/response shape). Each concrete
 * provider only supplies its identity, endpoint, credentials and model name.
 */
export abstract class OpenAICompatProvider implements ProviderAdapter {
  constructor(
    public readonly provider: AIProvider,
    public readonly model: string,
    protected readonly apiKey: string,
    protected readonly baseUrl: string,
    protected readonly timeoutMs: number,
  ) {}

  async chat(messages: ChatMessage[]): Promise<ProviderChatResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.5,
        }),
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) {
        throw new AiProviderError('AI request timed out', 'timeout', this.provider);
      }
      throw new AiProviderError('AI provider is unreachable', 'network', this.provider);
    } finally {
      clearTimeout(timer);
    }

    let body: Record<string, any> | null = null;
    try {
      body = (await res.json()) as Record<string, any>;
    } catch {
      body = null;
    }

    if (!res.ok) {
      throw new AiProviderError(
        `AI provider returned HTTP ${res.status}: ${this.safeErrorMessage(body)}`,
        'http',
        this.provider,
        res.status,
      );
    }

    const content = this.extractContent(body);
    if (!content || content.trim().length === 0) {
      throw new AiProviderError(
        'AI provider returned no generated text',
        'invalid_response',
        this.provider,
        res.status,
      );
    }

    const model = typeof body?.model === 'string' && body.model.trim() ? body.model : this.model;
    return { content: content.trim(), model, usage: this.extractUsage(body) };
  }

  /**
   * Only real provider-reported numbers are surfaced. When usage is missing or
   * unusable we return null so the API never fabricates token counts.
   */
  private extractUsage(body: Record<string, any> | null): AiUsage | null {
    const usage = body?.usage;
    if (!usage || typeof usage !== 'object') return null;

    const input = usage.prompt_tokens ?? usage.input_tokens;
    const output = usage.completion_tokens ?? usage.output_tokens;
    if (typeof input !== 'number' || !Number.isFinite(input) || input < 0) return null;
    if (typeof output !== 'number' || !Number.isFinite(output) || output < 0) return null;

    return { inputTokens: Math.trunc(input), outputTokens: Math.trunc(output) };
  }

  private extractContent(body: Record<string, any> | null): string {
    if (!body || !Array.isArray(body.choices) || body.choices.length === 0) return '';
    const message = body.choices[0]?.message ?? body.choices[0]?.delta ?? null;
    if (typeof message?.content === 'string') return message.content;
    if (Array.isArray(message?.content)) {
      // Some providers return content as a list of parts.
      return message.content
        .filter((p: any) => typeof p?.text === 'string')
        .map((p: any) => p.text)
        .join('');
    }
    return '';
  }

  private safeErrorMessage(body: Record<string, any> | null): string {
    const error = body?.error;
    if (typeof error?.message === 'string' && error.message) return error.message;
    if (typeof body?.message === 'string' && body.message) return body.message;
    return 'unknown provider error';
  }
}