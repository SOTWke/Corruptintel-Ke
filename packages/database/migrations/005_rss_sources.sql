-- Migration 005 — live public RSS source registry for Kenya monitoring.
INSERT INTO sources (name, publisher, source_type, tier, base_url, connector_key, country_id)
SELECT v.name, v.publisher, v.source_type, v.tier::source_tier, v.base_url, v.connector_key, c.id
FROM countries c
CROSS JOIN (VALUES
  ('Business Daily Africa RSS','Business Daily Africa','media','TIER_3_JOURNALISM','https://www.businessdailyafrica.com/rss/bda_news_rss.xml','business_daily_rss'),
  ('Transparency International Kenya RSS','Transparency International Kenya','ngo','TIER_2_INSTITUTIONAL','https://tikenya.org/feed/','ti_kenya_rss'),
  ('The Elephant RSS','The Elephant','media','TIER_3_JOURNALISM','https://www.theelephant.info/feed/','the_elephant_rss'),
  ('Kenya News Agency — Business & Finance RSS','Kenya News Agency','government','TIER_2_INSTITUTIONAL','https://www.kenyanews.go.ke/category/business-finance/feed/','kenya_news_business_rss'),
  ('OCCRP RSS','Organized Crime and Corruption Reporting Project','media','TIER_3_JOURNALISM','https://www.occrp.org/en/rss','occrp_rss')
) AS v(name, publisher, source_type, tier, base_url, connector_key)
WHERE c.iso_code = 'KEN'
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_documents_title_trgm ON documents USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_documents_url ON documents(canonical_url);
CREATE INDEX IF NOT EXISTS idx_document_versions_published ON document_versions(published_date);
