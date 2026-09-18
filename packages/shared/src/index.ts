// Shared types mirroring the controlled vocabularies in
// packages/database/migrations/001_init_schema.sql. Keep these in lockstep
// with the SQL enums — they exist so the API and web app can't drift into
// inventing a status value the schema doesn't recognize.

export type CaseStatus =
  | "REPORTED"
  | "ALLEGED"
  | "INVESTIGATION"
  | "UNDER_REVIEW"
  | "CHARGED"
  | "COURT_PROCEEDINGS"
  | "CONVICTED"
  | "ACQUITTED"
  | "DISMISSED"
  | "WITHDRAWN"
  | "SETTLED"
  | "UNRESOLVED";

export type SourceTier =
  | "TIER_1_PRIMARY"
  | "TIER_2_INSTITUTIONAL"
  | "TIER_3_JOURNALISM"
  | "TIER_4_COMMENTARY"
  | "TIER_5_SOCIAL";

export type ClaimCertainty =
  | "CONFIRMED"
  | "REPORTED"
  | "ALLEGED"
  | "INVESTIGATED"
  | "CHARGED"
  | "CONVICTED"
  | "ACQUITTED_DISMISSED"
  | "UNKNOWN_UNRESOLVED";

export type AmountType =
  | "CONTRACT_VALUE"
  | "TENDER_VALUE"
  | "ALLEGED_LOSS"
  | "IRREGULAR_EXPENDITURE"
  | "UNSUPPORTED_EXPENDITURE"
  | "OVERPAYMENT"
  | "RECOVERY_AMOUNT"
  | "FINE"
  | "PENALTY"
  | "BUDGET_ALLOCATION";

export type UserRole = "PUBLIC" | "RESEARCHER" | "SENIOR_RESEARCHER" | "ADMIN";

export interface EvidenceRef {
  evidence_id: string;
  source_name: string;
  source_tier: SourceTier;
  document_title: string | null;
  page_reference: string | null;
  excerpt: string;
  url: string | null;
  retrieval_date: string;
  extraction_confidence: number | null;
}

/** Every API response carrying a factual claim uses this envelope. A claim
 * with an empty `evidence` array should never happen — if it does, that's a
 * bug to fix, not a case to trust. */
export interface EvidencedResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
  evidence: EvidenceRef[];
}

export interface ConfidenceDimensions {
  source_confidence: number | null;
  extraction_confidence: number | null;
  entity_confidence: number | null;
  relationship_confidence: number | null;
  classification_confidence: number | null;
}

export interface CaseSummary {
  id: string;
  case_code: string;
  title: string;
  current_status: CaseStatus;
  sector: string | null;
  county: string | null;
  source_count: number;
  confidence: ConfidenceDimensions;
}

export interface CaseClaim {
  id: string;
  claim_text: string;
  certainty: ClaimCertainty;
  evidence: EvidenceRef;
  conflicts_with_claim_id: string | null;
}

export interface FinancialAmount {
  amount: string; // numeric(20,2) transported as string to avoid float precision loss
  currency: string;
  amount_type: AmountType;
  is_approximate: boolean;
  context_note: string | null;
  evidence: EvidenceRef;
}

export interface ResearchBrief {
  executive_summary: string;
  key_findings: string[];
  timeline: { date: string | null; description: string; evidence: EvidenceRef }[];
  financial_exposure: FinancialAmount[];
  entities: { name: string; type: "PERSON" | "COMPANY" | "INSTITUTION"; role: string }[];
  evidence: EvidenceRef[];
  conflicting_accounts: { claim_a: CaseClaim; claim_b: CaseClaim }[];
  case_status: CaseStatus | "UNKNOWN_UNRESOLVED";
  unknown_or_missing: string[];
  sources: EvidenceRef[];
}
