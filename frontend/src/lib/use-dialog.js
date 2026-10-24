import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const focusableIn = (container) =>
  Array.from(container.querySelectorAll(FOCUSABLE)).filter(
    (element) => element.getAttribute("aria-hidden") !== "true" && element.getClientRects().length > 0,
  );

/**
 * Shared dialog behaviour: Escape closes, initial focus moves inside, focus
 * returns to the opener on close. Modal dialogs (default) also trap Tab and
 * lock body scroll; pass `modal: false` for popovers, which additionally close
 * on an outside press.
 */
export function useDialog({ open = true, onClose, modal = true }) {
  const containerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;
    const container = containerRef.current;
    const opener = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    if (modal) document.body.style.overflow = "hidden";

    if (container && !container.contains(document.activeElement)) {
      const [first] = focusableIn(container);
      if (first) first.focus();
      else {
        if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
        container.focus();
      }
    }

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (!modal || event.key !== "Tab" || !container) return;
      const items = focusableIn(container);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    const onPointerDown = (event) => {
      if (modal || !container || container.contains(event.target)) return;
      if (opener?.contains?.(event.target)) return;
      onCloseRef.current?.();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      if (modal) document.body.style.overflow = previousOverflow;
      if (opener && typeof opener.focus === "function" && document.contains(opener)) opener.focus();
    };
  }, [open, modal]);

  return containerRef;
}
