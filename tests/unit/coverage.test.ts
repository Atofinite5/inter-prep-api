import { describe, it, expect } from 'vitest';
import { analyzeCoverage, buildCoverageResult } from '../../src/core/coverage/gap_analyzer.js';
import { Question, Requirement } from '../../src/core/types/kit.js';

describe('Coverage Gap Analyzer (Deterministic Analysis)', () => {
  const requirements: Requirement[] = [
    { id: 'r1', text: '5+ years Node.js', kind: 'technical', priority: 'must' },
    { id: 'r2', text: 'PostgreSQL optimization', kind: 'technical', priority: 'must' },
    { id: 'r3', text: 'Mentoring junior devs', kind: 'behavioural', priority: 'must' },
    { id: 'r4', text: 'GraphQL experience', kind: 'technical', priority: 'nice' },
  ];

  it('correctly reports full coverage when all requirements are addressed', () => {
    const questions: Question[] = [
      { id: 'q1', requirement_ids: ['r1', 'r2'], category: 'technical', prompt: 'P1', answer_outline: 'A1', difficulty: 3 },
      { id: 'q2', requirement_ids: ['r3'], category: 'behavioural', prompt: 'P2', answer_outline: 'A2', difficulty: 2 },
      { id: 'q3', requirement_ids: ['r4'], category: 'technical', prompt: 'P3', answer_outline: 'A3', difficulty: 1 },
    ];

    const report = analyzeCoverage(requirements, questions);
    expect(report.uncoveredMustRequirementIds).toEqual([]);
    expect(report.allUncoveredRequirementIds).toEqual([]);
    expect(report.coveragePercentage).toBe(100);
    expect(report.coveredMustCount).toBe(3);

    const result = buildCoverageResult(requirements, questions, 1);
    expect(result.uncovered_requirement_ids).toEqual([]);
    expect(result.passes).toBe(1);
  });

  it('detects uncovered must-have requirements as critical gaps', () => {
    // Missing r2 (must) and r4 (nice)
    const questions: Question[] = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'P1', answer_outline: 'A1', difficulty: 3 },
      { id: 'q2', requirement_ids: ['r3'], category: 'behavioural', prompt: 'P2', answer_outline: 'A2', difficulty: 2 },
    ];

    const report = analyzeCoverage(requirements, questions);
    expect(report.uncoveredMustRequirementIds).toEqual(['r2']);
    expect(report.uncoveredNiceRequirementIds).toEqual(['r4']);
    expect(report.allUncoveredRequirementIds).toEqual(['r2', 'r4']);
    expect(report.coveredMustCount).toBe(2);
    expect(report.mustRequirementsCount).toBe(3);
    expect(report.coveragePercentage).toBe(50);

    const result = buildCoverageResult(requirements, questions, 2);
    expect(result.uncovered_requirement_ids).toEqual(['r2', 'r4']);
    expect(result.passes).toBe(2);
  });

  it('handles empty questions list without errors', () => {
    const report = analyzeCoverage(requirements, []);
    expect(report.uncoveredMustRequirementIds).toEqual(['r1', 'r2', 'r3']);
    expect(report.allUncoveredRequirementIds.length).toBe(4);
    expect(report.coveragePercentage).toBe(0);
  });

  it('handles empty requirements list', () => {
    const report = analyzeCoverage([], []);
    expect(report.coveragePercentage).toBe(100);
    expect(report.allUncoveredRequirementIds).toEqual([]);
  });
});
