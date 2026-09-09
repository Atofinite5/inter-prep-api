import { describe, it, expect, vi } from 'vitest';
import { SiteCrawler } from '../../src/core/crawler/site_crawler.js';
import { PrepKitOrchestrator } from '../../src/core/pipeline/orchestrator.js';
import { ResilientLLMClient } from '../../src/core/generation/llm_client.js';

describe('Advanced Crawler & Pass 2 Gap Closure', () => {
  it('crawls homepage and subsequent ranked subpages successfully', async () => {
    const crawler = new SiteCrawler({ maxPages: 3, allowLocalHosts: true });

    const fakeHomepageHtml = `
      <html>
        <body>
          <h1>Acme Home</h1>
          <a href="/careers">Careers & Jobs at Acme</a>
          <a href="/about">About Acme Team</a>
        </body>
      </html>
    `;

    const fakeCareersHtml = `
      <html>
        <body>
          <h1>Careers at Acme</h1>
          <p>Our interview process consists of a technical screen and system design round.</p>
        </body>
      </html>
    `;

    // Spy on internal fetchWithTimeout
    vi.spyOn(crawler as any, 'fetchWithTimeout').mockImplementation(((url: string) => {
      if (url.includes('robots.txt')) {
        return Promise.resolve({ ok: true, status: 200, text: 'User-agent: *\nAllow: /' });
      }
      if (url.includes('/careers')) {
        return Promise.resolve({ ok: true, status: 200, text: fakeCareersHtml });
      }
      return Promise.resolve({ ok: true, status: 200, text: fakeHomepageHtml });
    }) as any);

    const result = await crawler.crawl('https://acme-test.org');
    expect(result.reachable).toBe(true);
    expect(result.hiringPageFound).toBe(true);
    expect(result.pagesUsedUrls.length).toBeGreaterThanOrEqual(2);
    expect(result.hiringProcessText).toContain('interview process');
  });

  it('handles invalid or empty URLs in crawler gracefully', async () => {
    const crawler = new SiteCrawler();
    const result = await crawler.crawl('');
    expect(result.reachable).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('triggers Pass 2 when must-have requirements are uncovered after Pass 1', async () => {
    const mockClient = new ResilientLLMClient({ apiKey: 'fake-key' });

    // Mock extraction to return 2 must-have requirements: r1 and r2
    vi.spyOn(mockClient, 'generateJSON').mockImplementation(async (prompt: string) => {
      if (prompt.includes('analyzing a job description')) {
        return {
          title: 'Full Stack Engineer',
          seniority: 'Senior',
          responsibilities: ['Build features'],
          requirements: [
            { id: 'r1', text: '5+ years React', kind: 'technical', priority: 'must' },
            { id: 'r2', text: 'Distributed microservices', kind: 'technical', priority: 'must' },
          ],
        };
      }

      if (prompt.includes('CRITICAL SECOND-PASS RECOVERY')) {
        // Pass 2 recovers the missing requirement r2
        return [
          {
            id: 'q99',
            requirement_ids: ['r2'],
            category: 'technical',
            prompt: 'Pass 2 targeted question on microservices',
            answer_outline: 'Outline',
            difficulty: 3,
          },
        ];
      }

      if (prompt.includes('Category:')) {
        // Pass 1 calls across all categories ONLY reference r1, leaving r2 uncovered
        return [
          {
            id: 'q1',
            requirement_ids: ['r1'],
            category: 'technical',
            prompt: 'React question',
            answer_outline: 'Outline',
            difficulty: 3,
          },
        ];
      }

      return [];
    });

    const orchestrator = new PrepKitOrchestrator(mockClient);
    const pass2Events: string[] = [];

    const kit = await orchestrator.generateKit(
      {
        jd: 'Senior Full Stack Engineer. 5+ years React required. Distributed microservices required.',
        companyUrl: 'https://example.com',
        days: 3,
      },
      {
        onProgress: evt => {
          if (evt.step === 'questions_pass_2') {
            pass2Events.push(evt.message);
          }
        },
      }
    );

    expect(pass2Events.length).toBe(1);
    expect(kit.coverage.passes).toBe(2);
    // r2 was recovered in Pass 2
    expect(kit.questions.some(q => q.requirement_ids.includes('r2'))).toBe(true);
  });
});
