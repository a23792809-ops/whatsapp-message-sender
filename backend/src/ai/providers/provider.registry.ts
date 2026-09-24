import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AI_LIMITS,
  DEFAULT_MODELS,
  SUPPORTED_PROVIDERS,
  type AIProvider,
  type ProviderAdapter,
} from '../ai.types.js';
import { DeepSeekProvider } from './deepseek.provider.js';
import { OpenAIProvider } from './openai.provider.js';

const API_KEY_ENV: Record<AIProvider, string> = {
  openai: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
};

const MODEL_ENV: Record<AIProvider, string> = {
  openai: 'OPENAI_MODEL',
  deepseek: 'DEEPSEEK_MODEL',
};

@Injectable()
export class ProviderRegistry {
  private readonly cache = new Map<AIProvider, ProviderAdapter>();

  constructor(private readonly config: ConfigService) {}

  /**
   * Resolve the adapter for a provider. Defaults to AI_PROVIDER when no
   * provider is requested explicitly, so clients may stay provider-agnostic.
   */
  resolve(provider?: AIProvider): ProviderAdapter {
    const name = provider ?? (this.config.get<string>('AI_PROVIDER') || 'openai');
    if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(name)) {
      throw new BadRequestException(`Unsupported AI provider: ${name}`);
    }

    const cached = this.cache.get(name as AIProvider);
    if (cached) return cached;

    const apiKey = this.config.get<string>(API_KEY_ENV[name as AIProvider]) || '';
    if (!apiKey) {
      throw new ServiceUnavailableException(
        `AI provider "${name}" is not configured (missing API key)`,
      );
    }

    const model = this.config.get<string>(MODEL_ENV[name as AIProvider]) || DEFAULT_MODELS[name as AIProvider];
    const timeoutMs = Math.max(1000, Number(this.config.get<string>('AI_TIMEOUT_MS')) || AI_LIMITS.defaultTimeoutMs);

    const adapter =
      name === 'openai'
        ? new OpenAIProvider(apiKey, model, timeoutMs)
        : new DeepSeekProvider(apiKey, model, timeoutMs);

    this.cache.set(name as AIProvider, adapter);
    return adapter;
  }
}