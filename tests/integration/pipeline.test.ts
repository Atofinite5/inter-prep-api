import { describe, it, expect } from 'vitest';
import { PrepKitOrchestrator } from '../../src/core/pipeline/orchestrator.js';
import { validatePrepKit } from '../../src/core/validation/schemas.js';

describe('PrepKitOrchestrator Integration Pipeline', () => {
  const orchestrator = new PrepKitOrchestrator();

  it('runs the full generation pipeline for a standard JD and outputs valid Appendix A kit', async () => {
    const jd = `
      Senior Backend Engineer - Payments
      About the Role:
      We are looking for a Senior Backend Engineer to join our payments platform team.
      Requirements:
      - 5+ years of experience with Node.js and TypeScript (Required)
      - Experience with PostgreSQL schema design and indexing (Required)
      - Strong knowledge of event-driven architectures and RabbitMQ or Kafka (Required)
      - Experience mentoring mid-level and junior engineers (Required)
      - Familiarity with Stripe API or fintech compliance (Bonus)
    `;

    const progressEvents: string[] = [];

    const kit = await orchestrator.generateKit(
      {
        jd,
        companyUrl: 'https://example.com',
        days: 5,
        companyName: 'Example Corp',
      },
      {
        crawlerOptions: { allowLocalHosts: true },
        onProgress: evt => progressEvents.push(evt.step),
      }
    );

    // Verify progress sequence executed
    expect(progressEvents).toContain('ingestion');
    expect(progressEvents).toContain('extraction');
    expect(progressEvents).toContain('questions_pass_1');
    expect(progressEvents).toContain('coverage_check');
    expect(progressEvents).toContain('scheduling');
    expect(progressEvents).toContain('completed');

    // Strict validation
    const validation = validatePrepKit(kit);
    expect(validation.success).toBe(true);

    // Verify properties
    expect(kit.schedule.days_available).toBe(5);
    expect(kit.schedule.days.length).toBe(5);
    expect(kit.role.requirements.length).toBeGreaterThanOrEqual(4);
    expect(kit.questions.length).toBeGreaterThanOrEqual(4);
    expect(kit.flashcards.length).toBeGreaterThanOrEqual(4);

    // Verify every must-have requirement appears in schedule
    const mustReqIds = kit.role.requirements.filter(r => r.priority === 'must').map(r => r.id);
    const scheduledReqIds = new Set<string>();
    const qMap = new Map(kit.questions.map(q => [q.id, q]));

    kit.schedule.days.forEach(day => {
      day.question_ids.forEach(qId => {
        qMap.get(qId)?.requirement_ids.forEach(rId => scheduledReqIds.add(rId));
      });
    });

    mustReqIds.forEach(id => {
      expect(scheduledReqIds.has(id)).toBe(true);
    });
  });

  it('handles a thin two-line stub JD honestly without hallucinating requirements', async () => {
    const thinJD = `
      Senior Developer needed.
      Must know Go and PostgreSQL.
    `;

    const kit = await orchestrator.generateKit(
      {
        jd: thinJD,
        companyUrl: 'https://example.com',
        days: 3,
      },
      { crawlerOptions: { allowLocalHosts: true } }
    );

    const validation = validatePrepKit(kit);
    expect(validation.success).toBe(true);

    // Should only have 2 or 3 requirements faithfully extracted
    expect(kit.role.requirements.length).toBeLessThanOrEqual(4);
    expect(kit.role.requirements.some(r => r.text.includes('Go') || r.text.includes('PostgreSQL'))).toBe(true);
  });

  it('handles unreachable company URL gracefully with an honest brief and valid kit', async () => {
    const kit = await orchestrator.generateKit(
      {
        jd: 'Full Stack Engineer with React and Node.js. 3+ years required.',
        companyUrl: 'http://this-domain-does-not-exist-12345678.invalid',
        days: 2,
      },
      {
        crawlerOptions: {
          timeoutMs: 1000,
          allowLocalHosts: true,
        },
      }
    );

    const validation = validatePrepKit(kit);
    expect(validation.success).toBe(true);

    // Company brief should honestly state the site could not be retrieved
    expect(kit.company_brief.summary.toLowerCase()).toContain('unreachable');
  });
});
