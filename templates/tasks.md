---
title: Tasks
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [meta, tasks]
---

# Task Queue

Central task list for relay agent sessions. Check during orientation for due work.

## Format

Each task line: `- [ ] description | type: recurring | freq: daily | last: YYYY-MM-DD HH:MM`

- **Types**: `recurring` (repeats per frequency) and `one-off` (do once, then delete)
- **Frequencies**: `6h`, `12h`, `daily`, `2d`, `3d`, `weekly`, `monthly`

After completing a task, update its `last:` datetime. For one-off tasks, delete the line.

## Tasks

- [ ] Commit KB changes — run knowledge/commit.sh from repo root | type: recurring | freq: 12h | last: never
