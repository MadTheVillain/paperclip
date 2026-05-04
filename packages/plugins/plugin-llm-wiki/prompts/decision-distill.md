# Paperclip Decision Distillation

Extract durable project decisions from Paperclip issue history.

Return structured JSON with:

- `page_path`: `wiki/projects/<project-slug>/decisions.md`
- `operation_type`: `decision_distill`
- `decisions`: accepted, rejected, reversed, or superseded decisions
- `source_refs`
- `warnings`
- `human_review_required`

Rules:

- A decision needs explicit evidence: accepted plan, approval outcome, maintainer comment, merged implementation, or reversal.
- Preserve who/what/when/source, but do not invent a decision owner.
- Distinguish "proposal" from "accepted decision".
- Mark ambiguous or conflicting material for human review.
