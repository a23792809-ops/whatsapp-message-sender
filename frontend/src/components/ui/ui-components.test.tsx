import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from './empty-state';
import { Modal } from './modal';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './card';
import { Send, PlusCircle } from 'lucide-react';

describe('UI primitive components', () => {
  describe('EmptyState', () => {
    it('renders title, description, and icon', () => {
      render(
        <EmptyState
          icon={Send}
          title="No campaigns found"
          description="Create your first campaign to get started."
        />,
      );

      expect(screen.getByText('No campaigns found')).toBeInTheDocument();
      expect(
        screen.getByText('Create your first campaign to get started.'),
      ).toBeInTheDocument();
    });

    it('renders action button and triggers onAction callback when clicked', () => {
      const handleAction = vi.fn();
      render(
        <EmptyState
          icon={Send}
          title="No records"
          description="Import CSV to view customers"
          actionLabel="Upload CSV"
          actionIcon={PlusCircle}
          onAction={handleAction}
        />
      );

      const actionButton = screen.getByRole('button', { name: /upload csv/i });
      expect(actionButton).toBeInTheDocument();

      fireEvent.click(actionButton);
      expect(handleAction).toHaveBeenCalledTimes(1);
    });
  });

  describe('Modal', () => {
    it('renders modal content and title when isOpen is true', () => {
      render(
        <Modal isOpen={true} onClose={vi.fn()} title="Broadcast Details">
          <p>Modal body content</p>
        </Modal>,
      );

      expect(screen.getByText('Broadcast Details')).toBeInTheDocument();
      expect(screen.getByText('Modal body content')).toBeInTheDocument();
    });

    it('returns null and does not render when isOpen is false', () => {
      render(
        <Modal isOpen={false} onClose={vi.fn()} title="Broadcast Details">
          <p>Hidden body content</p>
        </Modal>,
      );

      expect(screen.queryByText('Broadcast Details')).not.toBeInTheDocument();
      expect(screen.queryByText('Hidden body content')).not.toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', () => {
      const handleClose = vi.fn();
      render(
        <Modal isOpen={true} onClose={handleClose} title="Test Modal">
          <div>Content</div>
        </Modal>,
      );

      const closeButton = screen.getByRole('button');
      fireEvent.click(closeButton);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Card', () => {
    it('renders card header, title, description, content, and footer', () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Bharat Gas Campaign</CardTitle>
            <CardDescription>Refill notifications status</CardDescription>
          </CardHeader>
          <CardContent>
            <div>50 active recipients</div>
          </CardContent>
          <CardFooter>
            <button>View Details</button>
          </CardFooter>
        </Card>,
      );

      expect(screen.getByText('Bharat Gas Campaign')).toBeInTheDocument();
      expect(screen.getByText('Refill notifications status')).toBeInTheDocument();
      expect(screen.getByText('50 active recipients')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'View Details' })).toBeInTheDocument();
    });
  });
});
