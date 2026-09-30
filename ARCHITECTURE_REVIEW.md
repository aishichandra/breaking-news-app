# Code and data review — September 28, 2026

## Scope

Reviewed the active `v2` collector, browser integration, scheduler/outboxes, local control dashboard, and sibling `breaking_news_app` API and Svelte UI. Inspected the legacy v1 and backup locations to establish that they are not active entry points; they have not been modernized. This is a source review with regression/integration checks, not an independent penetration test or a guarantee that every defect is eliminated.

## Boundaries to maintain

- `v2/orchestrator.py`: feed intake and article/question generation.
- `v2/answer_jobs.py`: durable SQLite jobs, claims, checkpoints, priorities, recovery.
- `v2/priority_worker.py`: scheduling and independently retried delivery/notification/date outboxes.
- `v2/question_runner.py`: isolated execution of one question; browser and API adapters produce evidence, not grades.
- App `api/normalize.js` and `api/ingestion.js`: validate captured evidence and resolve question/run identity before writes.
- App `api/security.js`: deployed authentication requirement and browser-origin protections.
- App `web/src/lib/channel-runs.js`: presentation windows only. Original answer/run IDs and exact capture timestamps remain authoritative.
- App `active-dataset.mjs`: excludes rejected questions from the review dataset/export without erasing evidence.

## Fixed in this review

1. Explicit question text no longer falls back to an unrelated question's array position. Flagged questions are skipped during ingestion.
2. A supplied collection timestamp plus article ID gives replayed ingestion a stable run identity. Answers have deterministic IDs and use insert-only upserts, preserving human corrections/grades under retries. A concurrent first article insert recovers from the canonical-URL uniqueness conflict.
3. Production cannot start without configured authentication. Cross-origin browser writes are rejected; local unauthenticated servers bind to loopback and validate host/origin. Sensitive responses default to no-store and nosniff; framing is denied.
4. Shared URL checking prevents executable/credential-bearing links from being ingested or rendered. PNG uploads require PNG bytes. Normalization validates types, timestamps and bounded lists before article ingestion.
5. Model and search metadata now survive collector → API normalization → stored answers. Historical missing metadata is not invented.
6. HTTP shutdown drains active requests before disconnecting the database. Concurrent edits cannot overwrite the original captured answer or a newly saved citation list unnoticed.
7. Local rerun producers and consumers share a lock; JSON state is atomically replaced and fsynced. Corrupt retry/rerun queues are retained instead of silently replaced with empty state. SQLite enables foreign-key enforcement.
8. Failed-answer retries consult current question flags/text through a narrow `/api/collection-targets` endpoint. Known rejected/edited questions are not re-enqueued. First collections with no saved app record can still recover.
9. Removed the collapsed view's stale initial-grade snapshot. Both channels retain their original evidence identity when grouped for display.
10. Compatible `qs` and `devalue` updates resolved the two npm advisories found. Deployment builds use `npm ci` and lockfiles. Runtime databases, captures and environment variants are excluded from source/deployment inputs.

## Validation

- JavaScript regression suite, Python unit suite, Python compilation and Svelte production build.
- Real HTTP/API/Mongo integration against a newly created temporary database: authentication, hostile-origin rejection, invalid-input rejection before writes, concurrent replay deduplication, preserved human grade/model fields, flagged subset isolation, export exclusions and question-scoped retries. The temporary database was removed; production records were not changed by these tests.
- npm advisory checks for API and web dependency trees: zero reported advisories after compatible updates. This is not a Python dependency audit.
- Credential-pattern scan of source/config examples found no confirmed embedded credentials; a Bloomberg article slug matched the generic key pattern. Environment files and runtime evidence are intentionally excluded from this statement.

## Follow-up implementation — September 28, 2026

Implemented article pagination/lazy question answers and paginated study metadata; extracted ingestion, answer review and source-date routes; added question append compare-and-swap, stable worker question IDs and durable deletion tombstones; removed full-history delivery reconciliation; added named account roles and append-only review intents/outcomes; added encrypted snapshot/restore tooling; checked production for duplicate identities and orphans (both zero); hardened public HTTP redirects/DNS and browser launch behavior; created an isolated patched Python runtime.

Validation: 41 JavaScript tests and 33 Python tests pass; Svelte production build passes; real isolated Mongo/API integration passes, including concurrent additions, lazy reads and deleted-article replays; encrypted Atlas backup/restore fixture passes with binary data and indexes. The dedicated Python requirements audit reports zero known vulnerabilities and `pip check` passes. No new paid model calls or Slack test messages were triggered.

Production app deployment `1323fdbe-e6f8-4071-ac7a-d8d0d63fd9cc` succeeded. Authenticated summary response was approximately 602 ms in a smoke check (a single measurement, not a latency guarantee), and unauthenticated reads returned 401. The worker, control dashboard and intake were safely restarted on `.venv-v2`, and both feed loops and the worker heartbeat were verified. Local review has been restarted and visually checked: collapsed matrix chips and lazy-loaded answers/citations render correctly.

## Configuration and remaining limits

Individual account provisioning, restricted Mongo audit permissions, backup storage/key ownership/retention, and dedicated-browser sign-in remain external setup steps. Browser-level network checks are not a substitute for an OS/proxy egress boundary. Provider DOM prompt verification and physical relocation of legacy notebook/script dependencies remain documented limitations. Historical semantic mis-association cannot be inferred from duplicate/orphan counts and was not automatically rewritten.

See `OPERATIONS_HARDENING.md` for exact setup, active entry points, restore procedure and rollout status. No recurring production backups or personal-browser migration are represented as completed.
