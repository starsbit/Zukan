export function commaSeparatedPasteValues(event: ClipboardEvent): string[] | null {
  const text = event.clipboardData?.getData('text') ?? '';
  if (!text.includes(',')) {
    return null;
  }

  return text
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}
