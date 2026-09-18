# CorruptIntel — Evidence & Provenance Model (Phase 1)

## 1. The Chain, End to End

```
Source (tiered, e.g. TIER_1_PRIMARY)
   → Document (logical, stable id)
      → Document Version (hashed, dated, immutable once created)
         → Evidence (bounded excerpt + page/section ref + extractor identity + confidence)
            → Case Claim (evidence-qualified sentence + certainty level)
               → rendered on a case/entity page with a "Show Evidence" affordance
```

No node in this chain can be skipped. The schema makes `evidence_id` `NOT NULL` on `case_claims`, `case_status_events`, `financial_amounts`, `relationships`, and `contracts` — a claim, status change, amount, relationship, or contract literally cannot be inserted into the database without a resolved evidence row behind it.

## 2. Certainty Vocabulary (maps directly to §2)

| Value | Meaning | Who can assert it |
|---|---|---|
| CONFIRMED | Backed by a Tier-1 primary document (judgment, audit report, official record) | Deterministic rule once a Tier-1 evidence row exists |
| REPORTED | Published by credible media, not independently established | Auto from Tier-3 evidence |
| ALLEGED | An allegation by a named party (whistleblower, institution, media) | Requires attribution field naming who alleged it |
| INVESTIGATED / CHARGED / CONVICTED / ACQUITTED_DISMISSED | Formal legal/procedural stage | Requires a Tier-1 or Tier-2 evidence row citing the specific procedural document |
| UNKNOWN_UNRESOLVED | Evidence doesn't establish a final outcome | Default when no later-stage evidence exists |

The system never renders "Person X is corrupt." Case-claim text templates are evidence-qualified by construction, e.g.:
- `"{entity} was named in {source} in connection with an allegation concerning {matter}."`
- `"{entity} was convicted by {court} in {year}, according to {document}."`
- `"{entity} was acquitted in the referenced proceedings."`

These templates are the only sanctioned way case-claim prose is generated for anything touching an identifiable person — free-form AI narrative about a person's guilt is not a code path that exists in this system.

## 3. Source Tiering Enforcement (§4)

Tier is a property of the `sources` row, set by a human when a source is registered — never inferred by the AI. Tier governs:
- What certainty levels can be asserted from evidence at that tier (Tier 5 / social media can only ever support `ALLEGED` at most, and only as a "lead" flag for human researchers — never a published claim on its own, per §4's explicit rule).
- Auto-approval eligibility (only Tier 1/2 evidence is eligible for `AUTO_APPROVED` extraction routing, and only for structural metadata, never a person's legal status).

## 4. Corrections & Versioning (§28, §45)

- `documents`/`document_versions` are append-only. A source retraction sets `documents.is_removed = true` but the historical version remains on file with its retrieval date intact — the record of "we saw this and it said X on this date" is itself evidentiary.
- Case edits happen via new `case_status_events` / new `case_claims` rows, never in-place mutation of prior claims. A case page's "Corrections / Updates" section is a direct read of this history.
- `audit_logs.before_state`/`after_state` (JSONB snapshots) give a full diff trail for anything a human or the auto-approval path changes on a published row.

## 5. "Show Evidence" (§32) — What Gets Displayed

For any rendered claim: source name + tier, document title, page/section reference, the bounded excerpt, retrieval date, extractor identity (`ai:model-version` or `human:user_id`), and confidence. Excerpts are capped short (a sentence or two) — long enough to verify the claim, short enough to respect §15's "do not expose more copyrighted source text than legally appropriate" and the platform's own copyright discipline.

## 6. What This Model Deliberately Prevents

- An AI-invented case, source, financial figure, relationship, or conviction — because none of those rows can exist without a resolved `evidence_id`, and evidence rows can only be created by the evidence-linker after verifying the cited excerpt literally exists in a stored, hashed document.
- Silent overwriting of history — versioning means "what did we say last month" is always answerable.
- Conflated financial totals — `financial_amounts.amount_type` keeps contract value, alleged loss, recovered funds, etc. as distinct rows; the statistics endpoint sums each type separately, never together.
