export function formatDisplayValue(value: string | null | undefined): string {
  const normalized = value
    ?.trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

  if (!normalized) {
    return '';
  }

  return normalized.replace(/\b([A-Za-z])([A-Za-z']*)/g, (match, first, rest) => {
    if (match !== match.toLowerCase() && match !== match.toUpperCase()) {
      return `${first.toUpperCase()}${rest}`;
    }

    return `${first.toUpperCase()}${rest.toLowerCase()}`;
  });
}
