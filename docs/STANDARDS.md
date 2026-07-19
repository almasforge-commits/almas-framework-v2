# Engineering Standards

Rules for anyone — human or AI agent — modifying this codebase.

This document is the **source of truth**. The condensed, machine-enforced version of these rules lives in `.cursor/rules/almas.mdc` and `.cursor/rules/AI_RULES.md`. If the rules ever need to change, change them here first, then update `.cursor/rules/` to match — never the other way around.

## Before Making a Change

1. Read the existing code before proposing anything. Never guess at architecture.
2. Check `DECISIONS.md` — if a decision is already recorded there, treat it as final. Don't re-litigate it without an explicit request to revisit it.
3. Explain your implementation plan before writing code, and wait for approval on anything non-trivial.

## While Making a Change

4. Modify only the files relevant to the current task.
5. Never delete working functionality without being asked.
6. Keep the existing folder structure (`config/`, `core/`, `providers/`, `services/`, `handlers/`).
7. Prefer reusing an existing service or abstraction over creating a new one.
8. Supabase is the primary storage target for anything new. JSON storage is legacy and is only replaced when explicitly requested.
9. New content-ingestion sources (PDF, voice, website, etc.) follow the same Pipeline pattern already used for YouTube (see `ARCHITECTURE.md`) — don't invent a parallel mechanism.
10. Keep functions small, single-purpose, and readable over clever.

## After Making a Change

11. One task = one commit.
12. Verify the project still starts successfully after every change.
13. Ask before making a breaking change — don't assume silence means approval.
14. If the architecture changes, update `docs/` first, then synchronize `.cursor/rules/` to match. Never the reverse.

## Code Quality

15. Write production-ready code: handle errors explicitly, don't leave debug logging in user-facing paths, and don't leave dead code unflagged — if something looks unused, say so rather than silently deleting or silently keeping it.

## For AI Agents Specifically

16. These rules apply to you exactly as they apply to a human contributor. `.cursor/rules/almas.mdc` is your always-loaded operating manual derived from this document — if something there seems to contradict this document, this document wins, and `.cursor/rules/` should be updated to match.
