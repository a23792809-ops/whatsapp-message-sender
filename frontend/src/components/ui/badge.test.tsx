import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, StatusBadge } from './badge';

describe('Badge and StatusBadge components', () => {
  describe('Badge', () => {
    it('renders text content with default styling', () => {
      render(<Badge>Default Badge</Badge>);
      const badge = screen.getByText('Default Badge');
      expect(badge).toBeInTheDocument();
      expect(badge.className).toContain('bg-slate-100');
    });

    it('applies variant classes correctly', () => {
      render(<Badge variant="danger">High Risk</Badge>);
      const badge = screen.getByText('High Risk');
      expect(badge.className).toContain('bg-rose-50');
      expect(badge.className).toContain('text-rose-800');
    });

    it('applies small size styling when size="sm"', () => {
      render(<Badge size="sm">Compact</Badge>);
      const badge = screen.getByText('Compact');
      expect(badge.className).toContain('text-[11px]');
    });
  });

  describe('StatusBadge', () => {
    it.each([
      ['SENT', 'SENT'],
      ['DELIVERED', 'DELIVERED'],
      ['READ', 'READ'],
      ['RUNNING', 'RUNNING'],
      ['PAUSED', 'PAUSED'],
      ['PENDING', 'PENDING'],
      ['FAILED', 'FAILED'],
      ['STOPPED', 'STOPPED'],
      ['DRAFT', 'DRAFT'],
    ])('renders label for status %s', (statusInput, expectedText) => {
      render(<StatusBadge status={statusInput} />);
      expect(screen.getByText(expectedText)).toBeInTheDocument();
    });

    it('renders READ with distinct eye icon and success badge', () => {
      const { container } = render(<StatusBadge status="READ" />);
      const badge = screen.getByText('READ').parentElement;
      expect(badge?.className).toContain('bg-emerald-50');
      // svg icon present
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders STOPPED with danger badge', () => {
      render(<StatusBadge status="STOPPED" />);
      const badge = screen.getByText('STOPPED').parentElement;
      expect(badge?.className).toContain('bg-rose-50');
    });

    it('can hide the icon when showIcon is false', () => {
      const { container } = render(<StatusBadge status="SENT" showIcon={false} />);
      expect(screen.getByText('SENT')).toBeInTheDocument();
      expect(container.querySelector('svg')).not.toBeInTheDocument();
    });
  });
});
