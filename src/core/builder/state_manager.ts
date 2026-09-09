import { PrepKit, Question, QuestionCategory, Flashcard, CompanyBrief } from '../types/kit.js';
import { generateCategoryQuestions } from '../generation/question_generator.js';
import { generateCompanyBrief } from '../generation/company_brief.js';
import { SiteCrawler } from '../crawler/site_crawler.js';
import { allocateSchedule } from '../scheduler/allocator.js';
import { buildCoverageResult } from '../coverage/gap_analyzer.js';
import { validatePrepKit } from '../validation/schemas.js';
import { ResilientLLMClient } from '../generation/llm_client.js';

export interface RegenerationOptions {
  llmClient?: ResilientLLMClient;
}

/**
 * State Manager for The Builder.
 * Solves the state preservation problem: user edits, custom questions, and pinned items
 * survive section and category regenerations.
 */
export class KitStateManager {
  /**
   * Updates an existing question inline and flags it as user-edited.
   */
  static updateQuestion(
    kit: PrepKit,
    questionId: string,
    updates: Partial<Pick<Question, 'prompt' | 'answer_outline' | 'difficulty' | 'category' | 'requirement_ids'>>
  ): PrepKit {
    const updatedQuestions = kit.questions.map(q => {
      if (q.id !== questionId) return q;

      return {
        ...q,
        ...updates,
        _meta: {
          ...q._meta,
          is_edited: true,
          last_modified: new Date().toISOString(),
        },
      };
    });

    const updatedCoverage = buildCoverageResult(kit.role.requirements, updatedQuestions, kit.coverage.passes);
    const updatedSchedule = allocateSchedule(updatedQuestions, kit.role.requirements, kit.schedule.days_available);

    const newKit: PrepKit = {
      ...kit,
      questions: updatedQuestions,
      coverage: updatedCoverage,
      schedule: updatedSchedule,
    };

    validatePrepKit(newKit);
    return newKit;
  }

  /**
   * Toggles pinned status for a question.
   */
  static togglePinQuestion(kit: PrepKit, questionId: string, isPinned?: boolean): PrepKit {
    const updatedQuestions = kit.questions.map(q => {
      if (q.id !== questionId) return q;
      const nextPinState = isPinned !== undefined ? isPinned : !q._meta?.is_pinned;
      return {
        ...q,
        _meta: {
          ...q._meta,
          is_pinned: nextPinState,
        },
      };
    });

    return { ...kit, questions: updatedQuestions };
  }

  /**
   * Adds a custom question written by the user.
   */
  static addCustomQuestion(
    kit: PrepKit,
    questionData: Omit<Question, 'id' | '_meta'>
  ): PrepKit {
    // Determine next sequential ID
    const maxIdNum = kit.questions.reduce((max, q) => {
      const match = q.id.match(/^q(\d+)$/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0);

    const newQuestion: Question = {
      ...questionData,
      id: `q${maxIdNum + 1}`,
      _meta: {
        origin: 'user',
        is_edited: true,
        is_pinned: true,
        last_modified: new Date().toISOString(),
      },
    };

    const updatedQuestions = [...kit.questions, newQuestion];
    const updatedCoverage = buildCoverageResult(kit.role.requirements, updatedQuestions, kit.coverage.passes);
    const updatedSchedule = allocateSchedule(updatedQuestions, kit.role.requirements, kit.schedule.days_available);

    const newKit: PrepKit = {
      ...kit,
      questions: updatedQuestions,
      coverage: updatedCoverage,
      schedule: updatedSchedule,
    };

    validatePrepKit(newKit);
    return newKit;
  }

  /**
   * Deletes a question and adjusts coverage and schedule accordingly.
   */
  static deleteQuestion(kit: PrepKit, questionId: string): PrepKit {
    const updatedQuestions = kit.questions.filter(q => q.id !== questionId);
    const updatedCoverage = buildCoverageResult(kit.role.requirements, updatedQuestions, kit.coverage.passes);
    const updatedSchedule = allocateSchedule(updatedQuestions, kit.role.requirements, kit.schedule.days_available);

    const newKit: PrepKit = {
      ...kit,
      questions: updatedQuestions,
      coverage: updatedCoverage,
      schedule: updatedSchedule,
    };

    validatePrepKit(newKit);
    return newKit;
  }

  /**
   * Reorders questions or moves questions across categories.
   */
  static reorderQuestions(kit: PrepKit, newOrderIds: string[]): PrepKit {
    const questionMap = new Map(kit.questions.map(q => [q.id, q]));
    const reordered: Question[] = [];

    newOrderIds.forEach(id => {
      const q = questionMap.get(id);
      if (q) {
        reordered.push(q);
        questionMap.delete(id);
      }
    });

    // Append any remaining questions
    for (const remaining of questionMap.values()) {
      reordered.push(remaining);
    }

    const updatedSchedule = allocateSchedule(reordered, kit.role.requirements, kit.schedule.days_available);
    return {
      ...kit,
      questions: reordered,
      schedule: updatedSchedule,
    };
  }

  /**
   * Regenerates a single section (Company Brief, Schedule, or a specific Question Category)
   * while STRICTLY preserving user-edited and pinned questions.
   */
  static async regenerateSection(
    kit: PrepKit,
    target: 'company_brief' | 'schedule' | QuestionCategory,
    options: RegenerationOptions = {}
  ): Promise<PrepKit> {
    const llm = options.llmClient || new ResilientLLMClient();

    // TARGET 1: Regenerate Schedule
    if (target === 'schedule') {
      const updatedSchedule = allocateSchedule(kit.questions, kit.role.requirements, kit.schedule.days_available);
      return {
        ...kit,
        schedule: updatedSchedule,
      };
    }

    // TARGET 2: Regenerate Company Brief
    if (target === 'company_brief') {
      const crawler = new SiteCrawler();
      const crawlResult = await crawler.crawl(kit.source.company_url);
      const newBrief = await generateCompanyBrief(
        kit.source.company_url,
        crawlResult,
        kit.role.title,
        llm
      );

      return {
        ...kit,
        company_brief: newBrief,
        source: {
          ...kit.source,
          pages_used: crawlResult.pagesUsedUrls.length > 0 ? crawlResult.pagesUsedUrls : kit.source.pages_used,
          researched_at: new Date().toISOString(),
        },
      };
    }

    // TARGET 3: Regenerate a specific Question Category
    const categoryToRegen = target as QuestionCategory;

    // Separate existing questions in this category into:
    // 1. Preserved (edited, pinned, or user-created)
    // 2. Replaceable (unpinned, unedited AI-generated)
    const otherCategoryQuestions = kit.questions.filter(q => q.category !== categoryToRegen);
    const categoryQuestions = kit.questions.filter(q => q.category === categoryToRegen);

    const preservedUserQuestions = categoryQuestions.filter(
      q => q._meta?.is_edited || q._meta?.is_pinned || q._meta?.origin === 'user'
    );

    // Calculate how many questions to generate
    const targetCount = Math.max(2, categoryQuestions.length);
    const neededNewCount = Math.max(1, targetCount - preservedUserQuestions.length);

    // Find next available question ID number
    const maxIdNum = kit.questions.reduce((max, q) => {
      const match = q.id.match(/^q(\d+)$/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0);

    const freshQuestions = await generateCategoryQuestions(
      categoryToRegen,
      kit.role.requirements,
      kit.role,
      maxIdNum + 1,
      { companyContext: kit.company_brief.summary },
      llm
    );

    // Merge preserved questions with newly generated questions
    const finalCategoryQuestions = [
      ...preservedUserQuestions,
      ...freshQuestions.slice(0, neededNewCount),
    ];

    const allUpdatedQuestions = [...otherCategoryQuestions, ...finalCategoryQuestions];
    const updatedCoverage = buildCoverageResult(kit.role.requirements, allUpdatedQuestions, kit.coverage.passes);
    const updatedSchedule = allocateSchedule(allUpdatedQuestions, kit.role.requirements, kit.schedule.days_available);

    const newKit: PrepKit = {
      ...kit,
      questions: allUpdatedQuestions,
      coverage: updatedCoverage,
      schedule: updatedSchedule,
    };

    validatePrepKit(newKit);
    return newKit;
  }
}
