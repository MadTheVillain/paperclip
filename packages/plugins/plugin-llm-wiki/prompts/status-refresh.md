# Paperclip Status Refresh

Refresh only the status-sensitive sections of an existing project page:

- Current Status
- Recent Changes
- Open Risks / Blockers
- Active Issues
- Source Provenance

Return structured JSON with:

- `page_path`
- `operation_type`: `status_refresh`
- `current_hash`
- `proposed_markdown`
- `source_hash`
- `source_refs`
- `cursor_window`
- `warnings`
- `human_review_required`

Rules:

- Preserve stable overview and decision text unless the bundle explicitly supersedes it.
- Use source refs for every status change.
- Refuse stale hashes instead of overwriting.
- Set review required when the source window is clipped or inconsistent.
