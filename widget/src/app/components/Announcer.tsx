import type { Announcement } from '../chat/controller.js';

/**
 * Visually hidden live region: each completed answer (or error, stop, new conversation) is
 * announced once. A new keyed node per announcement makes repeated texts announce again.
 */
export function Announcer({ announcement }: { announcement: Announcement }) {
  return (
    <div class="visually-hidden" aria-live="polite" aria-atomic="true">
      {announcement.text && <p key={announcement.id}>{announcement.text}</p>}
    </div>
  );
}
