import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AI_LIMITS,
  AiProviderError,
  type AiDraftResult,
  type AiGenerateInput,
  type AiImproveInput,
  type ChatMessage,
} from './ai.types.js';
import { ProviderRegistry } from './providers/provider.registry.js';

const VAR_REGEX = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const SYSTEM_PROMPT = [
  'You are a professional WhatsApp copywriter for Bharat Gas LPG agencies in India.',
  'Write short, warm, clear, personalized customer messages.',
  'Preserve the exact template variable placeholders (e.g. {{customer_name}}, {{agency_name}}) exactly as written.',
  'Never rename, translate, or omit a placeholder, and never invent data that was not provided.',
  'Output only the final message text with no preamble, quotes, or explanations.',
].join(' ');

function extractVariables(text: string): string[] {
  const set = new Set<string>();
  const re = new RegExp(VAR_REGEX);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) set.add(m[1]);
  return Array.from(set);
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly registry: ProviderRegistry) {}

  async generate(input: AiGenerateInput): Promise<AiDraftResult> {
    this.validateTemplate(input.template);
    this.validateCustomer(input.customer);
    this.assertBudget(input);

    const expectedVariables = extractVariables(input.template);
    const userPrompt = this.buildPrompt({
      label: 'Write a personalized WhatsApp message for this customer.',
      source: input.template,
      sourceLabel: 'Original template',
      customer: input.customer,
      instructions: input.instructions,
      tone: input.tone,
    });

    const result = await this.complete(input.provider, userPrompt);
    this.assertVariablesPreserved('generate', expectedVariables, result.draft);
    return result;
  }

  async improve(input: AiImproveInput): Promise<AiDraftResult> {
    this.validateMessage(input.message);
    this.assertBudget(input);

    const expectedVariables = extractVariables(input.message);
    const userPrompt = this.buildPrompt({
      label: 'Rewrite the following existing WhatsApp message so it is clearer and more effective.',
      source: input.message,
      sourceLabel: 'Existing message',
      customer: undefined,
      instructions: input.instructions,
      tone: input.tone,
    });

    const result = await this.complete(input.provider, userPrompt);
    this.assertVariablesPreserved('improve', expectedVariables, result.draft);
    return result;
  }

  private async complete(provider: string | undefined, userPrompt: string): Promise<AiDraftResult> {
    const adapter = this.registry.resolve(provider as any);
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    const startedAt = Date.now();
    let chat;
    try {
      chat = await adapter.chat(messages);
    } catch (e) {
      throw this.fromProviderError(e);
    }
    this.logger.log(
      `ai draft provider=${adapter.provider} model=${chat.model} chars=${chat.content.length} ms=${Date.now() - startedAt}`,
    );

    return { provider: adapter.provider, model: chat.model, draft: chat.content, reviewRequired: true };
  }

  private fromProviderError(e: unknown): Error {
    if (e instanceof HttpException) return e;
    if (e instanceof AiProviderError) {
      switch (e.code) {
        case 'timeout':
          return new GatewayTimeoutException('AI request timed out');
        case 'network':
          return new BadGatewayException('AI provider is unreachable');
        case 'http':
          return new BadGatewayException(e.message);
        case 'invalid_response':
          return new BadGatewayException(e.message);
      }
    }
    return new BadRequestException('AI request failed');
  }

  private buildPrompt(opts: {
    label: string;
    source: string;
    sourceLabel: string;
    customer?: Record<string, string>;
    instructions?: string;
    tone?: string;
  }): string {
    const parts: string[] = [opts.label];
    if (opts.instructions?.trim()) parts.push(`Additional instructions: ${opts.instructions.trim()}`);
    if (opts.tone?.trim()) parts.push(`Tone: ${opts.tone.trim()}`);
    parts.push('');
    parts.push(`${opts.sourceLabel}:`);
    parts.push(opts.source);

    if (opts.customer && Object.keys(opts.customer).length > 0) {
      parts.push('');
      parts.push('Customer variables (personalize with them, but keep the {{variable}} placeholders in your output):');
      for (const [key, value] of Object.entries(opts.customer)) {
        parts.push(`${key}: ${value}`);
      }
    }

    parts.push('');
    parts.push('Rules:');
    parts.push('- Preserve every {{variable}} placeholder exactly as written. Never rename, translate, or omit one.');
    parts.push('- Output only the message text.');
    return parts.join('\n');
  }

  private assertVariablesPreserved(mode: 'generate' | 'improve', expected: string[], draft: string) {
    if (expected.length === 0) return;
    const draftVariables = new Set(extractVariables(draft));
    const missing = expected.filter((v) => !draftVariables.has(v));
    if (missing.length > 0) {
      throw new BadRequestException(
        `AI ${mode} dropped required template variable(s): ${missing.join(', ')}. Restore them and review before use.`,
      );
    }
  }

  private validateTemplate(template: string) {
    if (!template || !template.trim()) throw new BadRequestException('template is required');
    if (template.length > AI_LIMITS.maxTemplateLength) {
      throw new BadRequestException(`template exceeds max length of ${AI_LIMITS.maxTemplateLength} characters`);
    }
  }

  private validateMessage(message: string) {
    if (!message || !message.trim()) throw new BadRequestException('message is required');
    if (message.length > AI_LIMITS.maxMessageLength) {
      throw new BadRequestException(`message exceeds max length of ${AI_LIMITS.maxMessageLength} characters`);
    }
  }

  private validateCustomer(customer: Record<string, string>) {
    if (!customer || typeof customer !== 'object' || Array.isArray(customer)) {
      throw new BadRequestException('customer must be an object with string values');
    }
    const entries = Object.entries(customer);
    if (entries.length > AI_LIMITS.maxCustomerKeys) {
      throw new BadRequestException(`customer supports at most ${AI_LIMITS.maxCustomerKeys} variables`);
    }
    for (const [key, value] of entries) {
      if (typeof value !== 'string') {
        throw new BadRequestException(`customer value for "${key}" must be a string`);
      }
      if (value.length > AI_LIMITS.maxCustomerValueLength) {
        throw new BadRequestException(
          `customer value for "${key}" exceeds ${AI_LIMITS.maxCustomerValueLength} characters`,
        );
      }
    }
  }

  private assertBudget(input: object) {
    if (JSON.stringify(input).length > AI_LIMITS.maxTotalChars) {
      throw new BadRequestException(`request exceeds total size limit of ${AI_LIMITS.maxTotalChars} characters`);
    }
  }
}