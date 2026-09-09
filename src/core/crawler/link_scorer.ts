import * as cheerio from 'cheerio';
import { URL } from 'url';

export interface ScoredLink {
  url: string;
  score: number;
  anchorText: string;
  reason: string;
}

const HIGH_PRIORITY_KEYWORDS: Record<string, number> = {
  'how we hire': 40,
  'interview process': 40,
  'hiring process': 40,
  'engineering handbook': 35,
  'careers': 25,
  'jobs': 25,
  'join us': 25,
  'open positions': 25,
  'work with us': 25,
  'engineering': 20,
  'culture': 20,
  'values': 20,
  'about us': 18,
  'about': 15,
  'handbook': 25,
  'team': 15,
  'life at': 20,
  'people': 12,
  'mission': 12,
};

const LOW_PRIORITY_PATTERNS = [
  /\/privacy/i,
  /\/terms/i,
  /\/cookie/i,
  /\/legal/i,
  /\/login/i,
  /\/signin/i,
  /\/signup/i,
  /\/register/i,
  /\/cart/i,
  /\/checkout/i,
  /\/billing/i,
  /\/status/i,
  /\/support/i,
  /\/help/i,
  /\/faq/i,
  /\/contact/i,
];

const EXCLUDED_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|tar|gz|mp4|mov|avi|wmv|mp3|wav|css|js|map|xml|json|rss)$/i;

/**
 * Extracts and scores links from an HTML page using heuristic relevance weighting.
 */
export function extractAndRankLinks(
  html: string,
  baseUrl: string,
  maxResults = 5
): ScoredLink[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const baseHostname = base.hostname.replace(/^www\./, '');

  const candidates = new Map<string, { score: number; anchorText: string; reasons: string[] }>();

  $('a').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;

    const trimmedHref = href.trim();
    if (!trimmedHref || trimmedHref.startsWith('#') || trimmedHref.startsWith('javascript:') || trimmedHref.startsWith('mailto:') || trimmedHref.startsWith('tel:')) {
      return;
    }

    let resolvedUrl: URL;
    try {
      resolvedUrl = new URL(trimmedHref, baseUrl);
    } catch {
      return;
    }

    // Must be http or https
    if (resolvedUrl.protocol !== 'http:' && resolvedUrl.protocol !== 'https:') {
      return;
    }

    const targetHostname = resolvedUrl.hostname.replace(/^www\./, '');
    const isSameDomain = targetHostname === baseHostname || targetHostname.endsWith(`.${baseHostname}`);

    // Skip external links unless it's a dedicated careers subdomain (e.g. jobs.lever.co/company or careers.company.com)
    if (!isSameDomain && !targetHostname.includes('career') && !targetHostname.includes('job')) {
      return;
    }

    // Skip static assets
    if (EXCLUDED_EXTENSIONS.test(resolvedUrl.pathname)) {
      return;
    }

    // Normalize URL: strip hash and trailing slash
    resolvedUrl.hash = '';
    const normalizedUrl = resolvedUrl.toString().replace(/\/+$/, '');

    // Skip homepage itself
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    if (normalizedUrl === normalizedBase || normalizedUrl === `${normalizedBase}/`) {
      return;
    }

    const anchorText = $(element).text().trim().replace(/\s+/g, ' ');
    const pathAndText = `${resolvedUrl.pathname} ${anchorText}`.toLowerCase();

    // Check penalty patterns
    for (const pattern of LOW_PRIORITY_PATTERNS) {
      if (pattern.test(resolvedUrl.pathname)) {
        return;
      }
    }

    let score = 0;
    const reasons: string[] = [];

    // Score based on keywords in anchor text and URL path
    for (const [keyword, weight] of Object.entries(HIGH_PRIORITY_KEYWORDS)) {
      if (pathAndText.includes(keyword)) {
        score += weight;
        reasons.push(`Matched "${keyword}" (+${weight})`);
      }
    }

    // Bonus for specific hiring/careers subdomains
    if (targetHostname.startsWith('careers.') || targetHostname.startsWith('jobs.')) {
      score += 30;
      reasons.push('Dedicated careers subdomain (+30)');
    }

    // Only consider links that have positive relevance
    if (score > 0) {
      const existing = candidates.get(normalizedUrl);
      if (!existing || existing.score < score) {
        candidates.set(normalizedUrl, {
          score,
          anchorText: anchorText.slice(0, 80),
          reasons,
        });
      }
    }
  });

  // Sort descending by score
  const sorted: ScoredLink[] = Array.from(candidates.entries())
    .map(([url, data]) => ({
      url,
      score: data.score,
      anchorText: data.anchorText,
      reason: data.reasons.join(', '),
    }))
    .sort((a, b) => b.score - a.score);

  return sorted.slice(0, maxResults);
}
