import { describe, it, expect } from 'vitest';
import { validatePrepKit, validateBatchInput } from '../../src/core/validation/schemas.js';
import { PrepKit } from '../../src/core/types/kit.js';

describe('Schema Validation (Appendix A & Appendix B)', () => {
  const validKit: PrepKit = {
    source: {
      company: 'Acme',
      company_url: 'https://acme.org',
      role: 'Senior Backend Engineer',
      location: 'Remote',
      jd_chars: 1200,
      researched_at: '2026-09-01T09:12:44Z',
      pages_used: ['https://acme.org', 'https://acme.org/careers'],
    },
    company_brief: {
      summary: 'Acme builds distributed infrastructure.',
      what_they_do: 'Cloud computing platforms.',
      sources: ['https://acme.org'],
    },
    role: {
      title: 'Senior Backend Engineer',
      seniority: 'Senior',
      responsibilities: ['Design distributed APIs', 'Scale database clusters'],
      requirements: [
        { id: 'r1', text: '5+ years Node.js', kind: 'technical', priority: 'must' },
        { id: 'r2', text: 'Mentoring junior engineers', kind: 'behavioural', priority: 'must' },
      ],
    },
    questions: [
      {
        id: 'q1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'Explain event loop and worker threads in Node.js',
        answer_outline: '1. Event loop phases.\n2. Worker threads use cases.',
        difficulty: 3,
      },
      {
        id: 'q2',
        requirement_ids: ['r2'],
        category: 'behavioural',
        prompt: 'Describe how you mentor engineers.',
        answer_outline: '1. Active listening.\n2. Goal setting.',
        difficulty: 2,
      },
    ],
    flashcards: [
      {
        id: 'f1',
        front: 'Node.js event loop phases',
        back: 'Timers, pending callbacks, idle/prepare, poll, check, close',
        requirement_ids: ['r1'],
      },
    ],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: 'Node.js Deep Dive', question_ids: ['q1'], minutes: 60 },
        { day: 2, focus: 'Leadership & Mentorship', question_ids: ['q2'], minutes: 45 },
      ],
    },
    coverage: {
      uncovered_requirement_ids: [],
      passes: 1,
    },
  };

  it('validates a correct Appendix A kit successfully', () => {
    const result = validatePrepKit(validKit);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source.company).toBe('Acme');
      expect(result.data.schedule.days_available).toBe(2);
    }
  });

  it('rejects a kit when schedule days count does not match days_available', () => {
    const invalid = {
      ...validKit,
      schedule: {
        days_available: 3, // Mismatch: 3 requested, only 2 provided in days array
        days: validKit.schedule.days,
      },
    };

    const result = validatePrepKit(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some(e => e.includes('must equal days_available'))).toBe(true);
    }
  });

  it('rejects non-integer minutes in schedule', () => {
    const invalid = {
      ...validKit,
      schedule: {
        days_available: 2,
        days: [
          { day: 1, focus: 'Test', question_ids: ['q1'], minutes: 60.5 }, // Non-integer
          { day: 2, focus: 'Test 2', question_ids: ['q2'], minutes: 45 },
        ],
      },
    };

    const result = validatePrepKit(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects schedule referencing non-existent question_id', () => {
    const invalid = {
      ...validKit,
      schedule: {
        days_available: 2,
        days: [
          { day: 1, focus: 'Test', question_ids: ['q_non_existent'], minutes: 60 },
          { day: 2, focus: 'Test 2', question_ids: ['q2'], minutes: 45 },
        ],
      },
    };

    const result = validatePrepKit(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some(e => e.includes('non-existent question id'))).toBe(true);
    }
  });

  it('rejects question referencing non-existent requirement id', () => {
    const invalid = {
      ...validKit,
      questions: [
        {
          ...validKit.questions[0],
          requirement_ids: ['r_does_not_exist'],
        },
        validKit.questions[1],
      ],
    };

    const result = validatePrepKit(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some(e => e.includes('non-existent requirement id'))).toBe(true);
    }
  });

  it('validates Appendix B batch input schema', () => {
    const validBatchInput = [
      { id: 'case-01', jd: 'Senior Engineer text...', company_url: 'https://acme.org', days: 5 },
      { id: 'case-02', jd: 'Frontend Engineer text...', company_url: 'http://localhost:8099/acme/', days: 3 },
    ];

    const result = validateBatchInput(validBatchInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(2);
    }
  });

  it('rejects invalid batch input with missing fields or negative days', () => {
    const invalidBatch = [
      { id: 'case-01', jd: 'text', company_url: 'https://acme.org', days: -1 }, // Negative days
    ];

    const result = validateBatchInput(invalidBatch);
    expect(result.success).toBe(false);
  });
});
