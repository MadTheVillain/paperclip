# Paperclip Source Bundle Reader

You are reading a bounded Paperclip issue-history source bundle for the LLM Wiki.

Return structured JSON that can be validated before any wiki write:

- `source_hash`: the bundle hash supplied by the tool
- `cursor_window`: `{ "start": string | null, "end": string | null }`
- `source_refs`: the issue, comment, and document refs used for every claim
- `signals`: durable changes worth distilling, grouped by status, decision, risk, artifact, and implementation note
- `warnings`: clipped sources, contradictions, missing context, stale hashes, or low-confidence material
- `low_signal`: true when the bundle contains no durable project change

Rules:

- Preserve Paperclip issue identifiers and document keys exactly.
- Treat issue/comment/document history as provenance, not as prose to copy wholesale.
- Ignore plugin-operation issues and raw heartbeat noise.
- Do not infer live status beyond the bundle's `current_as_of` timestamp.
- Prefer concise, source-cited observations over narrative.
