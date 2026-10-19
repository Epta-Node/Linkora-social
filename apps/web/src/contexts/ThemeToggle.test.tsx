import { render, screen, fireEvent } from '@testing-library/react';
import ThemeToggle from './ThemeToggle';
import { ThemeProvider } from './ThemeContext';

describe('ThemeToggle', () => {
  it('toggles between light and dark themes', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    const toggleButton = screen.getByRole('button');
    fireEvent.click(toggleButton);
    expect(screen.getByText('Dark')).toBeInTheDocument();
  });

  it('applies system preference by default', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    expect(screen.getByText('System')).toBeInTheDocument();
  });
});