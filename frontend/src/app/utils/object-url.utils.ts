export function createObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

export function revokeObjectUrl(url: string | null | undefined): null {
  if (!url) {
    return null;
  }

  URL.revokeObjectURL(url);
  return null;
}

export function revokeObjectUrls(urls: string[]): string[] {
  for (const url of urls) {
    URL.revokeObjectURL(url);
  }

  return [];
}
