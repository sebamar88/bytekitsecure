export function reportSessionToken(
  fragment: string,
  saved: string | null,
): string {
  const candidate = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (/^[a-f0-9]{64}$/.test(candidate)) return candidate;
  return saved && /^[a-f0-9]{64}$/.test(saved) ? saved : "";
}
