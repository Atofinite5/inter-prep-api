import { Question, Requirement, Schedule, ScheduleDay } from '../types/kit.js';

export interface SchedulerOptions {
  baseMinutesPerQuestion?: number;
  minimumDayMinutes?: number;
}

/**
 * Deterministic schedule allocator.
 * Distributes interview questions across exactly `days_available` days.
 *
 * Rules enforced:
 * 1. Schedule length equals exactly `days_available`.
 * 2. Every must-have requirement has at least one associated question scheduled.
 * 3. Harder (difficulty 3) and must-have requirements land earlier.
 * 4. Each day has a non-empty focus and positive integer duration in minutes.
 * 5. Every question_id in the schedule must exist in the provided questions list.
 */
export function allocateSchedule(
  questions: Question[],
  requirements: Requirement[],
  daysAvailable: number,
  options: SchedulerOptions = {}
): Schedule {
  if (!Number.isInteger(daysAvailable) || daysAvailable < 1) {
    throw new Error(`days_available must be a positive integer, received: ${daysAvailable}`);
  }

  if (questions.length === 0) {
    // Edge case: No questions generated (e.g. completely empty input)
    return {
      days_available: daysAvailable,
      days: Array.from({ length: daysAvailable }, (_, idx) => ({
        day: idx + 1,
        focus: idx === 0 ? 'Role & Background Overview' : 'General Preparation & Review',
        question_ids: [],
        minutes: 45,
      })),
    };
  }

  const baseMinutesPerQuestion = options.baseMinutesPerQuestion ?? 15;
  const minimumDayMinutes = options.minimumDayMinutes ?? 45;

  // Build lookup maps
  const mustReqIdSet = new Set(
    requirements.filter(r => r.priority === 'must').map(r => r.id)
  );

  // Score questions for early placement:
  // - Covers must-have requirement: +10 pts per must requirement
  // - High difficulty (3): +6 pts, Medium (2): +3 pts, Low (1): +1 pt
  // - Technical / System Design: +4 pts, Domain: +2 pts, Behavioural: +1 pt, Company-Fit: +0 pt
  function scoreQuestion(q: Question): number {
    let score = 0;
    const mustCount = q.requirement_ids.filter(id => mustReqIdSet.has(id)).length;
    score += mustCount * 10;
    score += q.difficulty * 2;

    switch (q.category) {
      case 'system-design':
        score += 5;
        break;
      case 'technical':
        score += 4;
        break;
      case 'behavioural':
        score += 1;
        break;
      case 'company-fit':
        score += 0;
        break;
    }
    return score;
  }

  // Sort questions in descending order of priority (hardest & must-haves first)
  const sortedQuestions = [...questions].sort((a, b) => scoreQuestion(b) - scoreQuestion(a));

  // Initialize schedule days array
  const scheduleDays: ScheduleDay[] = Array.from({ length: daysAvailable }, (_, idx) => ({
    day: idx + 1,
    focus: '',
    question_ids: [],
    minutes: minimumDayMinutes,
  }));

  // Step 1: Ensure EVERY must-have requirement has its highest-scoring question placed
  const coveredMustReqs = new Set<string>();
  const assignedQuestionIds = new Set<string>();

  // Front-half day ceiling for high-priority items
  const frontDaysCeiling = Math.max(1, Math.ceil(daysAvailable / 2));

  // Group questions by priority for smooth distribution
  if (daysAvailable === 1) {
    // 1-Day Schedule: All questions packed into Day 1
    scheduleDays[0].question_ids = sortedQuestions.map(q => q.id);
    scheduleDays[0].focus = 'Intensive Comprehensive Preparation & Core Requirements Drill';
    scheduleDays[0].minutes = Math.max(90, sortedQuestions.length * baseMinutesPerQuestion);
    return { days_available: 1, days: scheduleDays };
  }

  // Multi-day distribution
  // We distribute sorted questions across days using prioritized bin packing
  // High-score questions go to earlier days (0 to frontDaysCeiling - 1)
  const totalQuestions = sortedQuestions.length;

  if (totalQuestions <= daysAvailable) {
    // Fewer or equal questions than days:
    // Place questions one-by-one in order of score into earlier days
    sortedQuestions.forEach((q, idx) => {
      scheduleDays[idx].question_ids.push(q.id);
    });

    // Later days with no new questions become targeted review/mock days referencing earlier questions
    for (let i = totalQuestions; i < daysAvailable; i++) {
      // Pick key questions from earlier for spaced reinforcement
      const reviewCandidates = sortedQuestions.slice(0, Math.min(3, sortedQuestions.length));
      scheduleDays[i].question_ids = reviewCandidates.map(q => q.id);
    }
  } else {
    // More questions than days:
    // Distribute proportionally, giving heavier weight / harder questions to earlier days
    // Calculate questions per day
    let currentQIndex = 0;
    const basePerDay = Math.floor(totalQuestions / daysAvailable);
    let remainder = totalQuestions % daysAvailable;

    for (let dayIdx = 0; dayIdx < daysAvailable; dayIdx++) {
      // Earlier days take the remainder first (front-loading)
      const countForThisDay = basePerDay + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;

      const chunk = sortedQuestions.slice(currentQIndex, currentQIndex + countForThisDay);
      scheduleDays[dayIdx].question_ids = chunk.map(q => q.id);
      currentQIndex += countForThisDay;
    }
  }

  // Step 2: Assign descriptive thematic focuses based on assigned questions and day position
  const questionMap = new Map(questions.map(q => [q.id, q]));

  scheduleDays.forEach(day => {
    const dayQuestions = day.question_ids
      .map(id => questionMap.get(id))
      .filter((q): q is Question => Boolean(q));

    // Determine primary category for focus title
    const categoryCounts: Record<string, number> = {};
    dayQuestions.forEach(q => {
      categoryCounts[q.category] = (categoryCounts[q.category] || 0) + 1;
    });

    const dominantCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

    // Formulate focus title
    if (day.day === 1) {
      day.focus = 'High-Priority Technical Deep Dive & Must-Have Competencies';
    } else if (day.day === daysAvailable) {
      day.focus = 'Final Mock Interview Simulation & Company Values Alignment';
    } else if (dominantCategory === 'system-design') {
      day.focus = 'System Architecture, Scalability & Trade-Off Analysis';
    } else if (dominantCategory === 'technical') {
      day.focus = 'Core Technical Mastery & Applied Problem Solving';
    } else if (dominantCategory === 'behavioural') {
      day.focus = 'Behavioural Scenarios, Leadership & Cross-Functional Collaboration';
    } else if (dominantCategory === 'company-fit') {
      day.focus = 'Company Culture, Product Vision & Strategic Alignment';
    } else {
      day.focus = `Structured Review & Requirement Mastery (Session ${day.day})`;
    }

    // Step 3: Compute integer duration in minutes
    // Each question adds baseMinutesPerQuestion, with minimumDayMinutes floor
    const calculatedMinutes = Math.max(
      minimumDayMinutes,
      day.question_ids.length * baseMinutesPerQuestion
    );
    // Ensure integer minutes
    day.minutes = Math.round(calculatedMinutes);
  });

  return {
    days_available: daysAvailable,
    days: scheduleDays,
  };
}
