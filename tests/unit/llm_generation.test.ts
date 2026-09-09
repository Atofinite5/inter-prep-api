import { describe, it, expect, vi } from 'vitest';
import { ResilientLLMClient } from '../../src/core/generation/llm_client.js';
import { generateCategoryQuestions, generateTargetedQuestionsForGaps } from '../../src/core/generation/question_generator.js';
import { generateCompanyBrief } from '../../src/core/generation/company_brief.js';
import { generateFlashcards } from '../../src/core/generation/flashcard_generator.js';
import { extractRoleFromJD } from '../../src/core/extraction/jd_extractor.js';
import { KitStateManager } from '../../src/core/builder/state_manager.js';
import { CrawlResult } from '../../src/core/crawler/site_crawler.js';
import { Requirement, RoleBreakdown, Question, PrepKit } from '../../src/core/types/kit.js';

describe('LLM Client & Generators with Mocked LLM', () => {
  it('handles LLMClient when not configured', async () => {
    const unconfigured = new ResilientLLMClient({ apiKey: '' });
    expect(unconfigured.isConfigured).toBe(false);
    await expect(unconfigured.generate('test')).rejects.toThrow(/LLM_NOT_CONFIGURED/);
  });

  it('retries on 429 rate limit error with exponential backoff and succeeds', async () => {
    const client = new ResilientLLMClient({
      apiKey: 'test-fake-key',
      maxRetries: 2,
      baseDelayMs: 10,
    });

    let calls = 0;
    const mockGenerateContent = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        const err: any = new Error('Resource exhausted 429');
        err.status = 429;
        throw err;
      }
      return {
        response: { text: () => '{"success": true}' },
      };
    });

    // Mock internal genAI
    (client as any).genAI = {
      getGenerativeModel: () => ({
        generateContent: mockGenerateContent,
      }),
    };

    const text = await client.generate('test prompt');
    expect(calls).toBe(2);
    expect(text).toBe('{"success": true}');

    const parsed = await client.generateJSON<{ success: boolean }>('test prompt');
    expect(parsed.success).toBe(true);
  });

  it('throws error when generateJSON receives invalid JSON', async () => {
    const client = new ResilientLLMClient({ apiKey: 'test-key' });
    vi.spyOn(client, 'generate').mockResolvedValue('not a valid json output');

    await expect(client.generateJSON('prompt')).rejects.toThrow(/LLM_JSON_PARSE_ERROR/);
  });

  it('generates category questions via LLM', async () => {
    const mockClient = new ResilientLLMClient({ apiKey: 'test-key' });
    vi.spyOn(mockClient, 'generateJSON').mockResolvedValue([
      {
        id: 'q1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'Explain React Fiber reconciliation',
        answer_outline: '1. Virtual DOM.\n2. Work loop.',
        difficulty: 3,
      },
    ]);

    const reqs: Requirement[] = [{ id: 'r1', text: 'React', kind: 'technical', priority: 'must' }];
    const role: RoleBreakdown = { title: 'Frontend Engineer', seniority: 'Senior', responsibilities: [], requirements: reqs };

    const questions = await generateCategoryQuestions('technical', reqs, role, 1, {}, mockClient);
    expect(questions.length).toBe(1);
    expect(questions[0].prompt).toContain('React Fiber');
  });

  it('generates targeted questions for gaps in Pass 2 via LLM', async () => {
    const mockClient = new ResilientLLMClient({ apiKey: 'test-key' });
    vi.spyOn(mockClient, 'generateJSON').mockResolvedValue([
      {
        id: 'q10',
        requirement_ids: ['r2'],
        category: 'system-design',
        prompt: 'Targeted question on Kafka streaming architecture',
        answer_outline: 'Partitions, consumer groups, offsets',
        difficulty: 3,
      },
    ]);

    const gapReqs: Requirement[] = [{ id: 'r2', text: 'Kafka streaming', kind: 'technical', priority: 'must' }];
    const role: RoleBreakdown = { title: 'Data Engineer', seniority: 'Senior', responsibilities: [], requirements: gapReqs };

    const questions = await generateTargetedQuestionsForGaps(gapReqs, role, 10, {}, mockClient);
    expect(questions.length).toBe(1);
    expect(questions[0].requirement_ids).toContain('r2');
  });

  it('generates company brief via LLM', async () => {
    const mockClient = new ResilientLLMClient({ apiKey: 'test-key' });
    vi.spyOn(mockClient, 'generateJSON').mockResolvedValue({
      summary: 'Stripe powers online commerce infrastructure.',
      what_they_do: 'Global financial infrastructure and payment APIs.',
    });

    const crawlResult: CrawlResult = {
      baseUrl: 'https://stripe.com',
      reachable: true,
      pagesCrawled: [],
      pagesUsedUrls: ['https://stripe.com'],
      hiringPageFound: true,
      companySummaryText: 'Stripe builds payments',
      hiringProcessText: 'Stripe interview has practical coding',
      errors: [],
    };

    const brief = await generateCompanyBrief('https://stripe.com', crawlResult, 'Staff Engineer', mockClient);
    expect(brief.summary).toContain('Stripe powers');
    expect(brief.what_they_do).toContain('Global financial');
  });

  it('generates flashcards via LLM', async () => {
    const mockClient = new ResilientLLMClient({ apiKey: 'test-key' });
    vi.spyOn(mockClient, 'generateJSON').mockResolvedValue([
      {
        id: 'f1',
        front: 'What is CAP Theorem?',
        back: 'Consistency, Availability, Partition tolerance',
        requirement_ids: ['r1'],
      },
    ]);

    const questions: Question[] = [
      { id: 'q1', prompt: 'CAP theorem', answer_outline: 'Outline', category: 'technical', difficulty: 2, requirement_ids: ['r1'] },
    ];
    const reqs: Requirement[] = [{ id: 'r1', text: 'Distributed systems', kind: 'technical', priority: 'must' }];
    const role: RoleBreakdown = { title: 'Backend Lead', seniority: 'Lead', responsibilities: [], requirements: reqs };

    const flashcards = await generateFlashcards(questions, reqs, role, mockClient);
    expect(flashcards.length).toBe(1);
    expect(flashcards[0].front).toBe('What is CAP Theorem?');
  });

  it('extracts role from JD via LLM and falls back safely on parse failure', async () => {
    const mockClient = new ResilientLLMClient({ apiKey: 'test-key' });
    vi.spyOn(mockClient, 'generateJSON').mockResolvedValue({
      title: 'DevOps Engineer',
      seniority: 'Senior',
      responsibilities: ['Deploy cloud infrastructure'],
      requirements: [
        { id: 'r1', text: 'Kubernetes production clusters', kind: 'technical', priority: 'must' },
      ],
    });

    const result = await extractRoleFromJD('Longer JD text for Senior DevOps Engineer with Kubernetes...', mockClient);
    expect(result.role.title).toBe('DevOps Engineer');
    expect(result.role.requirements.length).toBe(1);

    // Test fallback on error
    vi.spyOn(mockClient, 'generateJSON').mockRejectedValue(new Error('Mocked failure'));
    const fallbackResult = await extractRoleFromJD('Senior Go Developer. Required: 5+ years Go.', mockClient);
    expect(fallbackResult.role.requirements.length).toBeGreaterThanOrEqual(1);
  });

  it('tests KitStateManager regenerating schedule and company_brief', async () => {
    const sampleKit: PrepKit = {
      source: {
        company: 'Acme',
        company_url: 'https://example.com',
        role: 'Engineer',
        location: 'Remote',
        jd_chars: 500,
        researched_at: '2026-09-01T00:00:00Z',
        pages_used: ['https://example.com'],
      },
      company_brief: { summary: 'Old summary', what_they_do: 'Old do', sources: ['https://example.com'] },
      role: {
        title: 'Engineer',
        seniority: 'Mid-Level',
        responsibilities: [],
        requirements: [{ id: 'r1', text: 'Node', kind: 'technical', priority: 'must' }],
      },
      questions: [
        { id: 'q1', prompt: 'Prompt', answer_outline: 'Outline', category: 'technical', difficulty: 2, requirement_ids: ['r1'] },
      ],
      flashcards: [{ id: 'f1', front: 'F', back: 'B', requirement_ids: ['r1'] }],
      schedule: {
        days_available: 2,
        days: [
          { day: 1, focus: 'F1', question_ids: ['q1'], minutes: 45 },
          { day: 2, focus: 'F2', question_ids: ['q1'], minutes: 45 },
        ],
      },
      coverage: { uncovered_requirement_ids: [], passes: 1 },
    };

    // Regenerate schedule
    const scheduleRegen = await KitStateManager.regenerateSection(sampleKit, 'schedule');
    expect(scheduleRegen.schedule.days_available).toBe(2);

    // Regenerate company brief
    const briefRegen = await KitStateManager.regenerateSection(sampleKit, 'company_brief');
    expect(briefRegen.company_brief.sources).toBeDefined();
  });
});
