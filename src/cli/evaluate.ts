#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { BatchCaseInput, BatchOutput, BatchKitResult } from '../core/types/batch.js';
import { validateBatchInput } from '../core/validation/schemas.js';
import { PrepKitOrchestrator } from '../core/pipeline/orchestrator.js';
import { ResilientLLMClient } from '../core/generation/llm_client.js';

// Load environment variables
dotenv.config();

const program = new Command();

program
  .name('evaluate')
  .description('Run interview prep kit pipeline over a batch of cases (Section 9)')
  .requiredOption('-i, --input <path>', 'Path to input cases JSON file')
  .requiredOption('-o, --output <path>', 'Path to output kits JSON file')
  .parse(process.argv);

const options = program.opts();

async function runBatchEvaluation() {
  const inputPath = path.resolve(process.cwd(), options.input);
  const outputPath = path.resolve(process.cwd(), options.output);

  console.log(`[Batch Evaluator] Reading cases from: ${inputPath}`);

  let rawData: string;
  try {
    rawData = await fs.readFile(inputPath, 'utf-8');
  } catch (err: any) {
    console.error(`[Batch Evaluator Fatal] Unable to read input file: ${err.message}`);
    process.exit(1);
  }

  let parsedJson: any;
  try {
    parsedJson = JSON.parse(rawData);
  } catch (err: any) {
    console.error(`[Batch Evaluator Fatal] Invalid JSON in input file: ${err.message}`);
    process.exit(1);
  }

  const validation = validateBatchInput(parsedJson);
  if (!validation.success) {
    console.error(`[Batch Evaluator Fatal] Invalid input batch schema:\n${validation.errors.join('\n')}`);
    process.exit(1);
  }

  const cases: BatchCaseInput[] = validation.data;
  console.log(`[Batch Evaluator] Starting evaluation of ${cases.length} case(s)...`);

  const results: BatchKitResult[] = [];
  const llmClient = new ResilientLLMClient();
  const orchestrator = new PrepKitOrchestrator(llmClient);

  for (let i = 0; i < cases.length; i++) {
    const item = cases[i];
    console.log(`\n------------------------------------------------------------`);
    console.log(`[Case ${i + 1}/${cases.length}] Processing "${item.id}" (URL: ${item.company_url}, Days: ${item.days})...`);

    try {
      const kit = await orchestrator.generateKit(
        {
          jd: item.jd,
          companyUrl: item.company_url,
          days: item.days,
        },
        {
          crawlerOptions: {
            allowLocalHosts: true, // Crucial for Section 9 local test servers
          },
          onProgress: event => {
            console.log(`  [${item.id}] [${event.progressPercent}%] ${event.message}`);
          },
        }
      );

      console.log(`  ✓ Case "${item.id}" completed successfully.`);
      results.push({
        id: item.id,
        status: 'ok',
        kit,
        error: null,
      });
    } catch (err: any) {
      console.error(`  ✗ Case "${item.id}" failed: ${err.message}`);

      let errorCode = 'PIPELINE_ERROR';
      if (err.message?.includes('COMPANY_UNREACHABLE') || err.message?.includes('ECONNREFUSED')) {
        errorCode = 'COMPANY_UNREACHABLE';
      } else if (err.message?.includes('LLM_GENERATION_FAILED')) {
        errorCode = 'LLM_RATE_LIMIT_EXCEEDED';
      } else if (err.message?.includes('SCHEMA_VALIDATION')) {
        errorCode = 'SCHEMA_VALIDATION_FAILED';
      }

      results.push({
        id: item.id,
        status: 'failed',
        kit: null,
        error: {
          code: errorCode,
          message: err.message || 'Unknown pipeline failure occurred.',
        },
      });
    }
  }

  const batchOutput: BatchOutput = {
    version: '1.0',
    generated_at: new Date().toISOString(),
    kits: results,
  };

  // Ensure target directory exists
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(batchOutput, null, 2), 'utf-8');

  console.log(`\n============================================================`);
  console.log(`[Batch Evaluator] Done! Successfully wrote ${results.length} results to: ${outputPath}`);
  const okCount = results.filter(r => r.status === 'ok').length;
  console.log(`[Batch Evaluator Summary] OK: ${okCount} | Failed: ${results.length - okCount}`);
}

runBatchEvaluation().catch(err => {
  console.error('[Batch Evaluator Fatal]', err);
  process.exit(1);
});
