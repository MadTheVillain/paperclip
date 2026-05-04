# Paperclip Wiki Backfill

Backfill a historical Paperclip project or root issue into the LLM Wiki.

Return structured JSON with:

- `project_page`
- optional `decisions_page`
- optional `history_page`
- `source_hash`
- `source_refs`
- `cursor_window`
- `warnings`
- `human_review_required`

Rules:

- Summarize historical issue history into durable project knowledge.
- Do not create one page per issue by default.
- Prefer timeline entries for meaningful state transitions, decisions, and completed work.
- Include clipped-source warnings and source provenance.
- Use proposed patches first; only write pages when auto-apply policy allows it and hashes still match.
