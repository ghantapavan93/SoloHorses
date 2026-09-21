/**
 * Only in-app paths may be used as a post-login destination; anything else falls back to the
 * Day Sheet. A query may ride along (`?focus=INV-26-0012`, `?ask=Why%20…`) as long as it is
 * percent-encoded; a scheme, a host or a second slash at the front never passes.
 */
export function safeNext(value: FormDataEntryValue | string | null | undefined): string {
  return typeof value === 'string' &&
    /^\/[a-z0-9/_-]*(\?[a-z0-9=&%._+-]*)?(#[a-z0-9_-]*)?$/i.test(value) &&
    !value.startsWith('//')
    ? value
    : '/today';
}
