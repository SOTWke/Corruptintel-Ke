-- ============================================================================
-- Migration 003 — seed reference data: Kenya, its 47 counties, sectors,
-- and the corruption taxonomy from the brief (§16). This is reference/
-- lookup data, not case data — safe to seed deterministically.
-- ============================================================================

INSERT INTO countries (iso_code, name, adapter_key)
VALUES ('KEN', 'Kenya', 'kenya')
ON CONFLICT (iso_code) DO NOTHING;

INSERT INTO counties (country_id, name)
SELECT c.id, county_name FROM countries c,
UNNEST(ARRAY[
  'Mombasa','Kwale','Kilifi','Tana River','Lamu','Taita-Taveta','Garissa','Wajir',
  'Mandera','Marsabit','Isiolo','Meru','Tharaka-Nithi','Embu','Kitui','Machakos',
  'Makueni','Nyandarua','Nyeri','Kirinyaga','Murang''a','Kiambu','Turkana',
  'West Pokot','Samburu','Trans Nzoia','Uasin Gishu','Elgeyo-Marakwet','Nandi',
  'Baringo','Laikipia','Nakuru','Narok','Kajiado','Kericho','Bomet','Kakamega',
  'Vihiga','Bungoma','Busia','Siaya','Kisumu','Homa Bay','Migori','Kisii',
  'Nyamira','Nairobi'
]) AS county_name
WHERE c.iso_code = 'KEN'
ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO sectors (name) VALUES
  ('Health'),('Infrastructure'),('Energy'),('Education'),('Security'),
  ('Agriculture'),('Finance'),('ICT'),('Transport'),('Water'),
  ('Lands'),('Environment')
ON CONFLICT (name) DO NOTHING;

-- Corruption taxonomy (§16), top-level categories first, then subcategories.
WITH cat AS (
  INSERT INTO corruption_taxonomy (category, subcategory) VALUES
    ('PROCUREMENT', NULL),
    ('FINANCIAL', NULL),
    ('BRIBERY', NULL),
    ('PUBLIC_RESOURCES', NULL),
    ('ABUSE_OF_OFFICE', NULL)
  ON CONFLICT DO NOTHING
  RETURNING id, category
)
INSERT INTO corruption_taxonomy (parent_id, category, subcategory)
SELECT cat.id, cat.category, sub.subcategory
FROM cat
JOIN (VALUES
  ('PROCUREMENT','Tender manipulation'),
  ('PROCUREMENT','Irregular procurement'),
  ('PROCUREMENT','Inflated pricing'),
  ('PROCUREMENT','Conflict of interest'),
  ('PROCUREMENT','Single-source irregularity'),
  ('PROCUREMENT','Ghost suppliers'),
  ('FINANCIAL','Embezzlement'),
  ('FINANCIAL','Misappropriation'),
  ('FINANCIAL','Unsupported expenditure'),
  ('FINANCIAL','Unaccounted funds'),
  ('FINANCIAL','Fraud'),
  ('BRIBERY','Solicitation'),
  ('BRIBERY','Payment'),
  ('BRIBERY','Facilitation'),
  ('BRIBERY','Influence'),
  ('PUBLIC_RESOURCES','Land'),
  ('PUBLIC_RESOURCES','Vehicles'),
  ('PUBLIC_RESOURCES','Funds'),
  ('PUBLIC_RESOURCES','Natural resources'),
  ('PUBLIC_RESOURCES','Government assets'),
  ('ABUSE_OF_OFFICE','Nepotism'),
  ('ABUSE_OF_OFFICE','Conflict of interest'),
  ('ABUSE_OF_OFFICE','Illegal authorization'),
  ('ABUSE_OF_OFFICE','Administrative abuse')
) AS sub(category, subcategory) ON sub.category = cat.category;

-- Kenya's key institutional sources (§3), registered with their correct tier.
INSERT INTO sources (name, publisher, source_type, tier, connector_key, country_id)
SELECT s.name, s.publisher, s.source_type, s.tier::source_tier, s.connector_key, c.id
FROM countries c,
(VALUES
  ('Office of the Auditor-General','Office of the Auditor-General, Kenya','government','TIER_1_PRIMARY','auditor_general'),
  ('Ethics and Anti-Corruption Commission','EACC','government','TIER_2_INSTITUTIONAL','eacc'),
  ('Judiciary of Kenya','Judiciary of Kenya','court','TIER_1_PRIMARY','judiciary'),
  ('Parliament of Kenya - Hansard','Parliament of Kenya','government','TIER_1_PRIMARY','hansard'),
  ('Public Procurement Regulatory Authority','PPRA','government','TIER_1_PRIMARY','ppra')
) AS s(name, publisher, source_type, tier, connector_key)
WHERE c.iso_code = 'KEN'
ON CONFLICT DO NOTHING;
