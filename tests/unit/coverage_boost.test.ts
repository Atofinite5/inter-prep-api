import { describe, it, expect, vi } from 'vitest';
import { extractRequirementsHeuristic } from '../../src/core/extraction/jd_extractor.js';
import { generateCompanyBrief } from '../../src/core/generation/company_brief.js';
import { generateTargetedQuestionsForGaps, generateCategoryQuestions } from '../../src/core/generation/question_generator.js';
import { PracticeEngine } from '../../src/core/practice/practice_engine.js';
import { validateCompanyUrl, resolveSafeUrl } from '../../src/core/security/url_validator.js';
import { ResilientLLMClient } from '../../src/core/generation/llm_client.js';
import { cleanHtmlContent } from '../../src/core/crawler/content_cleaner.js';

describe('Coverage Booster - Branch & Edge Case Coverage', () => {
  it('covers domain, behavioural and thin branches in jd_extractor heuristic', () => {
    const jdWithDomainAndLeadership = `
      Lead Architect - Fintech Banking Platform
      Responsibilities:
      - Design highly available core banking transaction systems
      - Lead and mentor junior developers in agile development
      Requirements:
      - 8+ years distributed systems (Required)
      - Experience with banking compliance and regulations (Required)
      - Strong stakeholder communication and leadership (Essential)
      - Bonus points for AWS certification (Plus)
    `;

    const extracted = extractRequirementsHeuristic(jdWithDomainAndLeadership);
    expect(['Senior', 'Lead']).toContain(extracted.seniority);
    expect(extracted.requirements.some(r => r.kind === 'domain')).toBe(true);
    expect(extracted.requirements.some(r => r.kind === 'behavioural')).toBe(true);
    expect(extracted.requirements.some(r => r.priority === 'nice')).toBe(true);

    // Empty text
    const emptyResult = extractRequirementsHeuristic('');
    expect(emptyResult.requirements.length).toBeGreaterThan(0);
  });

  it('covers LLM fallback error branches in company_brief and question_generator', async () => {
    const errorClient = new ResilientLLMClient({ apiKey: 'key' });
    vi.spyOn(errorClient, 'generateJSON').mockRejectedValue(new Error('Simulated API failure'));

    // company brief error fallback
    const brief = await generateCompanyBrief('https://test.com', {
      baseUrl: 'https://test.com',
      reachable: true,
      pagesCrawled: [],
      pagesUsedUrls: ['https://test.com'],
      hiringPageFound: false,
      companySummaryText: 'Brief summary text here',
      hiringProcessText: '',
      errors: [],
    }, 'Engineer', errorClient);

    expect(brief.summary).toContain('compiled from 1 retrieved page');

    // targeted gap questions error fallback
    const gaps = await generateTargetedQuestionsForGaps(
      [{ id: 'r1', text: 'System architecture', kind: 'technical', priority: 'must' }],
      { title: 'Architect', seniority: 'Senior', responsibilities: [], requirements: [] },
      1,
      {},
      errorClient
    );
    expect(gaps.length).toBe(1);

    // category questions error fallback
    const catQuestions = await generateCategoryQuestions(
      'technical',
      [{ id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' }],
      { title: 'Engineer', seniority: 'Senior', responsibilities: [], requirements: [] },
      1,
      {},
      errorClient
    );
    expect(catQuestions.length).toBeGreaterThanOrEqual(1);
  });

  it('covers empty stats in practice engine and low confidence edge cases', () => {
    const emptyStats = PracticeEngine.computeStats([]);
    expect(emptyStats.totalCards).toBe(0);
    expect(emptyStats.averageConfidence).toBe(0);

    const card = { id: 'f1', front: 'Q', back: 'A', requirement_ids: ['r1'] };
    const recorded = PracticeEngine.recordConfidence(card, 5);
    const stats = PracticeEngine.computeStats([recorded], [{ id: 'r1', text: 'T', kind: 'technical', priority: 'must' }]);
    expect(stats.averageConfidence).toBe(5);
    expect(stats.masteryPercentage).toBe(100);
  });

  it('covers malformed URL edge cases in url_validator', () => {
    expect(validateCompanyUrl('   ').isValid).toBe(false);
    expect(validateCompanyUrl('http://[invalid-ipv6').isValid).toBe(false);
    expect(resolveSafeUrl('http://valid.com', 'https://base.com')).toBe('http://valid.com/');
    expect(resolveSafeUrl('relative/path', 'invalid-base')).toBeNull();
  });

  it('covers fallback in cleanHtmlContent when body has minimal text', () => {
    const miniHtml = '<html><body>Short</body></html>';
    const cleaned = cleanHtmlContent(miniHtml);
    expect(cleaned.cleanText).toBe('Short');
  });
});
