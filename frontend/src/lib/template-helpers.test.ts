import { describe, it, expect } from 'vitest';
import {
  extractTemplateVariables,
  renderTemplate,
  hasUnresolvedVariables,
} from './template-helpers';

describe('template-helpers', () => {
  describe('extractTemplateVariables', () => {
    it('extracts unique variable names from template text', () => {
      const template =
        'Dear {{customer_name}}, your cylinder booking {{booking_no}} is confirmed for {{customer_name}}.';
      const variables = extractTemplateVariables(template);
      expect(variables).toEqual(['customer_name', 'booking_no']);
    });

    it('tolerates spaces inside braces', () => {
      const template = 'Hello {{  customer_name  }}, mobile {{ mobile_no }}';
      const variables = extractTemplateVariables(template);
      expect(variables).toEqual(['customer_name', 'mobile_no']);
    });

    it('returns empty array when there are no placeholders', () => {
      expect(extractTemplateVariables('Static message without placeholders')).toEqual([]);
      expect(extractTemplateVariables('')).toEqual([]);
    });
  });

  describe('renderTemplate', () => {
    it('substitutes customer-specific values into template placeholders', () => {
      const body =
        'Dear {{customer_name}}, your booking {{booking_no}} at {{agency_name}} is ready.';
      const values = {
        customer_name: 'Rahul Sharma',
        booking_no: 'BK-99881',
        agency_name: 'Alibag Bharat Gas Agency',
      };

      const { rendered, missing } = renderTemplate(body, values);
      expect(rendered).toBe(
        'Dear Rahul Sharma, your booking BK-99881 at Alibag Bharat Gas Agency is ready.',
      );
      expect(missing).toEqual([]);
    });

    it('identifies missing variables and preserves {{placeholder}} in the text', () => {
      const body = 'Dear {{customer_name}}, booking {{booking_no}}, emergency {{emergency_no}}.';
      const values = {
        customer_name: 'Rahul Sharma',
      };

      const { rendered, missing } = renderTemplate(body, values);
      expect(rendered).toBe(
        'Dear Rahul Sharma, booking {{booking_no}}, emergency {{emergency_no}}.',
      );
      expect(missing).toEqual(['booking_no', 'emergency_no']);
    });

    it('treats empty or whitespace-only values as missing', () => {
      const body = 'Hello {{customer_name}}, your ID is {{consumer_no}}.';
      const values = {
        customer_name: '   ',
        consumer_no: '',
      };

      const { rendered, missing } = renderTemplate(body, values);
      expect(rendered).toBe('Hello {{customer_name}}, your ID is {{consumer_no}}.');
      expect(missing).toEqual(['customer_name', 'consumer_no']);
    });

    it('preserves multi-line structure and Unicode/Hindi characters', () => {
      const body = 'नमस्ते {{customer_name}}!\nरिफिल बुकिंग: {{booking_no}}';
      const values = {
        customer_name: 'विजय',
        booking_no: 'BG-1234',
      };

      const { rendered, missing } = renderTemplate(body, values);
      expect(rendered).toBe('नमस्ते विजय!\nरिफिल बुकिंग: BG-1234');
      expect(missing).toEqual([]);
    });
  });

  describe('hasUnresolvedVariables', () => {
    it('returns true when unresolved placeholders remain', () => {
      expect(hasUnresolvedVariables('Hello {{name}}!')).toBe(true);
      expect(hasUnresolvedVariables('Cylinder {{ cylinder_type }} out for delivery')).toBe(true);
    });

    it('returns false when all placeholders have been replaced or none existed', () => {
      expect(hasUnresolvedVariables('Hello Rahul Sharma!')).toBe(false);
      expect(hasUnresolvedVariables('Static message with {single} braces.')).toBe(false);
      expect(hasUnresolvedVariables('')).toBe(false);
    });
  });
});
