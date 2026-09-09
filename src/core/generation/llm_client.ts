import { GoogleGenerativeAI } from '@google/generative-ai';

export interface LLMRequestOptions {
  temperature?: number;
  maxOutputTokens?: number;
  responseSchema?: any;
  systemInstruction?: string;
}

export interface LLMClientConfig {
  apiKey?: string;
  modelName?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  provider?: 'auto' | 'gemini' | 'openrouter';
  openRouterApiKey?: string;
  openRouterModel?: string;
  openRouterBaseUrl?: string;
}

export type LLMProvider = 'gemini' | 'openrouter' | 'none';

/**
 * Resilient LLM client with exponential backoff, rate-limit tolerance,
 * and deterministic offline fallback for headless testing and CI.
 *
 * Supports two providers (selected via LLM_PROVIDER or auto-detect):
 *  1. OpenRouter (OpenAI-compatible): OPENROUTER_API_KEY + OPENROUTER_MODEL
 *     e.g. google/gemini-2.5-flash, google/gemini-2.0-flash, anthropic/claude-3.5-sonnet
 *  2. Direct Google Gemini SDK: GEMINI_API_KEY + GEMINI_MODEL
 *     e.g. gemini-2.5-flash, gemini-2.0-flash, gemini-1.5-flash (legacy)
 *
 * NOTE: There is no model called "gemini-3.8-flash". If you saw that name,
 * use google/gemini-2.5-flash on OpenRouter or gemini-2.5-flash direct.
 */
export class ResilientLLMClient {
  private genAI: GoogleGenerativeAI | null = null;
  private modelName: string;
  private maxRetries: number;
  private baseDelayMs: number;
  private lastRequestTime = 0;
  private minIntervalMs = 500; // Rate limit pacing
  private provider: LLMProvider = 'none';
  private openRouterKey: string = '';
  private openRouterModel: string = '';
  private openRouterBaseUrl: string = '';

  constructor(config: LLMClientConfig = {}) {
    // Explicit config keys win over env (so tests with { apiKey: '' } stay deterministic).
    const geminiKey =
      'apiKey' in config ? (config.apiKey || '') : (process.env.GEMINI_API_KEY || '');
    // Default to current stable Flash; 1.5-flash is legacy.
    const geminiModel =
      config.modelName || process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    const openRouterKey =
      'openRouterApiKey' in config
        ? (config.openRouterApiKey || '')
        : (process.env.OPENROUTER_API_KEY || '');
    const openRouterModel =
      config.openRouterModel ||
      process.env.OPENROUTER_MODEL ||
      'google/gemini-2.5-flash';
    const openRouterBase =
      process.env.OPENROUTER_BASE_URL ||
      'https://openrouter.ai/api/v1';

    const requested =
      config.provider || (process.env.LLM_PROVIDER as string) || 'auto';

    const hasOpenRouter =
      openRouterKey && openRouterKey !== 'your_openrouter_key_here';
    const hasGemini =
      geminiKey && geminiKey !== 'your_gemini_api_key_here';

    if (requested === 'openrouter' && hasOpenRouter) {
      this.provider = 'openrouter';
    } else if (requested === 'gemini' && hasGemini) {
      this.provider = 'gemini';
    } else if (requested === 'auto') {
      // Prefer OpenRouter when both keys exist (one key -> many models).
      if (hasOpenRouter) this.provider = 'openrouter';
      else if (hasGemini) this.provider = 'gemini';
    }
    // else: stays 'none' -> heuristic fallback, isConfigured=false

    this.modelName = geminiModel;
    this.openRouterKey = hasOpenRouter ? openRouterKey : '';
    this.openRouterModel = openRouterModel;
    this.openRouterBaseUrl = openRouterBase.replace(/\/$/, '');
    this.maxRetries = config.maxRetries ?? 3;
    this.baseDelayMs = config.baseDelayMs ?? 2000;

    if (this.provider === 'gemini' && hasGemini) {
      this.genAI = new GoogleGenerativeAI(geminiKey);
    }
  }

  get activeProvider(): LLMProvider {
    return this.provider;
  }

  get activeModel(): string {
    return this.provider === 'openrouter' ? this.openRouterModel : this.modelName;
  }

  get isConfigured(): boolean {
    return this.provider !== 'none';
  }

  private async pace(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minIntervalMs) {
      await new Promise(resolve => setTimeout(resolve, this.minIntervalMs - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Generates text or JSON response with exponential backoff on 429 rate limits.
   */
  async generate(prompt: string, options: LLMRequestOptions = {}): Promise<string> {
    if (this.provider === 'none') {
      throw new Error(
        'LLM_NOT_CONFIGURED: Set OPENROUTER_API_KEY or GEMINI_API_KEY in .env.'
      );
    }

    if (this.provider === 'openrouter') {
      return this.generateViaOpenRouter(prompt, options);
    }

    return this.generateViaGemini(prompt, options);
  }

  private async generateViaGemini(
    prompt: string,
    options: LLMRequestOptions = {}
  ): Promise<string> {
    if (!this.genAI) {
      throw new Error('LLM_NOT_CONFIGURED: GEMINI_API_KEY is not set.');
    }

    let attempt = 0;
    let delay = this.baseDelayMs;

    while (attempt <= this.maxRetries) {
      try {
        await this.pace();
        const model = this.genAI.getGenerativeModel({
          model: this.modelName,
          generationConfig: {
            temperature: options.temperature ?? 0.2,
            maxOutputTokens: options.maxOutputTokens ?? 4096,
            responseMimeType: options.responseSchema ? 'application/json' : 'text/plain',
          },
          systemInstruction: options.systemInstruction,
        });

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        return text;
      } catch (error: any) {
        attempt++;
        const isRateLimit = error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED');
        const isTransient = isRateLimit || error?.status === 503 || error?.message?.includes('503');

        if (attempt > this.maxRetries || !isTransient) {
          throw new Error(`LLM_GENERATION_FAILED: ${error?.message || 'Unknown error'}`);
        }

        // Exponential backoff with jitter
        const jitter = Math.random() * 500;
        const sleepTime = delay + jitter;
        console.warn(`[LLM Rate-Limit Backoff] Attempt ${attempt} failed with ${error?.status || 429}. Waiting ${Math.round(sleepTime)}ms...`);
        await new Promise(resolve => setTimeout(resolve, sleepTime));
        delay *= 2;
      }
    }

    throw new Error('LLM_GENERATION_FAILED: Max retries exceeded.');
  }

  /**
   * OpenRouter path: OpenAI-compatible Chat Completions.
   * Works for google/gemini-2.5-flash and any other OpenRouter model.
   */
  private async generateViaOpenRouter(
    prompt: string,
    options: LLMRequestOptions = {}
  ): Promise<string> {
    let attempt = 0;
    let delay = this.baseDelayMs;

    while (attempt <= this.maxRetries) {
      try {
        await this.pace();

        const messages: Array<{ role: string; content: string }> = [];
        if (options.systemInstruction) {
          messages.push({ role: 'system', content: options.systemInstruction });
        }
        const finalPrompt = options.responseSchema
          ? `${prompt}\n\nIMPORTANT: Respond with valid JSON only. No markdown fences, no commentary.`
          : prompt;
        messages.push({ role: 'user', content: finalPrompt });

        const headers: Record<string, string> = {
          Authorization: `Bearer ${this.openRouterKey}`,
          'Content-Type': 'application/json',
        };
        // Optional but recommended for OpenRouter rankings / debugging.
        if (process.env.OPENROUTER_APP_URL) {
          headers['HTTP-Referer'] = process.env.OPENROUTER_APP_URL;
        }
        if (process.env.OPENROUTER_APP_NAME) {
          headers['X-Title'] = process.env.OPENROUTER_APP_NAME;
        }

        const res = await fetch(`${this.openRouterBaseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: this.openRouterModel,
            messages,
            temperature: options.temperature ?? 0.2,
            max_tokens: options.maxOutputTokens ?? 4096,
            ...(options.responseSchema
              ? { response_format: { type: 'json_object' } }
              : {}),
          }),
        });

        if (res.status === 429 || res.status === 503) {
          throw Object.assign(new Error(`OpenRouter transient ${res.status}`), {
            status: res.status,
          });
        }

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(
            `OpenRouter HTTP ${res.status}: ${errText.slice(0, 300)}`
          );
        }

        const data: any = await res.json();
        const text: string =
          data?.choices?.[0]?.message?.content ??
          data?.choices?.[0]?.text ??
          '';

        if (!text || typeof text !== 'string') {
          throw new Error('OpenRouter returned empty content.');
        }
        return text;
      } catch (error: any) {
        attempt++;
        const isRateLimit =
          error?.status === 429 ||
          error?.message?.includes('429') ||
          error?.message?.includes('RESOURCE_EXHAUSTED');
        const isTransient =
          isRateLimit || error?.status === 503 || error?.message?.includes('503');

        if (attempt > this.maxRetries || !isTransient) {
          // Non-transient (bad key, bad model name, 400/401/404) fails fast
          // so callers fall back to heuristic instead of hanging.
          throw new Error(`LLM_GENERATION_FAILED: ${error?.message || 'Unknown error'}`);
        }

        const jitter = Math.random() * 500;
        const sleepTime = delay + jitter;
        console.warn(
          `[LLM OpenRouter Backoff] Attempt ${attempt} failed (${error?.message}). Waiting ${Math.round(sleepTime)}ms...`
        );
        await new Promise(resolve => setTimeout(resolve, sleepTime));
        delay *= 2;
      }
    }

    throw new Error('LLM_GENERATION_FAILED: Max retries exceeded.');
  }

  /**
   * Generates and parses a strictly validated JSON object.
   */
  async generateJSON<T>(prompt: string, options: LLMRequestOptions = {}): Promise<T> {
    const rawText = await this.generate(prompt, {
      ...options,
      responseSchema: true,
    });

    try {
      // Strip markdown json formatting if present
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      return JSON.parse(cleaned) as T;
    } catch (parseError: any) {
      throw new Error(`LLM_JSON_PARSE_ERROR: Failed to parse LLM output as JSON. Raw output: "${rawText.slice(0, 200)}..."`);
    }
  }
}
