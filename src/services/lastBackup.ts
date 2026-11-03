/**
 * lastBackup.ts — "Last backup: 2 hours ago", and NEVER a timestamp we invented.
 *
 * WHY THIS MODULE EXISTS (Settings pass, change C). The app already records when
 * a sync pass finished: `services/cloudSync` writes an ISO string to
 * AsyncStorage under `@notesnap/cloudSync/lastSynced/<provider>` at the end of
 * every successful `syncCloud()`, and `getLastSyncedAt(provider)` reads it back.
 * The value was visible on the Cloud Sync screen and nowhere else, so Settings
 * could say "Back up scores and takes" without ever telling the truth about
 * whether anything had ever been backed up.
 *
 * THE RULE: this module formats the STORED value. It never guesses one. A
 * missing key, an unreadable value and a clock that disagrees all resolve to the
 * same honest answer — "No backup yet" — rather than to a plausible-looking
 * date. The only time the user sees a relative time is when a real ISO string
 * for a real sync pass is on the device.
 *
 * PURE: no react, no react-native, no storage, no `Date.now()` at module scope —
 * the caller passes `nowMs`, so the formatting is testable and deterministic
 * (tier1-compiled; asserted by scripts/v48SettingsPass.test.ts).
 */

/** The Cloud Sync & Storage row's copy. One owner, so the screen cannot drift. */
export const BACKUP_ROW_TITLE = 'Last backup';
export const BACKUP_ROW_SUB = 'The last time your library reached the cloud';

/** What the row says when there is no stored timestamp — the honest empty state. */
export const NO_BACKUP_LABEL = 'No backup yet';

/** The action row beside it. */
export const SYNC_ROW_TITLE = 'Sync now';
export const SYNC_ROW_SUB_IDLE = 'Back up and pull down your scores and takes';

/**
 * The sub line when there is nothing to sync to. It is a statement, not an
 * error: the row explains where a provider is connected instead of failing.
 */
export const SYNC_ROW_SUB_NO_PROVIDER = 'Connect Google Drive or Dropbox in Cloud sync first';

/** Shown while a pass is running. */
export const SYNC_ROW_SUB_BUSY = 'Syncing…';

/** The notice after a pass that did nothing because there was no provider. */
export const SYNC_NOTICE_NO_PROVIDER =
  'Nothing to sync yet — open Cloud sync and connect Google Drive or Dropbox.';

/** The notice after a pass that completed. */
export const SYNC_NOTICE_DONE = 'Backup finished.';

/** Month names, so the label is identical on every device and locale. */
const MONTHS: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** A stored value parsed to milliseconds, or null when it is not a real time. */
export function parseStoredTime(iso: string | null | undefined): number | null {
  if (typeof iso !== 'string') return null;
  const trimmed = iso.trim();
  if (trimmed.length === 0) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The most recent REAL timestamp among the providers' stored values — the one
 * the row reports. A null/blank/unparseable entry never wins, and an empty list
 * stays empty (no "now" fallback, ever).
 */
export function mostRecentBackup(entries: readonly (string | null | undefined)[]): string | null {
  let best: { iso: string; ms: number } | null = null;
  for (const entry of entries) {
    const ms = parseStoredTime(entry);
    if (ms === null || typeof entry !== 'string') continue;
    if (best === null || ms > best.ms) best = { iso: entry.trim(), ms };
  }
  return best === null ? null : best.iso;
}

/** "on 3 Nov 2026" — the exact stored day, used once the gap is over a week. */
export function backupDateLabel(ms: number): string {
  const at = new Date(ms);
  const day = at.getDate();
  const month = MONTHS[at.getMonth()] ?? '';
  const year = at.getFullYear();
  return `on ${day} ${month} ${year}`;
}

/**
 * THE ROW'S VALUE. `nowMs` is the caller's clock, so this function is pure.
 *
 *   0–44 s     → "Just now"
 *   45–89 s    → "1 minute ago"        (never "0 minutes ago")
 *   90 s–59 m  → "N minutes ago"
 *   60–119 m   → "1 hour ago"
 *   2–23 h     → "N hours ago"
 *   24–47 h    → "Yesterday"
 *   2–6 d      → "N days ago"
 *   7 d +      → "on 3 Nov 2026"       (the exact stored day, not "3 weeks ago")
 *
 * Anything that is not a parseable time — including a future timestamp from a
 * clock that disagrees with the server — resolves honestly: a future time is
 * "Just now" (the sync did happen), and an unreadable one is "No backup yet".
 */
export function relativeBackupLabel(iso: string | null | undefined, nowMs: number): string {
  const ms = parseStoredTime(iso);
  if (ms === null) return NO_BACKUP_LABEL;
  const delta = nowMs - ms;
  if (!Number.isFinite(delta)) return NO_BACKUP_LABEL;
  // A stored time in the future is a clock disagreement, not a fiction to print.
  if (delta < 45 * 1000) return 'Just now';

  const minutes = Math.floor(delta / (60 * 1000));
  if (minutes < 1) return 'Just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;

  return backupDateLabel(ms);
}

/**
 * The Sync-now row's sub line: busy, or no provider to sync to, or the plain
 * promise. A row never claims it can sync when nothing is connected.
 */
export function syncNowRowSub(anyProviderConnected: boolean, busy: boolean): string {
  if (busy) return SYNC_ROW_SUB_BUSY;
  if (!anyProviderConnected) return SYNC_ROW_SUB_NO_PROVIDER;
  return SYNC_ROW_SUB_IDLE;
}
