import { Flashcard, Requirement } from '../types/kit.js';

export interface PracticeSessionStats {
  totalCards: number;
  reviewedCards: number;
  unreviewedCards: number;
  averageConfidence: number;
  masteryPercentage: number;
  weakestRequirementIds: string[];
}

/**
 * Practice Engine with confidence-weighted spaced repetition.
 * Cards with lower confidence scores and older review timestamps are surfaced first.
 */
export class PracticeEngine {
  /**
   * Updates a flashcard with the user's self-assessed confidence level (1-5).
   */
  static recordConfidence(
    flashcard: Flashcard,
    confidence: 1 | 2 | 3 | 4 | 5
  ): Flashcard {
    const currentCount = flashcard._meta?.review_count ?? 0;
    return {
      ...flashcard,
      _meta: {
        ...flashcard._meta,
        confidence,
        review_count: currentCount + 1,
        last_reviewed: new Date().toISOString(),
      },
    };
  }

  /**
   * Orders flashcards for an active study session.
   * Priority score:
   * - Unreviewed cards: priority 100 (needs first pass)
   * - Confidence 1 (Struggled): priority 90
   * - Confidence 2 (Hard): priority 75
   * - Confidence 3 (Neutral): priority 50
   * - Confidence 4 (Good): priority 25
   * - Confidence 5 (Mastered): priority 10
   * Older review timestamps add recency urgency.
   */
  static prioritizeDeck(flashcards: Flashcard[]): Flashcard[] {
    const scoredCards = flashcards.map(card => {
      let priorityScore = 0;
      const confidence = card._meta?.confidence;
      const reviewCount = card._meta?.review_count ?? 0;
      const lastReviewed = card._meta?.last_reviewed ? new Date(card._meta.last_reviewed).getTime() : 0;

      if (reviewCount === 0 || !confidence) {
        priorityScore = 100;
      } else {
        // Base priority inversely proportional to confidence
        priorityScore = (6 - confidence) * 18;

        // Add recency penalty (the longer since review, the higher the priority to review again)
        const hoursSinceReview = (Date.now() - lastReviewed) / (1000 * 60 * 60);
        priorityScore += Math.min(20, hoursSinceReview * 0.5);
      }

      return { card, priorityScore };
    });

    return scoredCards
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .map(item => item.card);
  }

  /**
   * Calculates overall readiness and mastery statistics.
   */
  static computeStats(
    flashcards: Flashcard[],
    requirements: Requirement[] = []
  ): PracticeSessionStats {
    if (flashcards.length === 0) {
      return {
        totalCards: 0,
        reviewedCards: 0,
        unreviewedCards: 0,
        averageConfidence: 0,
        masteryPercentage: 0,
        weakestRequirementIds: [],
      };
    }

    let reviewedCount = 0;
    let confidenceSum = 0;
    const reqLowConfidenceCount: Record<string, number> = {};

    flashcards.forEach(card => {
      const conf = card._meta?.confidence;
      if (card._meta?.review_count && conf) {
        reviewedCount++;
        confidenceSum += conf;

        if (conf <= 2) {
          card.requirement_ids.forEach(rId => {
            reqLowConfidenceCount[rId] = (reqLowConfidenceCount[rId] || 0) + 1;
          });
        }
      }
    });

    const averageConfidence = reviewedCount > 0 ? Number((confidenceSum / reviewedCount).toFixed(1)) : 0;
    // Mastery percentage based on percentage of max confidence (5)
    const masteryPercentage = reviewedCount > 0 ? Math.round((averageConfidence / 5) * 100) : 0;

    // Weakest requirement IDs (most low confidence cards)
    const weakestRequirementIds = Object.entries(reqLowConfidenceCount)
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0]);

    return {
      totalCards: flashcards.length,
      reviewedCards: reviewedCount,
      unreviewedCards: flashcards.length - reviewedCount,
      averageConfidence,
      masteryPercentage,
      weakestRequirementIds,
    };
  }
}
