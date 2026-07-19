# ALMAS Documentation — Entry Point

## Documentation Layers

ALMAS has two documentation layers:

1. **`docs/`** (this folder) — human documentation. **This is the source of truth** for the project's mission, architecture, and rules.
2. **`.cursor/rules/`** — AI operating manual. A condensed set of rules mechanically derived from `docs/`, used by AI coding agents (like Cursor) to act consistently with this documentation.

Synchronization is one-directional: **`docs/` → `.cursor/rules/`, never the reverse.** If the architecture or rules change, update the relevant file in `docs/` first, then update the matching file in `.cursor/rules/` to reflect it.

## Source of Truth Order

1. **Code** — what is actually running, always wins in a factual dispute.
2. **`docs/`** — this documentation, the intended design and rules.
3. **`.cursor/rules/`** — derived from `docs/`, for AI-agent behavior.
4. **Chat conversation** — lowest priority; never overrides the above.

## Reading Order

1. [VISION.md](./VISION.md) — mission and long-term direction
2. [ARCHITECTURE.md](./ARCHITECTURE.md) — current and target system design
3. [DECISIONS.md](./DECISIONS.md) — accepted architectural decisions (unchanged, still final)
4. [STANDARDS.md](./STANDARDS.md) — engineering rules for humans and AI agents
5. [ROADMAP.md](./ROADMAP.md) — development phases
6. [DATA_MODEL.md](./DATA_MODEL.md) — Supabase entities, existing and planned
7. [PROJECT_STATE.md](./PROJECT_STATE.md) — what's done, in progress, next, and future
8. [CHAT_RULES.md](./CHAT_RULES.md) — how ALMAS talks to the end user

## Also in This Folder (historical / supporting, unchanged by this rewrite)

- [README.md](./README.md) — one-line project description
- [FEATURES.md](./FEATURES.md), [FEATURE-003.md](./FEATURE-003.md) — historical feature notes
- [CHANGELOG.md](./CHANGELOG.md) — version history

## Note

The top-level `Documents/` folder (outside `Code/telegram-bot/`) is an earlier, partially-empty draft area that predates this `docs/` folder. It is not part of the documentation layers described above.
