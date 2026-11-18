/**
 * postMessage protocol between loader.js (host page) and the chat iframe (ADR 004).
 * Receivers must check `event.origin` and `event.source`, then validate with these schemas.
 */
import * as z from 'zod/mini';

const SOURCE = 'chat-widget';
const VERSION = 1;

const envelope = { source: z.literal(SOURCE), v: z.literal(VERSION) };

/** iframe → loader */
export const appMessageSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('ready') }),
  /** Minimize button, X button or Escape: hide the window, keep the conversation. */
  z.object({ ...envelope, type: z.literal('hide') }),
]);
export type AppMessage = z.infer<typeof appMessageSchema>;

/** loader → iframe */
export const loaderMessageSchema = z.discriminatedUnion('type', [
  /** The window became visible: focus the composer. */
  z.object({ ...envelope, type: z.literal('shown') }),
]);
export type LoaderMessage = z.infer<typeof loaderMessageSchema>;

type Payload<T> = T extends unknown ? Omit<T, 'source' | 'v'> : never;

export function message<T extends AppMessage | LoaderMessage | PreviewControl>(
  payload: Payload<T>,
): T {
  return { source: SOURCE, v: VERSION, ...payload } as T;
}

/** What the admin preview shows: the closed launcher, the proactive bubble or the open window. */
export const PREVIEW_STATES = ['launcher', 'proactive', 'window'] as const;
export type PreviewState = (typeof PREVIEW_STATES)[number];

/**
 * Admin preview page → loader (ADR 008): the admin interface, served by the gateway itself,
 * shows the state matching the section being edited. Accepted only by a loader started in
 * preview mode, from its parent window on the gateway origin.
 */
export const previewControlSchema = z.object({
  ...envelope,
  type: z.literal('preview'),
  show: z.enum(PREVIEW_STATES),
});
export type PreviewControl = z.infer<typeof previewControlSchema>;
