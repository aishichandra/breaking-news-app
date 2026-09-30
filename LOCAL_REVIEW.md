# Local study review

The local app adds Study comparisons (accuracy, original-source citation rates,
and a citation library) plus focused-reader and decision-tree question layouts.
No Railway deployment is required or performed.

Start from `api/` with Node 22:

```sh
node --env-file=.env local-review.mjs
```

Open http://127.0.0.1:3000. The launcher reads the configured source database and
creates `breaking_news_local_review`, a separate database on the same MongoDB
cluster. It copies articles, answers, source dates and screenshots once, then
reuses that snapshot. It never writes to the source database, and does not copy
production re-ask queues. The local server binds only to localhost. Grading,
confidence, citation dates and page classifications in this instance change only
the snapshot; new production answers do not stream into it. The page displays the
snapshot timestamp. Use this launcher, not a bare `server.js`, for local review.

Citation types are stored per normalized page URL in `citation_types`; the local
JSON export includes them. These endpoints are enabled only in local-review mode.

Comparison definitions:

- Exclude flagged questions and records without captured answer text.
- Keep the latest response for each question/platform/time interval to prevent
  retries from receiving extra weight.
- Use actual per-response timestamps relative to publication: 0–30m, 30m–1h,
  1–5h, 5–24h, and 24h+. Missing or negative ages appear under Unknown time.
- Accuracy means Correct / graded. Partial, Incorrect, Abstained and Speculation
  are not fully correct. Ungraded is excluded, not scored as incorrect.
- Browser/API trends compare original prompts on common questions within each
  interval, pooling captured platform responses. They do not claim identical
  underlying models. Prompt trends match question and API configuration.
- The matched cohort can vary by interval. Expand chart counts to inspect
  denominators. Missing cells are not interpolated in the charts.
- Original-source rates count each response once. Domain rankings also count
  each response once per domain, even if several pages on it were cited.

Checks (from repository root):

```sh
node --test features.test.mjs study.test.mjs
node web/node_modules/vite/bin/vite.js build web
```

Local review caches assembled history in memory and in a private temporary file
keyed to the database and snapshot timestamp. Grade, confidence, note and answer-text
edits update the cache after MongoDB confirms the save. Other data changes invalidate
it and require a fresh history read. Restarts reuse the persisted cache.
