#!/usr/bin/env python3
"""
Import manual extraction CSV (Sheet3 format) into the benchmark app.

    python tools/import_manual_csv.py path/to/Sheet3.csv
    python tools/import_manual_csv.py path/to/Sheet3.csv --dry-run
    python tools/import_manual_csv.py path/to/Sheet3.csv --limit 3

Each row is one article. Platform columns hold JSON arrays keyed by question;
the importer merges them into the platform_answers shape POST /api/articles expects.
"""
import argparse
import ast
import csv
import json
import re
import sys
from datetime import datetime, timezone

import httpx
from dateutil import parser as dateparser

API = "http://localhost:3000"

PLATFORM_COLUMNS = {
    "chatgpt": "chatgpt",
    "claude": "claude",
    "google": "ai overview",
    "perplexity": "perplexity",
}

DATE_IN_URL = re.compile(r"/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})(?=[/-]|$)")


def norm_question(text):
    t = (text or "").strip().lower()
    for ch in "''\u2019\u2018`":
        t = t.replace(ch, "")
    t = re.sub(r"[^\w\s%.$-]", " ", t)
    return " ".join(t.split())


def find_question_index(qtext, questions, by_index):
    key = norm_question(qtext)
    if key in by_index:
        return by_index[key]

    # Truncated or lightly edited question text in a platform column.
    for i, q in enumerate(questions):
        nq = norm_question(q["question"])
        if key.startswith(nq) or nq.startswith(key):
            return i
        if len(key) > 24 and len(nq) > 24 and key[:24] == nq[:24]:
            return i
    return None


def parse_jsonish(raw):
    if not raw or not str(raw).strip():
        return []
    text = str(raw).strip().replace("\u00a0", " ")
    for loader in (json.loads, ast.literal_eval):
        try:
            parsed = loader(text)
            if isinstance(parsed, list):
                return parsed
        except (json.JSONDecodeError, SyntaxError, ValueError):
            continue
    raise ValueError(f"Could not parse array: {text[:120]}…")


def parse_published(raw, url):
    if raw and str(raw).strip():
        text = re.sub(r"^Updated on\s+", "", str(raw).strip(), flags=re.I)
        return dateparser.parse(text)
    match = DATE_IN_URL.search(url or "")
    if match:
        y, m, d = map(int, match.groups())
        return datetime(y, m, d, 12, 0, tzinfo=timezone.utc)
    return None


def platform_payload(item):
    out = {"answer": item.get("answer") or ""}
    if item.get("timestamp"):
        out["timestamp"] = item["timestamp"]
    if item.get("url"):
        out["url"] = item["url"]
    if item.get("citations"):
        out["citations"] = item["citations"]
    if item.get("sources"):
        out["sources"] = item["sources"]
    return out


def build_platform_answers(questions, row):
    by_index = {norm_question(q["question"]): i for i, q in enumerate(questions)}
    entries = {}
    timestamps = []

    for platform, column in PLATFORM_COLUMNS.items():
        try:
            items = parse_jsonish(row.get(column, ""))
        except ValueError as exc:
            raise ValueError(f"{column}: {exc}") from exc

        for item in items:
            qtext = item.get("question") or ""
            idx = find_question_index(qtext, questions, by_index)
            if idx is None:
                print(f"              warn: skipping {platform} answer — question not in this article: {qtext[:70]}…")
                continue

            if idx not in entries:
                entries[idx] = {
                    "question_index": idx,
                    "question": questions[idx]["question"],
                    "timestamp": item.get("timestamp"),
                }

            entries[idx][platform] = platform_payload(item)
            if item.get("timestamp"):
                timestamps.append(item["timestamp"])

    if not entries:
        raise ValueError("No platform answers found")

    run_at = min(dateparser.parse(t) for t in timestamps) if timestamps else None
    return [entries[i] for i in sorted(entries)], run_at


def row_to_payload(row):
    url = (row.get("article url") or "").strip()
    if not url:
        raise ValueError("Missing article url")

    questions = parse_jsonish(row.get("questions", ""))
    if not questions:
        raise ValueError("Missing ground-truth questions")

    platform_answers, run_at = build_platform_answers(questions, row)
    published = parse_published(row.get("time published ", ""), url)

    payload = {
        "url": url,
        "questions": [{"question": q["question"], "answer": q.get("answer") or ""} for q in questions],
        "platform_answers": platform_answers,
    }
    if published:
        payload["published_at"] = published.isoformat()
    if run_at:
        payload["run_at"] = run_at.isoformat()

    return payload


def main():
    ap = argparse.ArgumentParser(description="Import manual extraction CSV into the benchmark app")
    ap.add_argument("csv_path", help="Path to Sheet3-format CSV")
    ap.add_argument("--api", default=API)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-existing", action="store_true", help="Skip URLs already in the app")
    args = ap.parse_args()

    with open(args.csv_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    if args.limit:
        rows = rows[: args.limit]

    existing = set()
    if args.skip_existing:
        with httpx.Client() as client:
            try:
                articles = client.get(f"{args.api}/api/articles", timeout=30).json()
                existing = {a["url"] for a in articles}
            except Exception as exc:
                sys.exit(f"Could not reach API at {args.api}: {exc}")

    ok = skipped = failed = 0

    with httpx.Client() as client:
        for i, row in enumerate(rows, 1):
            url = (row.get("article url") or "").strip()
            label = url[:70] or f"row {i}"

            if args.skip_existing and url in existing:
                print(f"[{i}/{len(rows)}] skip (exists)  {label}")
                skipped += 1
                continue

            try:
                payload = row_to_payload(row)
            except ValueError as exc:
                print(f"[{i}/{len(rows)}] FAIL parse     {label}\n              {exc}")
                failed += 1
                continue

            n_q = len(payload["questions"])
            n_a = len(payload["platform_answers"])
            pub = payload.get("published_at", "—")
            run = payload.get("run_at", "—")

            if args.dry_run:
                print(f"[{i}/{len(rows)}] dry-run       {label}\n"
                      f"              {n_q} questions · {n_a} platform entries · published {pub} · run {run}")
                ok += 1
                continue

            try:
                r = client.post(f"{args.api}/api/articles", json=payload, timeout=60)
                r.raise_for_status()
                body = r.json()
                action = "created" if body.get("created") else "updated"
                print(f"[{i}/{len(rows)}] {action:7}      {label}\n"
                      f"              {body.get('answers_recorded', 0)} answers recorded")
                ok += 1
            except httpx.HTTPStatusError as exc:
                detail = exc.response.text[:200]
                print(f"[{i}/{len(rows)}] FAIL post      {label}\n              {exc.response.status_code} {detail}")
                failed += 1
            except Exception as exc:
                print(f"[{i}/{len(rows)}] FAIL post      {label}\n              {exc}")
                failed += 1

    print(f"\n{ok} ok · {skipped} skipped · {failed} failed")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
