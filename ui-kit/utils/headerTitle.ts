/* generated from app-platform/ui-kit — edit there and re-sync. */
/** The phone form of a header title: "Mohit's Bingo" → "Bingo" (also with ’). null = show the title as it is. */
export function phoneTitle(title: unknown): string | null {
  if (typeof title !== 'string') return null;
  const m = title.match(/^Mohit[’']s\s+(\S.*)$/);
  return m ? m[1]! : null;
}
