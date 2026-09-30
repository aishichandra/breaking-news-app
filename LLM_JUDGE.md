> Disabled at user request on September 28, 2026. No judge routes or background
> worker are registered, no judge controls render, automatic judging is off,
> and pending work is cancelled. Human grades and captured answers are preserved.
> The implementation below is retained as inactive reference code.

# LLM judging retired

As of September 28, 2026, the app no longer registers judge routes, starts the
judge worker, queues new answers for judging, or displays automated suggestions.
Existing saved judgments remain as historical data; manual grades are preserved.
All new accuracy grading is manual.

## Restored automatic verification (September 28, 2026)

The production app assesses existing and newly captured browser/API responses
with `deepseek/deepseek-v4.1-flash`. Suggestions remain separate from human grades,
including when an answer already has a human grade. Reviewers may request and
accept a suggestion; only administrators may change automatic judging settings.
Acceptance cannot overwrite an existing human grade or accept an assessment of
an outdated answer/reference. Deleted articles and bad questions are ineligible.

OpenRouter key spending-limit errors, rate limits, and provider server errors
retain pending assessments with a five-minute cooldown. Raising/resetting the
key limit allows pending work to resume; the app never raises the limit itself.
Local review snapshots do not initiate paid judge calls. The expected answer
and excerpt remain the supplied evidence; this is a first-pass assessment, not
independent web fact-checking.
