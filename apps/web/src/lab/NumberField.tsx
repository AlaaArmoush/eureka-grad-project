import { useEffect, useId, useRef, useState } from "react";

export function NumberField(props: {
  label: string;
  name: string;
  defaultValue: number | string;
  rule?: "finite" | "positive" | "nonnegative" | "unitInterval";
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [error, setError] = useState<string | null>(null);

  function describeError(text: string): string | null {
    if (text.trim() === "") {
      return `${props.label} is required.`;
    }

    const value = Number(text);

    if (!Number.isFinite(value)) {
      return `${props.label} must be a finite number.`;
    }

    if (props.rule === "positive" && value <= 0) {
      return `${props.label} must be greater than zero.`;
    }

    if (props.rule === "nonnegative" && value < 0) {
      return `${props.label} cannot be negative.`;
    }

    if (props.rule === "unitInterval" && (value < 0 || value > 1)) {
      return `${props.label} must be between 0 and 1.`;
    }

    return null;
  }

  useEffect(() => {
    const input = inputRef.current;

    if (input === null || input.form === null) {
      return;
    }

    const form = input.form;
    const clearError = () => {
      input.setCustomValidity("");
      setError(null);
    };

    form.addEventListener("reset", clearError);
    return () => form.removeEventListener("reset", clearError);
  }, []);

  return (
    <label className={props.compact ? "number-field-inline" : undefined}>
      <span className={props.compact ? "visually-hidden" : undefined}>{props.label}</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        name={props.name}
        defaultValue={props.defaultValue}
        autoFocus={props.autoFocus ?? false}
        required
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : errorId}
        onKeyDown={(event) => {
          if (props.compact && event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.value = event.currentTarget.defaultValue;
            event.currentTarget.setCustomValidity("");
            setError(null);
          }
        }}
        onChange={(event) => {
          event.currentTarget.setCustomValidity(describeError(event.currentTarget.value) ?? "");
          setError(null);
        }}
        onInvalid={(event) => {
          event.preventDefault();

          const input = event.currentTarget;
          const firstInvalid = input.form?.querySelector<HTMLInputElement>("input:invalid") ?? input;
          const message = describeError(input.value) ?? "Enter a valid number.";

          setError(`Invalid value: ${message} Last accepted value restored.`);

          // Let browser validation finish before restoring the rejected field.
          queueMicrotask(() => {
            if (!input.isConnected) {
              return;
            }

            input.value = input.defaultValue;
            input.setCustomValidity("");

            if (firstInvalid.isConnected) {
              firstInvalid.focus();
            }
          });
        }}
      />
      {error !== null && <span id={errorId} role="alert">{error}</span>}
    </label>
  );
}
