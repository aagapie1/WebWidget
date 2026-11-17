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

export function message<T extends AppMessage | LoaderMessage>(payload: Payload<T>): T {
  return { source: SOURCE, v: VERSION, ...payload } as T;
}
