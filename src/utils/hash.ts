/**
 * Simple deterministic string hash — same input always produces same output.
 * Used for player-count generation from date strings.
 */
export function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}
