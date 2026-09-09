import { describe, it, expect } from 'vitest';
import { PracticeEngine } from '../../src/core/practice/practice_engine.js';
import { Flashcard, Requirement } from '../../src/core/types/kit.js';

describe('Practice Engine (Active Recall & Confidence Sorting)', () => {
  const requirements: Requirement[] = [
    { id: 'r1', text: 'React hooks and fiber architecture', kind: 'technical', priority: 'must' },
    { id: 'r2', text: 'Database indexes and EXPLAIN analysis', kind: 'technical', priority: 'must' },
  ];

  const flashcards: Flashcard[] = [
    { id: 'f1', front: 'What is React Fiber?', back: 'Reconciliation algorithm...', requirement_ids: ['r1'] },
    { id: 'f2', front: 'How B-Tree indexes work?', back: 'Balanced tree with logarithmic lookup...', requirement_ids: ['r2'] },
    { id: 'f3', front: 'Explain useEffect cleanup', back: 'Runs before unmount or next effect...', requirement_ids: ['r1'] },
  ];

  it('records confidence and increments review count', () => {
    const card = flashcards[0];
    const updated = PracticeEngine.recordConfidence(card, 2);

    expect(updated._meta?.confidence).toBe(2);
    expect(updated._meta?.review_count).toBe(1);
    expect(updated._meta?.last_reviewed).toBeDefined();
  });

  it('prioritizes deck: unreviewed and low-confidence cards appear first', () => {
    // f1: confidence 5 (Mastered)
    const f1 = PracticeEngine.recordConfidence(flashcards[0], 5);
    // f2: confidence 1 (Struggled)
    const f2 = PracticeEngine.recordConfidence(flashcards[1], 1);
    // f3: unreviewed (no confidence recorded yet)
    const f3 = flashcards[2];

    const prioritized = PracticeEngine.prioritizeDeck([f1, f2, f3]);

    // Unreviewed (f3) and struggled (f2) must appear before mastered (f1)
    expect(prioritized[prioritized.length - 1].id).toBe('f1');
    expect(prioritized.slice(0, 2).map(c => c.id)).toContain('f2');
    expect(prioritized.slice(0, 2).map(c => c.id)).toContain('f3');
  });

  it('computes session stats accurately and flags weakest requirements', () => {
    const reviewedCards = [
      PracticeEngine.recordConfidence(flashcards[0], 4), // r1, high
      PracticeEngine.recordConfidence(flashcards[1], 1), // r2, very low
      flashcards[2], // unreviewed
    ];

    const stats = PracticeEngine.computeStats(reviewedCards, requirements);

    expect(stats.totalCards).toBe(3);
    expect(stats.reviewedCards).toBe(2);
    expect(stats.unreviewedCards).toBe(1);
    expect(stats.averageConfidence).toBe(2.5); // (4+1)/2
    expect(stats.weakestRequirementIds).toContain('r2');
  });
});
