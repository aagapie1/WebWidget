# ADR 003 — Dify contract as observed on the pilot instance

Status: accepted (E1) · 2026-11-17

Verified with `curl` on the pilot instance (SSH tunnel, `http://localhost:8080/v1`) and then
through the gateway.

## Observations

- **App type:** `GET /v1/info` → `mode: "advanced-chat"` (Chatflow), not a basic chat or Agents
  Beta app as SPEC §4 assumed. `user_input_form` is empty, so `inputs: {}` is valid.
- **Stream order:** `event: ping`, `workflow_started`, `node_started`/`node_finished` per node,
  `message` chunks (only after the draft-verification nodes finish), `message_end`,
  `workflow_finished`. The text is in `message.answer`, exactly as for chat apps.
- **`message_end` comes before `workflow_finished`.** The gateway stops reading at
  `message_end` and closes the upstream connection; the workflow has already produced its answer.
- **`auto_generate_name: false` is respected:** the conversation name is the truncated first
  question (`"Ce cursuri organizea…"`), not a model-generated title. Absence of `generate_name`
  spans must still be confirmed in Phoenix (SPEC §8).
- **Errors:** missing conversation → HTTP 404 `{"code":"not_found"}`; invalid key → 401
  `{"code":"unauthorized"}`. Both match `mapDifyError`.
- **Citations:** `GET /v1/parameters` → `retriever_resource.enabled: false`, and
  `message_end.metadata.retriever_resources` is `[]`. The gateway already forwards citations,
  but they will only appear once "Citations and Attributions" is enabled in the Dify app (needed
  for the E3 acceptance criterion).
- Timing: first byte ≈ 40 ms (`ping`), full answer ≈ 3–5 s.

## Consequences

- No change to the normalizer: `workflow_*` and `node_*` are already ignored as unknown events.
- Fixture `gateway/test/fixtures/dify-chatflow-pilot.sse` is derived from a pilot capture with all
  ids, node titles, inputs/outputs and answer text replaced.
- Gotcha for manual tests from Git Bash on Windows: non-ASCII text passed inline with `curl -d`
  is not sent as UTF-8 and Dify answers `400 bad_request`. Use `--data-binary @file.json`.
