# Neutral demo dataset and scripted agent runs in the browser mock

Codex round 1 (`codex exec review --uncommitted`):

- P2 Stopping a run after tools completed dropped every finished step (including an approved write) because the
  transcript was only saved on success — applied: each completed tool step is saved to the session as it finishes,
  like the backend, so `ai_cancel`'s `done` carries them.

Codex round 2:

- P2 Write routing only matched singular "order" ("Cancel orders 1042 and 1043" fell through to the overview) —
  applied: `orders?`, with a check in `mock.check.ts`.

Codex round 3:

- P2 Stopping mid-answer dropped text the user had already seen — applied: `stop()` saves finished and half-streamed
  text to the session before the cancelled `done` goes out.
