import { Question, QuestionCategory, QuestionDifficulty, Requirement, RoleBreakdown } from '../types/kit.js';
import { ResilientLLMClient } from './llm_client.js';

export interface QuestionGeneratorOptions {
  companyContext?: string;
  hiringContext?: string;
}

/**
 * LLMs (notably Gemini via OpenRouter) often return bullet lists as arrays
 * instead of strings. Coerce to the string shape Appendix A requires.
 */
function toTextField(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (Array.isArray(value)) {
    const joined = value
      .map(v =>
        typeof v === 'string' ? v : v != null ? String(v) : ''
      )
      .map(s => s.trim())
      .filter(Boolean)
      .join('\n');
    if (joined) return joined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

/**
 * Deterministic heuristic fallback generator when LLM is unavailable (e.g. headless unit tests).
 */
export function generateQuestionsHeuristic(
  requirements: Requirement[],
  role: RoleBreakdown,
  category: QuestionCategory,
  startIdNumber = 1
): Question[] {
  const matchingReqs = requirements.filter(r => {
    if (category === 'technical') return r.kind === 'technical';
    if (category === 'behavioural') return r.kind === 'behavioural';
    if (category === 'system-design') return r.kind === 'technical' || r.kind === 'domain';
    return true;
  });

  const targetReqs = matchingReqs.length > 0 ? matchingReqs : requirements.slice(0, 2);
  const questions: Question[] = [];

  targetReqs.forEach((req, idx) => {
    const qNum = startIdNumber + idx;
    let prompt = '';
    let answerOutline = '';
    let difficulty: QuestionDifficulty = req.priority === 'must' ? 3 : 2;

    switch (category) {
      case 'technical':
        prompt = `Explain your hands-on experience and underlying architectural principles regarding: "${req.text}". What trade-offs have you managed in production?`;
        answerOutline = `1. Core mechanics and lifecycle principles.\n2. Real-world edge cases and failure modes.\n3. Performance optimization and benchmarking strategies.\n4. Specific project experience and lessons learned.`;
        break;
      case 'system-design':
        prompt = `How would you design a scalable, fault-tolerant subsystem that addresses: "${req.text}" for a high-throughput environment?`;
        answerOutline = `1. Requirements breakdown (functional & non-functional: latency, throughput, availability).\n2. High-level architecture (data stores, caching, event streaming).\n3. Bottlenecks and partition strategies.\n4. Monitoring, failover, and disaster recovery.`;
        difficulty = 3;
        break;
      case 'behavioural':
        prompt = `Describe a situation where you had to demonstrate: "${req.text}". How did you navigate challenges and align team stakeholders?`;
        answerOutline = `1. Situation: Context and initial business constraints.\n2. Task: Exact responsibility and ownership boundaries.\n3. Action: Specific proactive steps taken, conflict resolution, and communication.\n4. Result: Quantifiable outcome and team impact.`;
        difficulty = 2;
        break;
      case 'company-fit':
        prompt = `How does your engineering approach align with the company mission when executing on "${req.text}"?`;
        answerOutline = `1. Demonstrated personal resonance with team values.\n2. Collaborative work ethic and feedback receptivity.\n3. Pragmatic balance between technical purity and business velocity.`;
        difficulty = 1;
        break;
    }

    questions.push({
      id: `q${qNum}`,
      requirement_ids: [req.id],
      category,
      prompt,
      answer_outline: answerOutline,
      difficulty,
      _meta: {
        origin: 'generated',
        is_edited: false,
        is_pinned: false,
      },
    });
  });

  return questions;
}

/**
 * Generates questions for a specific category using dedicated instructions.
 */
export async function generateCategoryQuestions(
  category: QuestionCategory,
  requirements: Requirement[],
  role: RoleBreakdown,
  startIdNumber: number,
  options: QuestionGeneratorOptions = {},
  llmClient?: ResilientLLMClient
): Promise<Question[]> {
  // Filter requirements relevant to this category
  let relevantReqs = requirements.filter(r => {
    if (category === 'technical') return r.kind === 'technical';
    if (category === 'behavioural') return r.kind === 'behavioural';
    if (category === 'system-design') return r.kind === 'technical' || r.kind === 'domain';
    if (category === 'company-fit') return true;
    return true;
  });

  if (relevantReqs.length === 0) {
    relevantReqs = requirements.slice(0, 2);
  }

  if (!llmClient || !llmClient.isConfigured) {
    return generateQuestionsHeuristic(relevantReqs, role, category, startIdNumber);
  }

  const categoryInstructions: Record<QuestionCategory, string> = {
    'technical': `Focus deeply on language/framework internals, real-world bug debugging, performance bottlenecks, and testing strategies. Ask probing questions tailored to ${role.seniority} level.`,
    'system-design': `Focus on system architecture, data modeling, high availability, concurrency, caching, and API design trade-offs relevant to ${role.title}.`,
    'behavioural': `Focus on leadership, ambiguity handling, cross-functional collaboration, conflict resolution, and mentoring using the STAR methodology.`,
    'company-fit': `Focus on engineering culture, product intuition, remote work dynamics, and alignment with company operating principles.`,
  };

  const prompt = `
You are an expert technical interviewer conducting an interview for:
Role: ${role.seniority} ${role.title}
Category: ${category.toUpperCase()}

Category Focus:
${categoryInstructions[category]}

Company & Hiring Context:
${options.companyContext || 'Standard high-performing technology company.'}
${options.hiringContext ? `Hiring Process Notes: ${options.hiringContext}` : ''}

Applicable Requirements to cover:
${JSON.stringify(relevantReqs.map(r => ({ id: r.id, text: r.text, priority: r.priority })))}

Instructions:
Generate 2 to 4 high-yield interview questions for this category.
- Every question MUST reference at least one requirement id from the list above in "requirement_ids".
- "difficulty" must be 1 (basic/warmup), 2 (standard mid-level), or 3 (complex/senior deep dive).
- "prompt" MUST be a single string.
- "answer_outline" MUST be a single string with newline-separated bullets (NOT a JSON array).

Respond ONLY with a JSON array strictly matching this schema:
[
  {
    "id": "q${startIdNumber}",
    "requirement_ids": ["r1"],
    "category": "${category}",
    "prompt": "...",
    "answer_outline": "...",
    "difficulty": 2
  }
]
`;

  try {
    const rawQuestions = await llmClient.generateJSON<any[]>(prompt);
    if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
      return generateQuestionsHeuristic(relevantReqs, role, category, startIdNumber);
    }

    const existingReqIds = new Set(requirements.map(r => r.id));

    return rawQuestions.map((q, idx) => {
      // Ensure requirement_ids are valid
      const validReqIds = Array.isArray(q.requirement_ids)
        ? q.requirement_ids.filter((id: string) => existingReqIds.has(id))
        : [];

      return {
        id: `q${startIdNumber + idx}`,
        requirement_ids: validReqIds.length > 0 ? validReqIds : [relevantReqs[0]?.id || 'r1'],
        category,
        prompt: toTextField(q.prompt, `Explain key engineering considerations for ${role.title}.`),
        answer_outline: toTextField(q.answer_outline, '1. Core concepts.\n2. Applied implementation.\n3. Trade-offs.'),
        difficulty: ([1, 2, 3].includes(q.difficulty) ? q.difficulty : 2) as QuestionDifficulty,
        _meta: {
          origin: 'generated',
          is_edited: false,
          is_pinned: false,
        },
      };
    });
  } catch (err: any) {
    console.warn(`[QuestionGenerator] LLM failed for category ${category} (${err.message}). Using heuristic.`);
    return generateQuestionsHeuristic(relevantReqs, role, category, startIdNumber);
  }
}

/**
 * Pass 2 Targeted Generator: Generates targeted questions specifically covering missing requirements.
 */
export async function generateTargetedQuestionsForGaps(
  uncoveredRequirements: Requirement[],
  role: RoleBreakdown,
  startIdNumber: number,
  options: QuestionGeneratorOptions = {},
  llmClient?: ResilientLLMClient
): Promise<Question[]> {
  if (uncoveredRequirements.length === 0) return [];

  if (!llmClient || !llmClient.isConfigured) {
    const questions: Question[] = [];
    uncoveredRequirements.forEach((req, idx) => {
      const category: QuestionCategory = req.kind === 'behavioural'
        ? 'behavioural'
        : (req.text.toLowerCase().includes('design') || req.text.toLowerCase().includes('architect'))
        ? 'system-design'
        : 'technical';

      questions.push(...generateQuestionsHeuristic([req], role, category, startIdNumber + idx));
    });
    return questions;
  }

  const prompt = `
CRITICAL SECOND-PASS RECOVERY:
The following high-priority job requirements currently have NO interview questions covering them:
${JSON.stringify(uncoveredRequirements.map(r => ({ id: r.id, text: r.text, kind: r.kind, priority: r.priority })))}

Role: ${role.seniority} ${role.title}

Generate exactly ONE rigorous interview question for each uncovered requirement listed above.
- "requirement_ids": MUST include the specific requirement id it targets.
- "category": Choose 'technical', 'behavioural', 'system-design', or 'company-fit' based on the requirement kind.
- "difficulty": 1, 2, or 3.
- "prompt" MUST be a single string.
- "answer_outline" MUST be a single string with newline-separated bullets (NOT a JSON array).

Respond ONLY with a JSON array:
[
  {
    "id": "q${startIdNumber}",
    "requirement_ids": ["rX"],
    "category": "technical",
    "prompt": "...",
    "answer_outline": "...",
    "difficulty": 3
  }
]
`;

  try {
    const rawQuestions = await llmClient.generateJSON<any[]>(prompt);
    if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
      return generateTargetedQuestionsForGaps(uncoveredRequirements, role, startIdNumber, options);
    }

    const reqIdSet = new Set(uncoveredRequirements.map(r => r.id));

    return rawQuestions.map((q, idx) => {
      const targetReq = uncoveredRequirements[idx] || uncoveredRequirements[0];
      const validReqIds = Array.isArray(q.requirement_ids)
        ? q.requirement_ids.filter((id: string) => reqIdSet.has(id))
        : [];

      return {
        id: `q${startIdNumber + idx}`,
        requirement_ids: validReqIds.length > 0 ? validReqIds : [targetReq.id],
        category: (['technical', 'behavioural', 'system-design', 'company-fit'].includes(q.category)
          ? q.category
          : targetReq.kind === 'behavioural' ? 'behavioural' : 'technical') as QuestionCategory,
        prompt: toTextField(q.prompt, `Deep dive: ${targetReq.text}`),
        answer_outline: toTextField(q.answer_outline, '1. Core principles.\n2. Implementation details.\n3. Common failure modes.'),
        difficulty: ([1, 2, 3].includes(q.difficulty) ? q.difficulty : 3) as QuestionDifficulty,
        _meta: {
          origin: 'generated',
          is_edited: false,
          is_pinned: false,
        },
      };
    });
  } catch (err: any) {
    return generateTargetedQuestionsForGaps(uncoveredRequirements, role, startIdNumber, options);
  }
}
