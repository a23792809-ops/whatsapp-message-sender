import { PROVIDER_ENDPOINTS } from '../ai.types.js';
import { OpenAICompatProvider } from './openai-compat.provider.js';

export class OpenAIProvider extends OpenAICompatProvider {
  constructor(apiKey: string, model: string, timeoutMs: number) {
    super('openai', model, apiKey, PROVIDER_ENDPOINTS.openai, timeoutMs);
  }
}