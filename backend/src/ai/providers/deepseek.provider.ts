import { PROVIDER_ENDPOINTS } from '../ai.types.js';
import { OpenAICompatProvider } from './openai-compat.provider.js';

export class DeepSeekProvider extends OpenAICompatProvider {
  constructor(apiKey: string, model: string, timeoutMs: number) {
    super('deepseek', model, apiKey, PROVIDER_ENDPOINTS.deepseek, timeoutMs);
  }
}