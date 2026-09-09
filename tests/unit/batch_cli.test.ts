import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { BatchOutputSchema } from '../../src/core/validation/schemas.js';

const execAsync = promisify(exec);

describe('Batch Entry Point (Section 9 - npm run evaluate)', () => {
  const testDir = path.resolve(process.cwd(), 'tests/fixtures');
  const inputFile = path.join(testDir, 'sample_cases.json');
  const outputFile = path.join(testDir, 'output_kits.json');

  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });

    const sampleCases = [
      {
        id: 'case-01',
        jd: 'Senior Node.js Engineer. 5+ years experience with Express and MongoDB.',
        company_url: 'https://example.com',
        days: 3,
      },
      {
        id: 'case-02-unreachable',
        jd: 'Backend Developer. Required: Go and PostgreSQL.',
        company_url: 'http://non-existent-site-test-999.invalid',
        days: 2,
      },
    ];

    await fs.writeFile(inputFile, JSON.stringify(sampleCases, null, 2), 'utf-8');
  });

  afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('runs evaluate CLI and produces valid Appendix B output', async () => {
    const cmd = `npx tsx src/cli/evaluate.ts --input ${inputFile} --output ${outputFile}`;
    const { stdout, stderr } = await execAsync(cmd, { cwd: process.cwd() });

    expect(stdout).toContain('[Batch Evaluator] Done!');

    // Read and validate output file
    const rawOutput = await fs.readFile(outputFile, 'utf-8');
    const parsed = JSON.parse(rawOutput);

    const validation = BatchOutputSchema.safeParse(parsed);
    expect(validation.success).toBe(true);

    if (validation.success) {
      expect(parsed.version).toBe('1.0');
      expect(parsed.kits.length).toBe(2);

      const case1 = parsed.kits.find((k: any) => k.id === 'case-01');
      expect(case1?.status).toBe('ok');
      expect(case1?.kit?.schedule.days_available).toBe(3);

      const case2 = parsed.kits.find((k: any) => k.id === 'case-02-unreachable');
      expect(case2).toBeDefined();
    }
  }, 30000);
});
