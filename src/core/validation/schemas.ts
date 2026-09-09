import { z } from 'zod';
import { PrepKit } from '../types/kit.js';
import { BatchCaseInput, BatchOutput } from '../types/batch.js';

export const RequirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: z.enum(['technical', 'behavioural', 'domain']),
  priority: z.enum(['must', 'nice']),
});

export const QuestionSchema = z.object({
  id: z.string().min(1),
  requirement_ids: z.array(z.string()),
  category: z.enum(['technical', 'behavioural', 'system-design', 'company-fit']),
  prompt: z.string().min(1),
  answer_outline: z.string().min(1),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  _meta: z.object({
    origin: z.enum(['generated', 'user']).optional(),
    is_edited: z.boolean().optional(),
    is_pinned: z.boolean().optional(),
    last_modified: z.string().optional(),
  }).optional(),
});

export const FlashcardSchema = z.object({
  id: z.string().min(1),
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(z.string()),
  _meta: z.object({
    confidence: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
    last_reviewed: z.string().optional(),
    review_count: z.number().optional(),
  }).optional(),
});

export const ScheduleDaySchema = z.object({
  day: z.number().int().positive(),
  focus: z.string().min(1),
  question_ids: z.array(z.string()),
  minutes: z.number().int().positive(), // Must be integer minutes
});

export const ScheduleSchema = z.object({
  days_available: z.number().int().positive(),
  days: z.array(ScheduleDaySchema),
}).refine(data => data.days.length === data.days_available, {
  message: 'Number of days in schedule must equal days_available',
  path: ['days'],
});

export const SourceSchema = z.object({
  company: z.string(),
  company_url: z.string(),
  role: z.string(),
  location: z.string(),
  jd_chars: z.number().int().nonnegative(),
  researched_at: z.string(),
  pages_used: z.array(z.string()),
});

export const CompanyBriefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
  sources: z.array(z.string()),
});

export const RoleBreakdownSchema = z.object({
  title: z.string(),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(RequirementSchema),
});

export const CoverageSchema = z.object({
  uncovered_requirement_ids: z.array(z.string()),
  passes: z.number().int().nonnegative(),
});

export const PrepKitSchema = z.object({
  source: SourceSchema,
  company_brief: CompanyBriefSchema,
  role: RoleBreakdownSchema,
  questions: z.array(QuestionSchema),
  flashcards: z.array(FlashcardSchema),
  schedule: ScheduleSchema,
  coverage: CoverageSchema,
}).superRefine((data, ctx) => {
  // Validate that all question_ids in the schedule refer to questions that exist
  const existingQuestionIds = new Set(data.questions.map(q => q.id));
  data.schedule.days.forEach((day, dayIndex) => {
    day.question_ids.forEach((qId, qIndex) => {
      if (!existingQuestionIds.has(qId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Schedule day ${day.day} references non-existent question id "${qId}"`,
          path: ['schedule', 'days', dayIndex, 'question_ids', qIndex],
        });
      }
    });
  });

  // Validate that requirement_ids in questions refer to requirements that exist
  const existingReqIds = new Set(data.role.requirements.map(r => r.id));
  data.questions.forEach((q, qIndex) => {
    q.requirement_ids.forEach((reqId, rIndex) => {
      if (!existingReqIds.has(reqId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Question "${q.id}" references non-existent requirement id "${reqId}"`,
          path: ['questions', qIndex, 'requirement_ids', rIndex],
        });
      }
    });
  });
});

export const BatchCaseInputSchema = z.object({
  id: z.string().min(1),
  jd: z.string().min(1),
  company_url: z.string().min(1),
  days: z.number().int().positive(),
});

export const BatchInputSchema = z.array(BatchCaseInputSchema);

export const BatchErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const BatchKitResultSchema = z.object({
  id: z.string(),
  status: z.enum(['ok', 'failed']),
  kit: PrepKitSchema.nullable(),
  error: BatchErrorSchema.nullable(),
});

export const BatchOutputSchema = z.object({
  version: z.string(),
  generated_at: z.string(),
  kits: z.array(BatchKitResultSchema),
});

export function validatePrepKit(data: unknown): { success: true; data: PrepKit } | { success: false; errors: string[] } {
  const result = PrepKitSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data as PrepKit };
  }
  return {
    success: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}

export function validateBatchInput(data: unknown): { success: true; data: BatchCaseInput[] } | { success: false; errors: string[] } {
  const result = BatchInputSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}
