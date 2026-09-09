import { Flashcard, Question, Requirement, RoleBreakdown } from '../types/kit.js';
import { ResilientLLMClient } from './llm_client.js';

function toText(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) {
    const joined = value.map(v => (typeof v === 'string' ? v : String(v ?? ''))).map(s => s.trim()).filter(Boolean).join('\n');
    if (joined) return joined;
  }
  return fallback;
}

export function generateFlashcardsHeuristic(
  questions: Question[],
  requirements: Requirement[]
): Flashcard[] {
  const flashcards: Flashcard[] = [];
  const reqMap = new Map(requirements.map(r => [r.id, r]));

  questions.forEach((q, idx) => {
    const linkedReq = reqMap.get(q.requirement_ids[0]);
    const topic = linkedReq ? linkedReq.text : 'Software Engineering Core';

    flashcards.push({
      id: `f${idx + 1}`,
      front: `[${q.category.toUpperCase()}] ${q.prompt.length > 120 ? q.prompt.slice(0, 117) + '...' : q.prompt}`,
      back: q.answer_outline,
      requirement_ids: q.requirement_ids,
      _meta: {
        confidence: 3,
        review_count: 0,
      },
    });
  });

  return flashcards;
}

export async function generateFlashcards(
  questions: Question[],
  requirements: Requirement[],
  role: RoleBreakdown,
  llmClient?: ResilientLLMClient
): Promise<Flashcard[]> {
  if (!llmClient || !llmClient.isConfigured || questions.length === 0) {
    return generateFlashcardsHeuristic(questions, requirements);
  }

  const prompt = `
You are an expert interview coach creating high-impact flashcards for active recall practice.
Role: ${role.seniority} ${role.title}

Questions to convert into flashcards:
${JSON.stringify(questions.map(q => ({ id: q.id, prompt: q.prompt, answer_outline: q.answer_outline, requirement_ids: q.requirement_ids })))}

Generate one flashcard for each question.
- "front": Punchy question or conceptual challenge.
- "back": Concise, high-density bulleted recall points (max 4 bullets).
- "requirement_ids": preserve the linked requirement IDs.

Respond ONLY with a JSON array strictly matching:
[
  {
    "id": "f1",
    "front": "...",
    "back": "...",
    "requirement_ids": ["r1"]
  }
]
`;

  try {
    const rawCards = await llmClient.generateJSON<any[]>(prompt);
    if (!Array.isArray(rawCards) || rawCards.length === 0) {
      return generateFlashcardsHeuristic(questions, requirements);
    }

    const existingReqIds = new Set(requirements.map(r => r.id));

    return rawCards.map((fc, idx) => {
      const q = questions[idx] || questions[0];
      const validReqIds = Array.isArray(fc.requirement_ids)
        ? fc.requirement_ids.filter((id: string) => existingReqIds.has(id))
        : [];

      return {
        id: `f${idx + 1}`,
        front: toText(fc.front, q.prompt),
        back: toText(fc.back, q.answer_outline),
        requirement_ids: validReqIds.length > 0 ? validReqIds : q.requirement_ids,
        _meta: {
          confidence: 3,
          review_count: 0,
        },
      };
    });
  } catch (err: any) {
    return generateFlashcardsHeuristic(questions, requirements);
  }
}
