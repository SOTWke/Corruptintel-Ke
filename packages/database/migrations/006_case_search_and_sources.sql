-- Migration 006 — expand public case discovery and register additional Kenya feeds.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS search_vector tsvector;
UPDATE cases c SET search_vector = to_tsvector('english', concat_ws(' ', c.title, c.outcome_summary, c.case_code));
CREATE INDEX IF NOT EXISTS idx_cases_search_vector ON cases USING gin(search_vector);

CREATE OR REPLACE FUNCTION corruptintel_refresh_case_search_vector() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', concat_ws(' ', NEW.title, NEW.outcome_summary, NEW.case_code));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS cases_search_vector_trigger ON cases;
CREATE TRIGGER cases_search_vector_trigger BEFORE INSERT OR UPDATE OF title, outcome_summary, case_code ON cases
FOR EACH ROW EXECUTE FUNCTION corruptintel_refresh_case_search_vector();

INSERT INTO sources (name, publisher, source_type, tier, base_url, connector_key, country_id)
SELECT v.name, v.publisher, v.source_type, v.tier::source_tier, v.base_url, v.connector_key, c.id
FROM countries c
CROSS JOIN (VALUES
  ('Africa Uncensored RSS','Africa Uncensored','media','TIER_3_JOURNALISM','https://africauncensored.online/feed/','africa_uncensored_rss'),
  ('Nation Africa — Kenya RSS','Nation Africa','media','TIER_3_JOURNALISM','https://nation.africa/kenya/rss','nation_kenya_rss'),
  ('Business Daily Africa Topics RSS','Business Daily Africa','media','TIER_3_JOURNALISM','https://www.businessdailyafrica.com/rssfeeds/539546-539546-view-asFeed-u9ygc5/index.xml','business_daily_topics_rss')
) AS v(name, publisher, source_type, tier, base_url, connector_key)
WHERE c.iso_code = 'KEN'
  AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.connector_key = v.connector_key);

CREATE INDEX IF NOT EXISTS idx_case_claims_case ON case_claims(case_id);
CREATE INDEX IF NOT EXISTS idx_case_entities_case ON case_entities(case_id);
CREATE INDEX IF NOT EXISTS idx_case_sources_case ON case_sources(case_id);
