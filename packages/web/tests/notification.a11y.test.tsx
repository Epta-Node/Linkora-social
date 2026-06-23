import React from 'react';
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';
import { TxNotification } from '../app/components/TxNotification';

describe('TxNotification accessibility', () => {
  it('has no accessibility violations for success toast', async () => {
    const { container } = render(
      <TxNotification
        notification={{ id: '1', status: 'success', message: 'Confirmed', txHash: 'abc' }}
        onClose={() => {}}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations for error toast', async () => {
    const { container } = render(
      <TxNotification
        notification={{ id: '2', status: 'error', message: 'Insufficient balance' }}
        onClose={() => {}}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
