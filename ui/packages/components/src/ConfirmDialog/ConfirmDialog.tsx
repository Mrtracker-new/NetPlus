import {
  forwardRef,
  memo,
  useId,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Button } from "../Button";
import { cn } from "../utils/cn";

export type ConfirmDialogInitialFocus = "confirm" | "cancel";

export interface ConfirmDialogProps
  extends Omit<ComponentPropsWithoutRef<"dialog">, "open" | "title"> {
  open: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  initialFocus?: ConfirmDialogInitialFocus;
  dismissOnBackdrop?: boolean;
  footer?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog = memo(
  forwardRef<HTMLDialogElement, ConfirmDialogProps>(function ConfirmDialog(
    {
      open,
      title,
      message,
      confirmLabel = "Confirm",
      cancelLabel = "Cancel",
      destructive,
      busy,
      initialFocus,
      dismissOnBackdrop = false,
      footer,
      onConfirm,
      onCancel,
      className,
      onClick,
      ...props
    },
    ref
  ) {
    const internalRef = useRef<HTMLDialogElement | null>(null);
    const previousFocus = useRef<HTMLElement | null>(null);
    const titleId = useId();
    const messageId = useId();

    useImperativeHandle(ref, () => internalRef.current!);

    // Synchronize open state with native showModal() / close()
    useEffect(() => {
      const el = internalRef.current;
      if (!el) return;
      try {
        if (open && !el.open) {
          previousFocus.current = document.activeElement as HTMLElement | null;
          el.showModal();
        } else if (!open && el.open) {
          el.close();
        }
      } catch {
        // Protect against double-invoked effects in StrictMode
      }
    }, [open]);

    const shouldFocusCancel = initialFocus
      ? initialFocus === "cancel"
      : Boolean(destructive);

    const defaultFooter = (
      <>
        <Button
          disabled={busy}
          autoFocus={shouldFocusCancel}
          onClick={onCancel}
        >
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          busy={busy}
          disabled={busy}
          autoFocus={!shouldFocusCancel}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </>
    );

    return (
      <dialog
        {...props}
        ref={internalRef}
        className={cn("np-dialog", className)}
        role={destructive ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onCancel={(e) => {
          if (busy) {
            e.preventDefault();
            return;
          }
          e.preventDefault();
          onCancel();
        }}
        onClose={() => {
          if (previousFocus.current?.isConnected) {
            previousFocus.current.focus();
          }
        }}
        onClick={(e) => {
          onClick?.(e);
          if (busy || !dismissOnBackdrop) return;
          if (e.target === e.currentTarget) {
            onCancel();
          }
        }}
      >
        <h3 id={titleId} className="np-dialog__title">
          {title}
        </h3>
        <div id={messageId} className="np-dialog__message">
          {message}
        </div>
        <div className="np-dialog__actions">
          {footer ?? defaultFooter}
        </div>
      </dialog>
    );
  })
);

ConfirmDialog.displayName = "ConfirmDialog";
