import { PrepKit } from './kit.js';

/**
 * Appendix B — Batch Input and Output
 */

export interface BatchCaseInput {
  id: string;
  jd: string;
  company_url: string;
  days: number;
}

export interface BatchError {
  code: string;
  message: string;
}

export interface BatchKitResult {
  id: string;
  status: 'ok' | 'failed';
  kit: PrepKit | null;
  error: BatchError | null;
}

export interface BatchOutput {
  version: string;
  generated_at: string;
  kits: BatchKitResult[];
}
