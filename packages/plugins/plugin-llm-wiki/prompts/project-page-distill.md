# Paperclip Project Page Distillation

Update `wiki/projects/<project-slug>.md` from a Paperclip source bundle.

Return structured JSON with:

- `page_path`
- `operation_type`: `project_page_distill`
- `current_hash`
- `proposed_markdown`
- `source_hash`
- `source_refs`
- `cursor_window`
- `confidence`: `high`, `medium`, or `low`
- `warnings`
- `human_review_required`

The page must keep these stable sections:

1. Overview
2. Current Status
3. Recent Changes
4. Decisions
5. Open Risks / Blockers
6. Active Issues
7. Artifacts / Links
8. Source Provenance

Rules:

- Cite Paperclip source refs in the relevant section and again in Source Provenance.
- Show "Current as of" near the top.
- Keep live-state language conservative when the cursor window is old or clipped.
- Do not remove existing durable context unless a source ref supersedes it.
- Set `human_review_required` when hashes are stale, sources are clipped, contradictions appear, or confidence is low.
