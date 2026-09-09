import { describe, it, expect } from 'vitest';
import { KitStateManager } from '../../src/core/builder/state_manager.js';
import { PrepKit } from '../../src/core/types/kit.js';

describe('State Preservation in The Builder (Section 6)', () => {
  const baseKit: PrepKit = {
    source: {
      company: 'TechCorp',
      company_url: 'https://techcorp.io',
      role: 'Staff Platform Engineer',
      location: 'Hybrid',
      jd_chars: 1500,
      researched_at: '2026-09-01T10:00:00Z',
      pages_used: ['https://techcorp.io'],
    },
    company_brief: {
      summary: 'TechCorp builds developer tooling.',
      what_they_do: 'Cloud developer platforms.',
      sources: ['https://techcorp.io'],
    },
    role: {
      title: 'Staff Platform Engineer',
      seniority: 'Staff',
      responsibilities: ['Architect Kubernetes clusters'],
      requirements: [
        { id: 'r1', text: 'Kubernetes and Istio service mesh', kind: 'technical', priority: 'must' },
        { id: 'r2', text: 'Cross-team technical leadership', kind: 'behavioural', priority: 'must' },
        { id: 'r3', text: 'Terraform IaC automation', kind: 'technical', priority: 'nice' },
      ],
    },
    questions: [
      {
        id: 'q1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'Original AI generated Kubernetes question',
        answer_outline: 'Original outline',
        difficulty: 3,
        _meta: { origin: 'generated', is_edited: false, is_pinned: false },
      },
      {
        id: 'q2',
        requirement_ids: ['r3'],
        category: 'technical',
        prompt: 'Original AI generated Terraform question',
        answer_outline: 'Original outline',
        difficulty: 2,
        _meta: { origin: 'generated', is_edited: false, is_pinned: false },
      },
      {
        id: 'q3',
        requirement_ids: ['r2'],
        category: 'behavioural',
        prompt: 'Original behavioural question',
        answer_outline: 'Original outline',
        difficulty: 2,
        _meta: { origin: 'generated', is_edited: false, is_pinned: false },
      },
    ],
    flashcards: [
      { id: 'f1', front: 'Front', back: 'Back', requirement_ids: ['r1'] },
    ],
    schedule: {
      days_available: 3,
      days: [
        { day: 1, focus: 'K8s', question_ids: ['q1'], minutes: 45 },
        { day: 2, focus: 'Terraform', question_ids: ['q2'], minutes: 45 },
        { day: 3, focus: 'Leadership', question_ids: ['q3'], minutes: 45 },
      ],
    },
    coverage: {
      uncovered_requirement_ids: [],
      passes: 1,
    },
  };

  it('updates a question inline and flags is_edited: true', () => {
    const updated = KitStateManager.updateQuestion(baseKit, 'q1', {
      prompt: 'Custom user modified prompt on Kubernetes CNI plugins',
    });

    const target = updated.questions.find(q => q.id === 'q1');
    expect(target?.prompt).toBe('Custom user modified prompt on Kubernetes CNI plugins');
    expect(target?._meta?.is_edited).toBe(true);
    expect(target?._meta?.last_modified).toBeDefined();
  });

  it('toggles pin state on a question', () => {
    const pinned = KitStateManager.togglePinQuestion(baseKit, 'q2', true);
    const q2 = pinned.questions.find(q => q.id === 'q2');
    expect(q2?._meta?.is_pinned).toBe(true);
  });

  it('adds a custom user-written question and assigns stable id', () => {
    const updated = KitStateManager.addCustomQuestion(baseKit, {
      requirement_ids: ['r1'],
      category: 'technical',
      prompt: 'User written question on eBPF network tracing',
      answer_outline: 'Kernel probes and tracepoints',
      difficulty: 3,
    });

    const added = updated.questions.find(q => q.prompt.includes('eBPF'));
    expect(added).toBeDefined();
    expect(added?.id).toBe('q4');
    expect(added?._meta?.origin).toBe('user');
    expect(added?._meta?.is_pinned).toBe(true);
  });

  it('preserves user-edited and pinned questions when regenerating a category', async () => {
    // 1. Mark q1 as edited
    let modifiedKit = KitStateManager.updateQuestion(baseKit, 'q1', {
      prompt: 'USER EDITED: In-depth Istio mTLS failure debugging',
    });

    // 2. Mark q2 as pinned
    modifiedKit = KitStateManager.togglePinQuestion(modifiedKit, 'q2', true);

    // 3. Regenerate the 'technical' category
    const regenerated = await KitStateManager.regenerateSection(modifiedKit, 'technical');

    // Verification: Both q1 (edited) and q2 (pinned) MUST survive
    const q1 = regenerated.questions.find(q => q.id === 'q1');
    const q2 = regenerated.questions.find(q => q.id === 'q2');

    expect(q1).toBeDefined();
    expect(q1?.prompt).toBe('USER EDITED: In-depth Istio mTLS failure debugging');
    expect(q1?._meta?.is_edited).toBe(true);

    expect(q2).toBeDefined();
    expect(q2?._meta?.is_pinned).toBe(true);

    // Behavioral question q3 in other category must also be untouched
    const q3 = regenerated.questions.find(q => q.id === 'q3');
    expect(q3).toBeDefined();
  });

  it('deletes a question and safely updates schedule without orphan question IDs', () => {
    const updated = KitStateManager.deleteQuestion(baseKit, 'q2');

    expect(updated.questions.some(q => q.id === 'q2')).toBe(false);

    // Ensure schedule has no references to q2
    updated.schedule.days.forEach(day => {
      expect(day.question_ids.includes('q2')).toBe(false);
    });
  });

  it('reorders questions cleanly and reflects order in schedule', () => {
    const newOrder = ['q3', 'q1', 'q2'];
    const reordered = KitStateManager.reorderQuestions(baseKit, newOrder);

    expect(reordered.questions[0].id).toBe('q3');
    expect(reordered.questions[1].id).toBe('q1');
    expect(reordered.questions[2].id).toBe('q2');
  });
});
