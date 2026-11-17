# ADR 005 — Conversations, history, feedback and citations (E3)

Status: accepted (E3) · 2026-11-17

## Answers keep generating when the visitor leaves

- The gateway no longer stops the Dify task when the browser disconnects (reverts the E2
  behaviour). Verified on the pilot: after the client closed the stream at 1.5 s, Dify finished
  and stored the full answer. This is what makes "answers received while the visitor was away"
  visible in the history.
- The explicit "Oprește răspunsul" button still stops the task (`/api/chat/stop`).
- Cost: GPU time for answers that may never be read. Bounded later by rate limiting (E5).

## History and conversations

- The browser never stores conversations (no `localStorage`). On open, the iframe asks the
  gateway for the visitor's conversations (`GET /api/conversations`) and resumes the most
  recent one (`GET /api/conversations/:id/messages`). Dify isolates them by `user` (another
  `user` gets 404 — verified on the pilot).
- Dify history is normalized in `gateway/src/dify/` into the internal message shape
  (`author`, text, citations, feedback, timestamp); the widget never sees Dify objects.
- **Close conversation** = optional feedback form, then a new conversation. The closed one stays
  in the list and can be resumed. No server-side "closed" state; the conversation `status`
  field stays reserved for the human handover (E10).
- **Delete conversation** (`DELETE /conversations/{id}` in Dify), with a confirmation, from the
  conversation list. It also deletes the stored closing feedback of that conversation.
- **Title**: after the first answer of a new conversation the gateway renames it to the first
  ~50 characters of the question (`POST /conversations/{id}/name`, `auto_generate: false`). No
  model call (SPEC §4).
- **Visitor cookie lifetime** is configurable per tenant (`visitorCookieDays`, default 30).

## Closing feedback: stored in Redis, not in Dify

Dify has feedback only per message (`rating` + optional `content`). Putting the conversation
feedback on the last assistant message was considered and rejected:

- the retention period cannot be enforced there (it lives until the conversation is deleted);
- it would overwrite the 👍/👎 the visitor gave to that message.

Decision:

- The closing feedback (`rating`, optional `comment`) is stored by the gateway in **Redis**,
  key `feedback:{tenant}:{conversationId}`, with a TTL = the tenant's
  `feedback.retentionDays` (default 90). Redis expiry enforces retention; nothing to clean up.
- The **comment is masked before it is stored**: CNP, phone numbers and e-mail addresses are
  replaced (`gateway/src/privacy/mask.ts`, the same function the logs will use, rule 7).
- Redis is reached through `REDIS_URL`. Without it, in development and tests only, an in-memory
  store with the same interface is used and a warning is logged; with `NODE_ENV=production`
  the gateway refuses to start without Redis. CI runs the store tests against a real Redis.
- Reading the stored feedback (export / admin) is out of scope for E3 (backlog).
- Per-message 👍/👎 still goes to Dify (`POST /messages/{id}/feedbacks`), where operators already
  see it.

## Citations

- Grouped per document, no duplicates (`message_end.metadata.retriever_resources` and the
  history's `retriever_resources`).
- Display name: the tenant's mapping `citations.documentTitles` (file name → friendly title),
  otherwise the file name without extension.
- Snippets are shown only when the tenant enables `citations.showSnippets` (default off: they
  contain technical markers).

## Suggested questions

- Only the initial ones from Dify `/parameters` (no model call). Questions after each answer
  would add a model call per answer (SPEC §6: no extra model calls from the widget); not used.

## Request origin

- `/api/*` rejects a request whose `Sec-Fetch-Site` header is present and not `same-origin`.
  Requests without the header (older browsers, non-browser clients) are not rejected by this
  check.
- This is defence in depth only. The main protections remain the signed visitor cookie (a
  visitor only reaches its own Dify conversations) and rate limiting / anti-bot (E5).
