import { CompanyBrief } from '../types/kit.js';
import { CrawlResult } from '../crawler/site_crawler.js';
import { ResilientLLMClient } from './llm_client.js';
import { sanitizeUntrustedContent } from '../security/sanitizer.js';

export async function generateCompanyBrief(
  companyUrl: string,
  crawlResult: CrawlResult,
  roleTitle: string,
  llmClient?: ResilientLLMClient
): Promise<CompanyBrief> {
  const sources = crawlResult.pagesUsedUrls.length > 0
    ? crawlResult.pagesUsedUrls
    : [companyUrl];

  // If site was completely unreachable, return honest brief
  if (!crawlResult.reachable || crawlResult.companySummaryText.trim().length === 0) {
    const errorNote = crawlResult.errors[0]?.error || 'Site unreachable or timed out';
    return {
      summary: `Research was limited as the company website was unreachable or could not be retrieved (${errorNote}). Candidates should verify company products directly.`,
      what_they_do: 'Public company information could not be retrieved from the provided URL.',
      sources,
    };
  }

  // If LLM is not configured, generate factual summary from crawler results
  if (!llmClient || !llmClient.isConfigured) {
    const summary = crawlResult.hiringPageFound
      ? `Information retrieved from ${sources.length} page(s) on ${companyUrl}. Hiring and interview process details were located.`
      : `Information retrieved from ${companyUrl}. No dedicated public hiring or interview process page was identified.`;

    const whatTheyDo = crawlResult.companySummaryText.slice(0, 300).trim() || 'Software and technology services.';

    return {
      summary,
      what_they_do: whatTheyDo,
      sources,
    };
  }

  const sanitizedSummary = sanitizeUntrustedContent(crawlResult.companySummaryText, 'scraped_page_content');
  const sanitizedHiring = sanitizeUntrustedContent(crawlResult.hiringProcessText, 'scraped_page_content');

  const prompt = `
You are an executive career researcher synthesizing information about a company for an interview candidate.
Role: ${roleTitle}
Target Website: ${companyUrl}

Here is the factual scraped website data:
${sanitizedSummary.delimitedForPrompt}

${crawlResult.hiringProcessText ? `Scraped Hiring / Culture Pages:\n${sanitizedHiring.delimitedForPrompt}` : 'NOTE: No dedicated hiring or careers process page was discovered on this site.'}

Instructions:
1. "summary": Provide a concise 2-3 sentence overview covering what the company does, their mission, and what is known about their hiring/culture. If hiring details were not found, state that honestly without fabricating.
2. "what_they_do": A clear, objective 1-2 sentence description of their core product, service, or business model.
3. DO NOT hallucinate clients, funding rounds, or interview stages not mentioned in the source text.

Respond ONLY with a JSON object strictly matching this schema:
{
  "summary": "...",
  "what_they_do": "..."
}
`;

  try {
    const response = await llmClient.generateJSON<{ summary: string; what_they_do: string }>(prompt);
    const summary = Array.isArray((response as any)?.summary)
      ? ((response as any).summary as unknown[]).map(String).join('\n')
      : (response.summary || 'Company overview compiled from website research.');
    const whatTheyDo = Array.isArray((response as any)?.what_they_do)
      ? ((response as any).what_they_do as unknown[]).map(String).join('\n')
      : (response.what_they_do || 'Technology products and services.');
    return {
      summary,
      what_they_do: whatTheyDo,
      sources,
    };
  } catch (err: any) {
    console.warn(`[CompanyBrief] LLM brief generation failed (${err.message}). Using fallback.`);
    return {
      summary: `Research compiled from ${sources.length} retrieved page(s).`,
      what_they_do: crawlResult.companySummaryText.slice(0, 250).trim() || 'Company operations and engineering.',
      sources,
    };
  }
}
