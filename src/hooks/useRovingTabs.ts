import type { KeyboardEvent } from "react";

/**
 * Keyboard support for a `role="tablist"`: roving tabindex (the selected tab is the one Tab stop) plus
 * ArrowLeft/Right/Up/Down (wrapping), Home and End, which select AND focus the target tab
 * (automatic activation — these switchers swap content instantly, so selection follows focus).
 * Put `onKeyDown` on the tablist and `tabIndex={tabIndexFor(key)}` on each `role="tab"` button.
 */
export function useRovingTabs<T extends string>(keys: readonly T[], value: T, onChange: (key: T) => void) {
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const i = keys.indexOf(value);
    const last = keys.length - 1;
    let next = i;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = i >= last ? 0 : i + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = i <= 0 ? last : i - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else return;
    e.preventDefault();
    onChange(keys[next]);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };
  return { onKeyDown, tabIndexFor: (key: T): 0 | -1 => (key === value ? 0 : -1) };
}
