# Seed Documents

Drop your first 50–200 curated source documents here (.txt, .md, or .html)
to bootstrap the MVP ingestion pipeline via CuratedFileConnector, per
Ingestion Architecture §7 / MVP Plan.

Suggested starting set (per the brief's §3 source list):
- A handful of Auditor-General report excerpts
- A few public Judiciary judgments
- Some PPRA procurement notices
- One curated news RSS feed's worth of articles

Each file becomes one `documents` row; re-running the worker on an unchanged
file is a no-op (content-hash idempotency) and on a changed file creates a
new `document_versions` row without touching the old one.
