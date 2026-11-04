export const fieldControlClasses =
  'min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring aria-invalid:border-expense disabled:cursor-not-allowed disabled:bg-surface-raised disabled:opacity-60';

export type FieldControlProps = {
  id: string;
  required?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
};
