interface FieldErrorProps {
  id: string;
  message?: string;
}

/**
 * Accessible inline validation error message.
 * Pair with `aria-describedby={id}` and `aria-invalid` on the input.
 */
export function FieldError({ id, message }: FieldErrorProps) {
  if (!message) return null;
  return (
    <p id={id} role="alert" aria-live="polite" className="mt-1 text-sm text-red-600">
      {message}
    </p>
  );
}
