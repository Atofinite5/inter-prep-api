import { PrepKit } from '../types/kit.js';
import { SiteCrawler } from '../crawler/site_crawler.js';
import { extractRoleFromJD } from '../extraction/jd_extractor.js';
import { generateCompanyBrief } from '../generation/company_brief.js';
import {
  generateCategoryQuestions,
  generateTargetedQuestionsForGaps,
} from '../generation/question_generator.js';
import { generateFlashcards } from '../generation/flashcard_generator.js';
import { analyzeCoverage, buildCoverageResult } from '../coverage/gap_analyzer.js';
import { allocateSchedule } from '../scheduler/allocator.js';
import { validatePrepKit } from '../validation/schemas.js';
import { ResilientLLMClient } from '../generation/llm_client.js';

export interface PipelineProgressEvent {
  step: string;
  message: string;
  progressPercent: number;
}

export interface PipelineOptions {
  llmClient?: ResilientLLMClient;
  crawlerOptions?: {
    maxPages?: number;
    timeoutMs?: number;
    allowLocalHosts?: boolean;
  };
  onProgress?: (event: PipelineProgressEvent) => void;
  maxCoveragePasses?: number;
}

export interface PipelineInput {
  jd: string;
  companyUrl: string;
  days: number;
  companyName?: string;
  location?: string;
}

/**
 * The Master Pipeline Orchestrator for generating Interview Prep Kits.
 * Executes a deliberate multi-step sequence with genuine feedback loops.
 */
export class PrepKitOrchestrator {
  private llmClient: ResilientLLMClient;

  constructor(llmClient?: ResilientLLMClient) {
    this.llmClient = llmClient || new ResilientLLMClient();
  }

  async generateKit(input: PipelineInput, options: PipelineOptions = {}): Promise<PrepKit> {
    const notify = (step: string, message: string, progressPercent: number) => {
      if (options.onProgress) {
        options.onProgress({ step, message, progressPercent });
      }
    };

    const daysAvailable = Math.max(1, Math.round(input.days || 5));
    const activeLLM = options.llmClient || this.llmClient;
    const maxPasses = options.maxCoveragePasses ?? 2;

    // STEP 1: Ingestion & URL Validation
    notify('ingestion', 'Validating inputs and normalizing job description...', 5);
    const jdChars = input.jd.length;

    // STEP 2: Crawl Company Website
    notify('crawling', `Crawling company site at ${input.companyUrl}...`, 15);
    const crawler = new SiteCrawler(options.crawlerOptions);
    const crawlResult = await crawler.crawl(input.companyUrl);

    if (crawlResult.reachable) {
      notify('crawling', `Retrieved ${crawlResult.pagesCrawled.length} page(s). Hiring page: ${crawlResult.hiringPageFound ? 'found' : 'not found'}.`, 25);
    } else {
      notify('crawling', `Website unreachable (${crawlResult.errors[0]?.error || 'unknown error'}). Proceeding with honest fallback.`, 25);
    }

    // STEP 3: Extract Role Requirements
    notify('extraction', 'Extracting explicit requirements and seniority from job description...', 35);
    const extractionResult = await extractRoleFromJD(input.jd, activeLLM);
    const role = extractionResult.role;

    // Derive company name from URL or input
    let companyName = input.companyName;
    if (!companyName) {
      try {
        const parsed = new URL(crawlResult.baseUrl);
        companyName = parsed.hostname.replace(/^www\./, '').split('.')[0];
        companyName = companyName.charAt(0).toUpperCase() + companyName.slice(1);
      } catch {
        companyName = 'Target Company';
      }
    }

    // STEP 4: Synthesize Company Brief
    notify('brief', 'Synthesizing company brief and hiring process context...', 45);
    const companyBrief = await generateCompanyBrief(
      input.companyUrl,
      crawlResult,
      role.title,
      activeLLM
    );

    // STEP 5: Specialized Category Question Generation (Pass 1)
    notify('questions_pass_1', 'Generating specialized questions across technical, system design, and behavioural categories...', 60);

    const questions: any[] = [];
    let qCounter = 1;

    const generatorOptions = {
      companyContext: companyBrief.summary,
      hiringContext: crawlResult.hiringProcessText,
    };

    // Category 1: Technical Questions
    const techQuestions = await generateCategoryQuestions(
      'technical',
      role.requirements,
      role,
      qCounter,
      generatorOptions,
      activeLLM
    );
    questions.push(...techQuestions);
    qCounter += techQuestions.length;

    // Category 2: System Design Questions
    const sysQuestions = await generateCategoryQuestions(
      'system-design',
      role.requirements,
      role,
      qCounter,
      generatorOptions,
      activeLLM
    );
    questions.push(...sysQuestions);
    qCounter += sysQuestions.length;

    // Category 3: Behavioural Questions
    const behQuestions = await generateCategoryQuestions(
      'behavioural',
      role.requirements,
      role,
      qCounter,
      generatorOptions,
      activeLLM
    );
    questions.push(...behQuestions);
    qCounter += behQuestions.length;

    // Category 4: Company Fit Questions
    const fitQuestions = await generateCategoryQuestions(
      'company-fit',
      role.requirements,
      role,
      qCounter,
      generatorOptions,
      activeLLM
    );
    questions.push(...fitQuestions);
    qCounter += fitQuestions.length;

    // STEP 6: Deterministic Coverage Check & Second Pass
    notify('coverage_check', 'Executing deterministic coverage gap analysis...', 75);
    let passesExecuted = 1;
    let coverageReport = analyzeCoverage(role.requirements, questions);

    // If there are uncovered must-have requirements, trigger Pass 2
    if (coverageReport.uncoveredMustRequirementIds.length > 0 && maxPasses >= 2) {
      notify('questions_pass_2', `Pass 2: Closing coverage gaps for ${coverageReport.uncoveredMustRequirementIds.length} uncovered must-have requirement(s)...`, 80);

      const uncoveredMustReqs = role.requirements.filter(r =>
        coverageReport.uncoveredMustRequirementIds.includes(r.id)
      );

      const gapQuestions = await generateTargetedQuestionsForGaps(
        uncoveredMustReqs,
        role,
        qCounter,
        generatorOptions,
        activeLLM
      );

      questions.push(...gapQuestions);
      qCounter += gapQuestions.length;
      passesExecuted = 2;

      // Re-evaluate coverage after Pass 2
      coverageReport = analyzeCoverage(role.requirements, questions);
    }

    const coverage = buildCoverageResult(role.requirements, questions, passesExecuted);

    // STEP 7: Generate Flashcards
    notify('flashcards', 'Generating flashcards for active recall practice...', 85);
    const flashcards = await generateFlashcards(questions, role.requirements, role, activeLLM);

    // STEP 8: Deterministic Schedule Allocation
    notify('scheduling', `Allocating topics across ${daysAvailable} day(s) based on difficulty and priority...`, 92);
    const schedule = allocateSchedule(questions, role.requirements, daysAvailable);

    // Assemble final kit
    const kit: PrepKit = {
      source: {
        company: companyName,
        company_url: input.companyUrl,
        role: role.title,
        location: input.location || 'Flexible / Remote',
        jd_chars: jdChars,
        researched_at: new Date().toISOString(),
        pages_used: crawlResult.pagesUsedUrls.length > 0 ? crawlResult.pagesUsedUrls : [input.companyUrl],
      },
      company_brief: companyBrief,
      role,
      questions,
      flashcards,
      schedule,
      coverage,
    };

    // STEP 9: Strict Appendix A Validation
    notify('validation', 'Validating kit structure against Appendix A schema...', 98);
    const validationResult = validatePrepKit(kit);
    if (!validationResult.success) {
      throw new Error(`KIT_SCHEMA_VALIDATION_FAILED: ${validationResult.errors.join('; ')}`);
    }

    notify('completed', 'Interview preparation kit successfully generated!', 100);
    return kit;
  }
}
