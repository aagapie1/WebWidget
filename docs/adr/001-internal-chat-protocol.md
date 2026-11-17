# ADR 001 — Internal chat protocol between gateway and widget

Status: accepted (E1) · 2026-11-17

## Context

Dify streaming events differ between app types (`message` for chat apps, `agent_message` +
`agent_thought` for Agents Beta, `workflow_*` for chatflows) and change between Dify versions.
CLAUDE.md rule 10: the widget consumes only an internal format.

## Decision

`POST /api/chat` answers with `text/event-stream`. Each message is one `data:` line with a JSON
event validated by `gateway/src/protocol` (Zod):

| `type`    | Fields                                            | When                                |
| --------- | ------------------------------------------------- | ----------------------------------- |
| `start`   | `conversationId`, `messageId`, `taskId`, `author` | once, before the first content      |
| `delta`   | `text`                                            | each answer chunk                   |
| `replace` | `text`                                            | Dify moderation replaced the answer |
| `end`     | `conversationId`, `messageId`, `citations[]`      | last event on success               |
| `error`   | `error: { code, message, retryable }`             | last event on failure               |

- `author` is present from E1 (`assistant`; `operator`/`system` reserved for E10).
- `citations` come from `message_end.metadata.retriever_resources`, one per document, ordered by
  `position`, with a snippet of at most 280 characters.
- `error.message` is already localized (request `locale`, tenant `texts` override defaults). Dify
  error details never reach the browser.
- Dify `ping` becomes an SSE comment (`: ping`) so proxies keep the connection open.
- Errors detected before streaming starts (validation, unknown tenant, Dify HTTP error) are sent
  as JSON `{ error: {...} }` with the matching HTTP status; once the stream started, as an
  `error` event.
- `agent_thought`, `message_file`, `tts_*` and `workflow_*` are ignored in E1.

The protocol lives in `gateway/src/protocol` (no Node imports) and is exported as
`gateway/protocol` for the widget, instead of a third workspace package.

## Consequences

- Supporting another Dify app type or version changes only `gateway/src/dify/`.
- The widget gets Zod for runtime validation (it needs it anyway for `postMessage`, rule 3).
