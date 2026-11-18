import { useEffect, useRef } from "react";
import { FlaskConical } from "lucide-react";

// A site-styled confirmation, shown only when opening a setup would discard work in the lab.
export function ReplaceSceneDialog({ title, onConfirm, onCancel }: {
  readonly title: string;
  onConfirm(): void;
  onCancel(): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // The browser's modal dialog traps focus and closes on Escape; start on the safe choice.
  useEffect(() => {
    const dialog = dialogRef.current;

    if (dialog !== null && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    }

    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="site-dialog"
      aria-labelledby="replace-scene-title"
      aria-describedby="replace-scene-body"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        // A click on the dimmed backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="site-dialog-icon"><FlaskConical size={20} /></div>
      <h2 id="replace-scene-title">Replace the scene in the lab?</h2>
      <p id="replace-scene-body">
        Opening <strong>{title}</strong> replaces the scene you are working on. Changes you have made, including values you typed but did not apply, will be lost.
      </p>
      <div className="site-dialog-actions">
        <button ref={cancelRef} className="tool-btn dialog-secondary" type="button" onClick={onCancel}>Keep my scene</button>
        <button className="tool-btn dialog-primary" type="button" onClick={onConfirm}>Replace scene</button>
      </div>
    </dialog>
  );
}
