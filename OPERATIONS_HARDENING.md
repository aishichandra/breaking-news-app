# Hardened collector and review app operations

## Active code

Collector entry points are `v2/run_pipeline.py`, `v2/run_answer_worker.py`, and `v2/run_dashboard.py`. Install `v2/requirements.lock` into `.venv-v2` and use `.venv-v2/bin/python`. The dashboard launcher prefers that interpreter when present. The shared notebook interpreter is not a supported production dependency lock.

The app separates article ingestion, answer review, source dates, article summary/detail reads, authentication and audit logging into `api/` modules. The dashboard uses cursor-paginated summaries (12 articles per page), loads a question's answer bodies only when expanded, and loads study citation metadata in pages. `/api/articles` remains a compatibility endpoint; it is no longer polled by the dashboard or answer delivery worker. It is built on demand, rather than on startup or every write.

## Individual accounts

Set `AUTH_USERS_JSON` on the app to an array of `{username, role, password_hash}` records. Roles: `admin`, `reviewer`, `viewer`, `collector`. Generate each scrypt hash with `node tools/hash-password.mjs`, supplying the password over stdin, never as a command argument. Use unique random passwords of at least 16 characters. Provision credentials through your approved password manager. No real user passwords are included in this repository.

With named accounts enabled, the existing `AUTH_USER`/`AUTH_PASSWORD` credential becomes collection-only. Keep it until the collector has its own account. A named account must not reuse the legacy username. Configure at least one named administrator before enabling this setting. Local development without credentials stays loopback-only. Production refuses to start without authentication.

Review changes write an intent record before execution and an outcome record after response completion to `review_audit`. An intent without an outcome is explicitly indeterminate after a crash and needs investigation; it is not proof a change succeeded. The app exposes no audit edit/delete route. For storage-enforced immutability, an Atlas administrator must give the application insert/find access only on `review_audit`; the current broad database credential does not establish immutability against a database administrator.

## Backups and restore drills

App tools:

- `node tools/backup-database.mjs /approved/location/snapshot.enc`
- `node tools/restore-drill.mjs /approved/location/snapshot.enc`
- `node tools/check-data-integrity.mjs` (read-only historical duplicate/orphan report)

Provide `MONGODB_URI`, `MONGODB_DB`, and a separately stored 32-byte base64 `BACKUP_KEY` through secure environment configuration. Backups use Mongo snapshot reads, EJSON (including dates/ObjectIds/binary), gzip and AES-256-GCM. Output uses mode 0600, incomplete output is removed, and existing destination files are never overwritten. Do not change database schemas/indexes during a logical backup. Snapshot support is required; failure does not silently produce an inconsistent backup.

Restore drills authenticate the entire archive before writing, create a random `bn_restore_drill_*` database, recreate collections/indexes, compare every restored document, and remove only that scratch database. They never target the live database. The drill currently loads the archive in memory; large archives require sufficient RAM. Backup keys must be recoverable independently from the host or the archive is unusable.

An encrypted fixture backup and real Atlas restore drill passed on September 28, 2026, including an index and binary screenshot data. This is not verification of Atlas's managed backup retention. A backup destination, key custodian, schedule and retention policy still need configuration. No recurring production backup has been claimed or enabled without those choices.

## Deletion and identity

Deleting an article marks its canonical URL row with `deleted_at`, clears retry queues, and excludes it and its answers from the UI/export. Evidence remains stored. A stale collection upload receives HTTP 410 and is discarded without scheduling a new run or Slack review notification. This prevents a deleted story from being recreated by an old outbox. Administrative restoration requires an explicit database operation; there is no public restore route.

Question IDs travel through manual/automatic retry payloads. Supplied identity and question text must agree. Concurrent append/edit conflicts return HTTP 409 rather than writing duplicate question slots. Stable run timestamps and deterministic answer IDs allow replay without overwriting grades. No historical evidence was rewritten. The read-only production audit found zero duplicate `(question_id, run_id, platform)` groups and zero orphaned answers.

## Browser migration and network controls

Set `ANSWER_BROWSER_PROFILE` to a new dedicated directory, `ANSWER_BROWSER_APP=Google Chrome`, and `ANSWER_BROWSER_PORT=9224`. Sign into the four providers in that profile and install this repository's `tampermonkey_single_*.txt` scripts. Do not copy your personal browser's cookies/profile. User scripts now report question/platform identity. Metadata is still not proof of a provider's rendered prompt; end-to-end capture assertions must be verified against each provider's live DOM when completing migration.

Existing reachable Arc sessions remain supported temporarily. Automatic quit/relaunch of personal Arc is disabled: an unavailable legacy browser produces a clear configuration error. Dedicated browser CDP binds to loopback; wildcard remote origins were removed. Profile activation needs manual sign-in and extension setup; source changes alone do not migrate sessions.

The plain-HTTP article fallback validates every redirect, rejects non-public DNS answers, pins the checked IP while preserving TLS hostname validation, limits ports, redirect count and body size. Browser page requests are checked too, but Chromium DNS rebinding, service-worker interception and non-HTTP browser traffic require an OS/proxy egress policy for a complete boundary. Do not describe application checks as an infrastructure firewall.

## Legacy inventory

Root v1 scripts/notebooks and `v2_legacy_flat_backup` are historical, not active collector entry points. App judge files/components are inactive and unregistered. They remain at existing paths because external notebooks and installed userscripts can depend on those paths; physically moving them requires that dependency inventory. New behavior belongs in v2 and the tested app modules, not those historical files.

## Verified rollout

App deployment `1323fdbe-e6f8-4071-ac7a-d8d0d63fd9cc` is live. The local review launcher and backend were restarted against their isolated snapshot. The answer worker (PID 74348), control dashboard (PID 74351), and feed intake (PID 74513) now run from `.venv-v2`. Intake was paused and both loops confirmed sleeping before restart; queue/seen state was retained, the original unpaused setting restored, and both feed loops subsequently completed successful ticks. The answer worker is idle with no reported error. Future intake shutdowns drain in-flight work using SIGTERM/SIGINT handling.

Manual account provisioning, managed backup retention/storage and dedicated answer-browser sign-in are not activated. The existing reachable Arc session is still the browser capture session. No historical migration was needed for duplicate identities/orphans. No files were relocated out from under historical notebooks.
