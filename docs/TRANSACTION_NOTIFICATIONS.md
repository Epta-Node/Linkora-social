Transaction notifications
=========================

Quick guide: how to emit transaction toasts from contract-write handlers.

Overview
--------
- Use the `NotificationProvider` (already mounted in the app layout).
- Use the `useNotification()` hook to add and update notifications.
- When performing a contract write, emit a `pending` notification, then update it to `success` or `error`.
- When possible, return `{ txHash }` from your write handler so the toast can include a Stellar Expert link.

Example (React handler)
------------------------

```tsx
import { useNotification } from '@/components/NotificationContext';
import { normalizeError } from '@/lib/normalizeError';

async function handleSubmit(values) {
  const { addNotification, updateNotification } = useNotification();
  const id = addNotification({ status: 'pending', message: 'Waiting for signature...' });
  try {
    // call your contract / wallet to submit the transaction
    const result = await submitContractTx(values);
    // prefer returning a real tx hash from the submit call
    const txHash = result?.txHash ?? `tx_${Date.now().toString(36)}`;
    updateNotification(id, { status: 'success', message: 'Transaction confirmed', txHash });
    return { txHash };
  } catch (err) {
    updateNotification(id, { status: 'error', message: normalizeError(err) });
    throw err;
  }
}
```

Notes
-----
- Success toasts auto-dismiss after ~4s. Error toasts persist until closed.
- For accessibility, toasts use `role="status"` for success and `role="alert"` for errors and are announced via `aria-live`.
- Normalize contract/wallet errors with `normalizeError()` for friendly messages.

Where to update
---------------
- Update UI handlers that call contract write functions: `post`, `like`, `tip`, `follow`, `pool deposit`.
- Ensure the write functions return `{ txHash }` when available so the Stellar Expert link is shown.
