import { describe, it, expect } from 'vitest';
import { allocateSchedule } from '../../src/core/scheduler/allocator.js';
import { Question, Requirement } from '../../src/core/types/kit.js';

describe('Scheduler Allocator (Deterministic Schedule Algorithm)', () => {
  const sampleRequirements: Requirement[] = [
    { id: 'r1', text: '5+ years with React and TypeScript', kind: 'technical', priority: 'must' },
    { id: 'r2', text: 'Distributed systems and Redis caching', kind: 'technical', priority: 'must' },
    { id: 'r3', text: 'Mentoring junior engineers', kind: 'behavioural', priority: 'must' },
    { id: 'r4', text: 'Experience with Kubernetes', kind: 'technical', priority: 'nice' },
  ];

  const sampleQuestions: Question[] = [
    { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'React internals', answer_outline: 'Outline', difficulty: 3 },
    { id: 'q2', requirement_ids: ['r2'], category: 'system-design', prompt: 'Design Redis cache', answer_outline: 'Outline', difficulty: 3 },
    { id: 'q3', requirement_ids: ['r3'], category: 'behavioural', prompt: 'Mentoring experience', answer_outline: 'Outline', difficulty: 2 },
    { id: 'q4', requirement_ids: ['r4'], category: 'technical', prompt: 'Kubernetes pods', answer_outline: 'Outline', difficulty: 2 },
    { id: 'q5', requirement_ids: ['r1'], category: 'company-fit', prompt: 'Why work here?', answer_outline: 'Outline', difficulty: 1 },
  ];

  it('allocates a schedule where number of days equals exactly days_available', () => {
    const daysTests = [1, 2, 5, 7, 14, 30, 60];

    for (const days of daysTests) {
      const schedule = allocateSchedule(sampleQuestions, sampleRequirements, days);
      expect(schedule.days_available).toBe(days);
      expect(schedule.days.length).toBe(days);

      // Verify sequential day numbers
      schedule.days.forEach((day, index) => {
        expect(day.day).toBe(index + 1);
        expect(day.focus).toBeTypeOf('string');
        expect(day.focus.length).toBeGreaterThan(0);
      });
    }
  });

  it('ensures every day duration is an integer in minutes', () => {
    const schedule = allocateSchedule(sampleQuestions, sampleRequirements, 5);

    schedule.days.forEach(day => {
      expect(Number.isInteger(day.minutes)).toBe(true);
      expect(day.minutes).toBeGreaterThan(0);
    });
  });

  it('ensures every scheduled question_id actually exists in the provided questions', () => {
    const schedule = allocateSchedule(sampleQuestions, sampleRequirements, 5);
    const validIds = new Set(sampleQuestions.map(q => q.id));

    schedule.days.forEach(day => {
      day.question_ids.forEach(qId => {
        expect(validIds.has(qId)).toBe(true);
      });
    });
  });

  it('ensures every must-have requirement appears somewhere in the schedule', () => {
    const schedule = allocateSchedule(sampleQuestions, sampleRequirements, 5);
    const qMap = new Map(sampleQuestions.map(q => [q.id, q]));

    const scheduledReqIds = new Set<string>();
    schedule.days.forEach(day => {
      day.question_ids.forEach(qId => {
        const q = qMap.get(qId);
        if (q) {
          q.requirement_ids.forEach(rId => scheduledReqIds.add(rId));
        }
      });
    });

    const mustReqs = sampleRequirements.filter(r => r.priority === 'must');
    mustReqs.forEach(req => {
      expect(scheduledReqIds.has(req.id)).toBe(true);
    });
  });

  it('front-loads harder material (difficulty 3) into earlier days', () => {
    const schedule = allocateSchedule(sampleQuestions, sampleRequirements, 5);
    const qMap = new Map(sampleQuestions.map(q => [q.id, q]));

    // Check that Day 1 contains high difficulty questions
    const day1Difficulties = schedule.days[0].question_ids.map(id => qMap.get(id)?.difficulty || 0);
    const maxDay1Diff = Math.max(...day1Difficulties);
    expect(maxDay1Diff).toBe(3);
  });

  it('handles 1-day crash course schedule by packaging material on Day 1', () => {
    const schedule = allocateSchedule(sampleQuestions, sampleRequirements, 1);
    expect(schedule.days.length).toBe(1);
    expect(schedule.days[0].question_ids.length).toBe(sampleQuestions.length);
    expect(schedule.days[0].focus).toContain('Comprehensive');
    expect(schedule.days[0].minutes).toBeGreaterThanOrEqual(90);
  });

  it('handles empty questions list gracefully without crashing', () => {
    const schedule = allocateSchedule([], sampleRequirements, 3);
    expect(schedule.days.length).toBe(3);
    schedule.days.forEach(day => {
      expect(day.question_ids).toEqual([]);
      expect(Number.isInteger(day.minutes)).toBe(true);
    });
  });

  it('throws descriptive error on invalid non-positive days_available', () => {
    expect(() => allocateSchedule(sampleQuestions, sampleRequirements, 0)).toThrow(/positive integer/);
    expect(() => allocateSchedule(sampleQuestions, sampleRequirements, -3)).toThrow(/positive integer/);
    expect(() => allocateSchedule(sampleQuestions, sampleRequirements, 2.5)).toThrow(/positive integer/);
  });
});
