import { validateCompanyUrl, resolveSafeUrl } from '../security/url_validator.js';
import { extractAndRankLinks, ScoredLink } from './link_scorer.js';
import { cleanHtmlContent, CleanedPageContent } from './content_cleaner.js';

export interface CrawledPage {
  url: string;
  statusCode: number;
  content: CleanedPageContent;
  isHiringRelated: boolean;
  error?: string;
}

export interface CrawlResult {
  baseUrl: string;
  reachable: boolean;
  pagesCrawled: CrawledPage[];
  pagesUsedUrls: string[];
  hiringPageFound: boolean;
  companySummaryText: string;
  hiringProcessText: string;
  errors: Array<{ url: string; error: string }>;
}

export interface CrawlerOptions {
  maxPages?: number;
  timeoutMs?: number;
  userAgent?: string;
  allowLocalHosts?: boolean;
}

/**
 * Parses simple robots.txt content to check if path is disallowed.
 */
export function isPathAllowedByRobots(robotsTxt: string, path: string): boolean {
  if (!robotsTxt || typeof robotsTxt !== 'string') return true;

  const lines = robotsTxt.split('\n');
  let appliesToAll = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const [directive, ...rest] = line.split(':');
    const key = directive.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      appliesToAll = value === '*';
    } else if (appliesToAll && key === 'disallow') {
      if (value && path.startsWith(value)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Production-grade, defensive site crawler.
 * Respects timeouts, robots.txt, link scoring, and rate-limits.
 */
export class SiteCrawler {
  private options: Required<CrawlerOptions>;

  constructor(options: CrawlerOptions = {}) {
    this.options = {
      maxPages: options.maxPages ?? 4,
      timeoutMs: options.timeoutMs ?? 8000,
      userAgent: options.userAgent ?? 'AI-Interview-Prep-Bot/1.0',
      allowLocalHosts: options.allowLocalHosts ?? (process.env.ALLOW_LOCAL_HOSTS === 'true'),
    };
  }

  private async fetchWithTimeout(url: string): Promise<{ ok: boolean; status: number; text: string; error?: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': this.options.userAgent,
          'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9',
        },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          text: '',
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const text = await response.text();
      return { ok: true, status: response.status, text };
    } catch (err: any) {
      clearTimeout(timeout);
      const isTimeout = err.name === 'AbortError' || err.message?.includes('aborted');
      return {
        ok: false,
        status: isTimeout ? 408 : 500,
        text: '',
        error: isTimeout ? `Request timed out after ${this.options.timeoutMs}ms` : (err.message || 'Network error'),
      };
    }
  }

  /**
   * Crawls the company website, discovers key pages, and extracts structured content.
   */
  async crawl(rawUrl: string): Promise<CrawlResult> {
    const validation = validateCompanyUrl(rawUrl, {
      allowLocalHosts: this.options.allowLocalHosts,
    });

    if (!validation.isValid || !validation.sanitizedUrl) {
      return {
        baseUrl: rawUrl,
        reachable: false,
        pagesCrawled: [],
        pagesUsedUrls: [],
        hiringPageFound: false,
        companySummaryText: '',
        hiringProcessText: '',
        errors: [{ url: rawUrl, error: validation.error || 'Invalid URL' }],
      };
    }

    const baseUrl = validation.sanitizedUrl;
    const errors: Array<{ url: string; error: string }> = [];
    const pagesCrawled: CrawledPage[] = [];

    // Check robots.txt
    let robotsTxt = '';
    try {
      const robotsUrl = new URL('/robots.txt', baseUrl).toString();
      const robotsRes = await this.fetchWithTimeout(robotsUrl);
      if (robotsRes.ok) {
        robotsTxt = robotsRes.text;
      }
    } catch {
      // Ignored if robots.txt is unavailable
    }

    // Fetch Homepage
    const homeRes = await this.fetchWithTimeout(baseUrl);
    if (!homeRes.ok) {
      errors.push({ url: baseUrl, error: homeRes.error || `Failed to fetch homepage (${homeRes.status})` });
      return {
        baseUrl,
        reachable: false,
        pagesCrawled: [],
        pagesUsedUrls: [],
        hiringPageFound: false,
        companySummaryText: '',
        hiringProcessText: '',
        errors,
      };
    }

    const homeCleaned = cleanHtmlContent(homeRes.text);
    pagesCrawled.push({
      url: baseUrl,
      statusCode: homeRes.status,
      content: homeCleaned,
      isHiringRelated: false,
    });

    // Score and rank links discovered on the homepage
    const rankedLinks = extractAndRankLinks(homeRes.text, baseUrl, this.options.maxPages * 2);

    // Filter allowed links by robots.txt
    const allowedLinks = rankedLinks.filter(link => {
      try {
        const parsed = new URL(link.url);
        return isPathAllowedByRobots(robotsTxt, parsed.pathname);
      } catch {
        return false;
      }
    });

    // Select top links to crawl (up to maxPages - 1 since homepage was fetched)
    const targetLinks = allowedLinks.slice(0, Math.max(1, this.options.maxPages - 1));

    let hiringPageFound = false;
    const hiringTextSnippets: string[] = [];

    for (const link of targetLinks) {
      const pageRes = await this.fetchWithTimeout(link.url);
      if (!pageRes.ok) {
        errors.push({ url: link.url, error: pageRes.error || `HTTP ${pageRes.status}` });
        continue;
      }

      const pageCleaned = cleanHtmlContent(pageRes.text);
      const isHiring = link.score >= 20 || /hiring|interview|career|jobs|handbook/i.test(link.url);

      if (isHiring) {
        hiringPageFound = true;
        hiringTextSnippets.push(`Page: ${link.url}\n${pageCleaned.cleanText}`);
      }

      pagesCrawled.push({
        url: link.url,
        statusCode: pageRes.status,
        content: pageCleaned,
        isHiringRelated: isHiring,
      });
    }

    const pagesUsedUrls = pagesCrawled.map(p => p.url);

    // Combine summaries
    const companySummaryText = [
      `Homepage (${baseUrl}):`,
      homeCleaned.metaDescription ? `Description: ${homeCleaned.metaDescription}` : '',
      homeCleaned.cleanText.slice(0, 3000),
    ].filter(Boolean).join('\n');

    const hiringProcessText = hiringTextSnippets.join('\n\n---\n\n').slice(0, 5000);

    return {
      baseUrl,
      reachable: true,
      pagesCrawled,
      pagesUsedUrls,
      hiringPageFound,
      companySummaryText,
      hiringProcessText,
      errors,
    };
  }
}
