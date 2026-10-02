import path from "path";
import { CuratedFileConnector } from "./connectors/CuratedFileConnector";
import { RssConnector } from "./connectors/RssConnector";
import type { SourceConnector } from "./connectors/SourceConnector";

export function buildDefaultConnectors(curatedDocsDir?: string): SourceConnector[] {
  return [
    new CuratedFileConnector(curatedDocsDir || process.env.CURATED_DOCS_DIR || path.join(process.cwd(), "seed-documents"), {
      sourceKey: "curated_seed", sourceName: "Curated MVP Document Set", tier: "TIER_3_JOURNALISM", countryIsoCode: "KEN", pollIntervalMinutes: 360,
    }),
    new RssConnector({ url: "https://www.businessdailyafrica.com/rss/bda_news_rss.xml", sourceKey: "business_daily_rss", sourceName: "Business Daily Africa", tier: "TIER_3_JOURNALISM", countryIsoCode: "KEN", pollIntervalMinutes: 60 }),
    new RssConnector({ url: "https://tikenya.org/feed/", sourceKey: "ti_kenya_rss", sourceName: "Transparency International Kenya", tier: "TIER_2_INSTITUTIONAL", countryIsoCode: "KEN", pollIntervalMinutes: 120 }),
    new RssConnector({ url: "https://www.theelephant.info/feed/", sourceKey: "the_elephant_rss", sourceName: "The Elephant", tier: "TIER_3_JOURNALISM", countryIsoCode: "KEN", pollIntervalMinutes: 120 }),
    new RssConnector({ url: "https://www.kenyanews.go.ke/category/business-finance/feed/", sourceKey: "kenya_news_business_rss", sourceName: "Kenya News Agency — Business & Finance", tier: "TIER_2_INSTITUTIONAL", countryIsoCode: "KEN", pollIntervalMinutes: 120 }),
    new RssConnector({ url: "https://www.occrp.org/en/rss", sourceKey: "occrp_rss", sourceName: "OCCRP", tier: "TIER_3_JOURNALISM", countryIsoCode: "KEN", pollIntervalMinutes: 180 }),
    new RssConnector({ url: "https://africauncensored.online/feed/", sourceKey: "africa_uncensored_rss", sourceName: "Africa Uncensored", tier: "TIER_3_JOURNALISM", countryIsoCode: "KEN", pollIntervalMinutes: 180 }),
    new RssConnector({ url: "https://nation.africa/kenya/rss", sourceKey: "nation_kenya_rss", sourceName: "Nation Africa — Kenya", tier: "TIER_3_JOURNALISM", countryIsoCode: "KEN", pollIntervalMinutes: 120 }),
    new RssConnector({ url: "https://www.businessdailyafrica.com/rssfeeds/539546-539546-view-asFeed-u9ygc5/index.xml", sourceKey: "business_daily_topics_rss", sourceName: "Business Daily Africa Topics", tier: "TIER_3_JOURNALISM", countryIsoCode: "KEN", pollIntervalMinutes: 120 }),
  ];
}
