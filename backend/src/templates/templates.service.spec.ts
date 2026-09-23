import { describe, expect, it } from 'vitest';
import { TemplatesService } from './templates.service.js';

describe('TemplatesService.extractVariables', () => {
  it('returns unique variables in order of first occurrence', () => {
    expect(TemplatesService.extractVariables('Hi {{name}}, refill {{name}} on {{date}}')).toEqual([
      'name',
      'date',
    ]);
  });

  it('returns an empty array when there are no variables', () => {
    expect(TemplatesService.extractVariables('Plain text message')).toEqual([]);
  });

  it('matches variables with surrounding whitespace', () => {
    expect(TemplatesService.extractVariables('Hello {{ name }}!')).toEqual(['name']);
  });
});

describe('TemplatesService.extractTemplateParameters', () => {
  it('returns parameter values in first-occurrence order without duplicates', () => {
    const values = { name: 'Ram', date: '05-07-2026' };
    expect(
      TemplatesService.extractTemplateParameters('Hi {{name}}, refill {{name}} on {{date}}', values),
    ).toEqual(['Ram', '05-07-2026']);
  });

  it('skips variables missing from the values map', () => {
    expect(TemplatesService.extractTemplateParameters('{{name}} {{age}}', { name: 'Ram' })).toEqual([
      'Ram',
    ]);
  });
});

describe('TemplatesService.render', () => {
  it('substitutes known variables and leaves unknown placeholders intact', () => {
    const { rendered } = TemplatesService.render('Hi {{name}}, refill {{date}}', {
      name: 'Ram',
      date: '05-07-2026',
    });
    expect(rendered).toBe('Hi Ram, refill 05-07-2026');
  });

  it('reports missing variables only once per variable name', () => {
    const { rendered, missing } = TemplatesService.render('Hi {{name}}, refill {{name}} on {{date}}', {
      name: 'Ram',
    });
    expect(rendered).toBe('Hi Ram, refill Ram on {{date}}');
    expect(missing).toEqual(['date']);
  });

  it('reports no missing variables when all are provided', () => {
    const { rendered, missing } = TemplatesService.render('Hi {{name}}', { name: 'Ram' });
    expect(rendered).toBe('Hi Ram');
    expect(missing).toEqual([]);
  });
});