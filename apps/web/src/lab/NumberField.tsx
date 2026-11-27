import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import { labStore } from "./store.js";

// Half the guide bubble's widest size, used to keep it inside the window.
const GUIDE_HALF_WIDTH_PIXELS = 110;

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
  const guideId = useId();
  const [error, setError] = useState<string | null>(null);
  // An opened Curriculum question can point the learner at this field, once.
  const guide = useStore(labStore, (state) => {
    const fieldGuide = state.fieldGuide;
    return fieldGuide !== null && fieldGuide.fieldName === props.name ? fieldGuide.message : null;
  });
  // Where the bubble sits on screen: centred above the input, kept inside the window.
  const [guidePosition, setGuidePosition] = useState<{ left: number; top: number; arrowOffset: number } | null>(null);

  useEffect(() => {
    const input = inputRef.current;

    if (guide === null || input === null) {
      return;
    }

    input.focus({ preventScroll: true });
    input.scrollIntoView({ block: "nearest" });

    // Measure on the next frame, after the scroll has moved the field.
    const frame = requestAnimationFrame(() => {
      const rect = input.getBoundingClientRect();
      const centre = rect.left + rect.width / 2;
      const left = Math.min(Math.max(centre, GUIDE_HALF_WIDTH_PIXELS + 8), window.innerWidth - GUIDE_HALF_WIDTH_PIXELS - 8);
      setGuidePosition({ left, top: rect.top - 10, arrowOffset: centre - left });
    });

    return () => cancelAnimationFrame(frame);
  }, [guide]);

  // The bubble shows once, then removes itself when its fade-out ends.
  function endGuide(): void {
    setGuidePosition(null);
    labStore.getState().setFieldGuide(null);
  }

  const describedBy = [error === null ? null : errorId, guide === null ? null : guideId].filter((id) => id !== null).join(" ");

  function describeError(text: string): string | null {
    if (text.trim() === "") {
      return `${props.label} is required.`;
    }

    const value = Number(text);

    if (!Number.isFinite(value)) {
      return `${props.label} must be a number.`;
    }

    if (props.rule === "positive" && value <= 0) {
      return `${props.label} must be more than 0.`;
    }

    if (props.rule === "nonnegative" && value < 0) {
      return `${props.label} can't be negative.`;
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
        aria-describedby={describedBy === "" ? undefined : describedBy}
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

          // The learner has found the setting, so the guide is done.
          if (guide !== null) {
            endGuide();
          }
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
      {/* Rendered at the page level so no panel edge can cut it off. */}
      {guide !== null && guidePosition !== null && createPortal(
        <span
          id={guideId}
          className="field-guide"
          role="status"
          style={{ left: guidePosition.left, top: guidePosition.top, "--arrow-offset": `${guidePosition.arrowOffset}px` } as CSSProperties}
          onAnimationEnd={endGuide}
        >
          {guide}
        </span>,
        document.body,
      )}
    </label>
  );
}
