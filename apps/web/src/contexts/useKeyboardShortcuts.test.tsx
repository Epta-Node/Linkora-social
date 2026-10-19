import { renderHook } from '@testing-library/react-hooks';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { KeyboardShortcutsProvider } from './KeyboardShortcutsContext';

describe('useKeyboardShortcuts', () => {
  it('should register shortcuts', () => {
    const wrapper = ({ children }) => (
      <KeyboardShortcutsProvider>{children}</KeyboardShortcutsProvider>
    );

    const { result } = renderHook(() => useKeyboardShortcuts(), { wrapper });
    expect(result.current).toBeDefined();
  });

  it('should handle shortcut registration', () => {
    const wrapper = ({ children }) => (
      <KeyboardShortcutsProvider>{children}</KeyboardShortcutsProvider>
    );

    const { result } = renderHook(() => useKeyboardShortcuts(), { wrapper });
    expect(result.current.register).toBeInstanceOf(Function);
  });
});