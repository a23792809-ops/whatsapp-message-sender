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
  LANGUAGE_PATTERN,
  type AiDraftResult,
  type AiGenerateInput,
  type AiImproveInput,
  type AiPersonalizeInput,
  type ChatMessage,
} from './ai.types.js';
import { ProviderRegistry } from './providers/provider.registry.js';

const VAR_REGEX = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const SYSTEM_PROMPT = [
  'You are a business WhatsApp messaging assistant for Bharat Gas LPG agencies in India.',
  'You draft short, warm, clear WhatsApp messages on behalf of a human operator.',
  'Never invent customer facts. Do not invent or guess phone numbers, addresses, agency names, agency information, dates, amounts, or account details.',
  'Only use values that were explicitly provided to you. If a detail is missing, leave a {{variable}} placeholder for the operator to fill in.',
  'Preserve provided template variables such as {{customer_name}} exactly as written. Never rename, translate, spell-correct, or drop a placeholder.',
  'Do not create deceptive, exaggerated, misleading, or legally risky claims. Do not promise prices, subsidies, discounts, refunds, or timelines that were not supplied.',
  'Never state or imply that a message has been sent, scheduled, or delivered. You only produce text.',
  'You must not send, schedule, or dispatch anything yourself, and you must not ask the operator to skip human review.',
  'Return only the final message content, with no preamble, no quotes, no explanation, and no markdown fences.',
  'Keep the output suitable for WhatsApp: plain text, short paragraphs, no subject line, no HTML.',
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
    this.assertLanguage(input.language);
    this.assertBusinessContext(input.businessContext);
    this.assertBudget(input);

    const expectedVariables = extractVariables(input.template);
    const userPrompt = this.buildPrompt({
      label: 'Write a personalized WhatsApp message for this customer.',
      source: input.template,
      sourceLabel: 'Original template',
      customer: input.customer,
      instructions: input.instructions,
      tone: input.tone,
      language: input.language,
      businessContext: input.businessContext,
    });

    const result = await this.complete(input.provider, userPrompt);
    this.assertVariablesPreserved('generate', expectedVariables, result.content);
    return result;
  }

  async improve(input: AiImproveInput): Promise<AiDraftResult> {
    this.validateMessage(input.message);
    this.assertLanguage(input.language);
    this.assertBusinessContext(input.businessContext);
    this.assertBudget(input);

    const expectedVariables = extractVariables(input.message);
    const userPrompt = this.buildPrompt({
      label: 'Rewrite the following existing WhatsApp message so it is clearer and more effective.',
      source: input.message,
      sourceLabel: 'Existing message',
      customer: undefined,
      instructions: input.instructions,
      tone: input.tone,
      language: input.language,
      businessContext: input.businessContext,
    });

    const result = await this.complete(input.provider, userPrompt);
    this.assertVariablesPreserved('improve', expectedVariables, result.content);
    return result;
  }

  /**
   * Rewrites a message for one specific customer using only that customer's
   * known values. Placeholders backed by a supplied value are resolved; any
   * placeholder left in the output stays visible so the operator can fill it.
   */
  async personalize(input: AiPersonalizeInput): Promise<AiDraftResult> {
    this.validateMessage(input.message);
    this.validateCustomer(input.customer);
    this.assertLanguage(input.language);
    this.assertBudget(input);

    const sourceVariables = extractVariables(input.message);
    const userPrompt = this.buildPrompt({
      label: 'Rewrite the following WhatsApp message for one specific customer, merging the values provided below into the text.',
      source: input.message,
      sourceLabel: 'Existing message',
      customer: input.customer,
      instructions: input.instructions,
      tone: input.tone,
      language: input.language,
      businessContext: input.businessContext,
      allowSubstitution: true,
    });

    const result = await this.complete(input.provider, userPrompt);
    this.assertNoInventedVariables('personalize', sourceVariables, input.customer, result.content);
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

    return {
      provider: adapter.provider,
      model: chat.model,
      content: chat.content,
      variables: extractVariables(chat.content),
      usage: chat.usage,
      reviewRequired: true,
    };
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
    language?: string;
    businessContext?: string;
    allowSubstitution?: boolean;
  }): string {
    const parts: string[] = [opts.label];
    if (opts.instructions?.trim()) parts.push(`Additional instructions: ${opts.instructions.trim()}`);
    if (opts.tone?.trim()) parts.push(`Tone: ${opts.tone.trim()}`);
    if (opts.language?.trim()) parts.push(`Write the message in this language: ${opts.language.trim()}.`);
    if (opts.businessContext?.trim()) {
      parts.push(
        `Business context (use only as background, do not invent further detail): ${opts.businessContext.trim()}`,
      );
    }
    parts.push('');
    parts.push(`${opts.sourceLabel}:`);
    parts.push(opts.source);

    if (opts.customer && Object.keys(opts.customer).length > 0) {
      parts.push('');
      parts.push(
        opts.allowSubstitution
          ? 'Customer values (use these exact values in the message where a matching {{variable}} appears):'
          : 'Customer variables (personalize with them, but keep the {{variable}} placeholders in your output):',
      );
      for (const [key, value] of Object.entries(opts.customer)) {
        parts.push(`${key}: ${value}`);
      }
    }

    parts.push('');
    parts.push('Rules:');
    if (opts.allowSubstitution) {
      parts.push(
        '- Replace a {{variable}} placeholder with the matching customer value above. If no value was provided for it, keep the placeholder.',
      );
      parts.push('- Never introduce a placeholder name that was not in the source message.');
    } else {
      parts.push('- Preserve every {{variable}} placeholder exactly as written. Never rename, translate, or omit one.');
    }
    parts.push('- Do not invent any detail that is not present in the source message or the values above.');
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

  /**
   * Personalize is allowed to resolve placeholders, but it must never conjure a
   * placeholder the operator never asked for.
   */
  private assertNoInventedVariables(
    mode: 'personalize',
    sourceVariables: string[],
    customer: Record<string, string>,
    content: string,
  ) {
    const allowed = new Set([...sourceVariables, ...Object.keys(customer)]);
    const invented = extractVariables(content).filter((v) => !allowed.has(v));
    if (invented.length > 0) {
      throw new BadRequestException(
        `AI ${mode} introduced unknown template variable(s): ${invented.join(', ')}. Remove them and review before use.`,
      );
    }
  }

  private assertLanguage(language?: string) {
    if (language === undefined) return;
    if (language.length > AI_LIMITS.maxLanguageLength) {
      throw new BadRequestException(`language exceeds max length of ${AI_LIMITS.maxLanguageLength} characters`);
    }
    if (language.trim() && !LANGUAGE_PATTERN.test(language.trim())) {
      throw new BadRequestException('language must be a language tag such as "en" or "hi-IN"');
    }
  }

  private assertBusinessContext(businessContext?: string) {
    if (businessContext === undefined) return;
    if (businessContext.length > AI_LIMITS.maxBusinessContextLength) {
      throw new BadRequestException(
        `businessContext exceeds max length of ${AI_LIMITS.maxBusinessContextLength} characters`,
      );
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