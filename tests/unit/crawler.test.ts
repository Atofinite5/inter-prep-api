import { describe, it, expect } from 'vitest';
import { extractAndRankLinks } from '../../src/core/crawler/link_scorer.js';
import { cleanHtmlContent } from '../../src/core/crawler/content_cleaner.js';
import { isPathAllowedByRobots } from '../../src/core/crawler/site_crawler.js';

describe('Crawler & Content Cleaner', () => {
  describe('Link Scorer Heuristics', () => {
    const sampleHtml = `
      <html>
        <body>
          <nav>
            <a href="/">Home</a>
            <a href="/about-us">About Us</a>
            <a href="/careers">Join our Team (Careers)</a>
            <a href="/handbook/interview-process">How We Hire & Interview Process</a>
            <a href="/privacy-policy">Privacy Policy</a>
            <a href="https://twitter.com/company">Twitter</a>
            <a href="/assets/logo.png">Logo</a>
          </nav>
        </body>
      </html>
    `;

    it('scores and ranks hiring/interview process pages highest', () => {
      const ranked = extractAndRankLinks(sampleHtml, 'https://acme.org', 5);

      expect(ranked.length).toBeGreaterThanOrEqual(2);
      // The interview process page should have highest score
      expect(ranked[0].url).toContain('/handbook/interview-process');
      expect(ranked[0].score).toBeGreaterThan(30);

      // Careers link should also be present in top results
      const urls = ranked.map(r => r.url);
      expect(urls.some(u => u.includes('/careers'))).toBe(true);

      // Excluded links: Privacy policy, twitter, logo.png should NOT be in the scored list
      expect(urls.some(u => u.includes('privacy-policy'))).toBe(false);
      expect(urls.some(u => u.includes('twitter.com'))).toBe(false);
      expect(urls.some(u => u.includes('logo.png'))).toBe(false);
    });
  });

  describe('HTML Content Cleaner', () => {
    const rawHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Acme Corp | Enterprise Cloud Platforms</title>
          <meta name="description" content="Acme provides scalable cloud platforms.">
          <script>console.log("tracking code");</script>
          <style>body { color: red; }</style>
        </head>
        <body>
          <nav><a href="/login">Login</a></nav>
          <div class="cookie-banner">Please accept all cookies</div>
          <main>
            <h1>Engineering at Acme</h1>
            <p>We build mission critical cloud infrastructure for global enterprises.</p>
            <p>Our team leverages Kubernetes, Go, and distributed message queues.</p>
          </main>
          <footer>Copyright 2026 Acme Corp</footer>
        </body>
      </html>
    `;

    it('cleans HTML, strips scripts, styles, navs and footers, leaving high-signal text', () => {
      const cleaned = cleanHtmlContent(rawHtml);

      expect(cleaned.title).toBe('Acme Corp | Enterprise Cloud Platforms');
      expect(cleaned.metaDescription).toBe('Acme provides scalable cloud platforms.');
      expect(cleaned.headings).toContain('Engineering at Acme');
      expect(cleaned.cleanText).toContain('We build mission critical cloud infrastructure');
      expect(cleaned.cleanText).not.toContain('tracking code');
      expect(cleaned.cleanText).not.toContain('cookie-banner');
      expect(cleaned.cleanText).not.toContain('Copyright 2026');
    });

    it('handles empty or malformed HTML cleanly', () => {
      const cleaned = cleanHtmlContent('');
      expect(cleaned.cleanText).toBe('');
      expect(cleaned.charCount).toBe(0);
    });
  });

  describe('Robots.txt Parser', () => {
    const robotsTxt = `
      User-agent: Googlebot
      Disallow: /private/

      User-agent: *
      Disallow: /admin/
      Disallow: /secret-hiring/
      Allow: /careers
    `;

    it('correctly checks if paths are allowed or disallowed', () => {
      expect(isPathAllowedByRobots(robotsTxt, '/careers')).toBe(true);
      expect(isPathAllowedByRobots(robotsTxt, '/about')).toBe(true);
      expect(isPathAllowedByRobots(robotsTxt, '/admin/users')).toBe(false);
      expect(isPathAllowedByRobots(robotsTxt, '/secret-hiring/internal')).toBe(false);
    });

    it('permits all paths if robots.txt is empty or missing', () => {
      expect(isPathAllowedByRobots('', '/anything')).toBe(true);
    });
  });
});
