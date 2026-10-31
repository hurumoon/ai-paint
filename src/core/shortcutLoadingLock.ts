export function blockShortcutEventWhileFileLoading(
  event: Pick<KeyboardEvent, "preventDefault" | "stopImmediatePropagation">,
  isFileLoading: boolean,
): boolean {
  if (!isFileLoading) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}
