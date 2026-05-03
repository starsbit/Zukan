/**
 * Wraps a Blob in an object URL and calls the consumer with it.
 * The URL is always revoked after the consumer returns, even on error.
 */
export function withObjectUrl<T>(blob: Blob, fn: (url: string) => T): T {
  const url = URL.createObjectURL(blob);
  try {
    return fn(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Cache mapping arbitrary keys to object URLs.
 * Revokes old URLs on replacement and on clear/delete to prevent memory leaks.
 */
export class BlobUrlCache {
  private readonly cache = new Map<string, string>();

  constructor(private readonly maxEntries = 300) {}

  get(key: string): string | undefined {
    return this.cache.get(key);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  set(key: string, blob: Blob): string {
    const existing = this.cache.get(key);
    if (existing) {
      URL.revokeObjectURL(existing);
      this.cache.delete(key);
    }
    const url = URL.createObjectURL(blob);
    this.cache.set(key, url);
    this.evictOverflow();
    return url;
  }

  delete(key: string): void {
    const url = this.cache.get(key);
    if (url) URL.revokeObjectURL(url);
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.forEach(url => URL.revokeObjectURL(url));
    this.cache.clear();
  }

  private evictOverflow(): void {
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.entries().next().value as [string, string] | undefined;
      if (!oldest) {
        return;
      }
      const [key, url] = oldest;
      URL.revokeObjectURL(url);
      this.cache.delete(key);
    }
  }
}
