import { render, screen } from '@testing-library/react';
import KeyboardShortcutsModal from './KeyboardShortcutsModal';
import { KeyboardShortcutsProvider } from './KeyboardShortcutsContext';

describe('KeyboardShortcutsModal', () => {
  it('renders modal with shortcuts', () => {
    render(
      <KeyboardShortcutsProvider>
        <KeyboardShortcutsModal />
      </KeyboardShortcutsProvider>
    );

    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+K')).toBeInTheDocument();
  });

  it('closes when escape key is pressed', () => {
    render(
      <KeyboardShortcutsProvider>
        <KeyboardShortcutsModal />
      </KeyboardShortcutsProvider>
    );

    const modal = screen.getByRole('dialog');
    fireEvent.keyDown(modal, { key: 'Escape' });
    expect(modal).not.toBeVisible();
  });
});