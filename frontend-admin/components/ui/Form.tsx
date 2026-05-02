import { cn } from "@/lib/utils";

type FormProps = {
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
  children: React.ReactNode;
  className?: string;
};

export function Form({ onSubmit, children, className }: FormProps) {
  return (
    <form onSubmit={onSubmit} className={cn("space-y-4", className)}>
      {children}
    </form>
  );
}

type FormFieldProps = {
  label?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
};

export function FormField({
  label,
  required,
  error,
  hint,
  htmlFor,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-sm font-medium">
          {label}
          {required && <span className="ml-1 text-rose-600">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

type FormActionsProps = {
  children: React.ReactNode;
  className?: string;
};

export function FormActions({ children, className }: FormActionsProps) {
  return (
    <div className={cn("flex items-center gap-2 pt-2", className)}>
      {children}
    </div>
  );
}
