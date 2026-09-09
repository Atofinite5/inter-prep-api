import { RoleBreakdown, Requirement, RequirementKind, RequirementPriority } from '../types/kit.js';
import { ResilientLLMClient } from '../generation/llm_client.js';
import { sanitizeUntrustedContent } from '../security/sanitizer.js';

export interface JDExtractionResult {
  role: RoleBreakdown;
  isThinDescription: boolean;
  warnings: string[];
}

/**
 * Heuristic requirement extractor used for offline testing, stub analysis,
 * or as a fallback when LLM is unavailable.
 */
export function extractRequirementsHeuristic(jdText: string): RoleBreakdown {
  const lines = jdText.split('\n').map(l => l.trim()).filter(Boolean);
  const isShort = jdText.length < 300 || lines.length < 5;

  let title = 'Software Engineer';
  let seniority = 'Mid-Level';

  // Infer title from first 3 lines
  for (const line of lines.slice(0, 3)) {
    if (/engineer|developer|architect|lead|manager|designer|analyst/i.test(line)) {
      title = line.replace(/^[#*-]\s*/, '').trim();
      break;
    }
  }

  // Infer seniority
  if (/senior|staff|principal|lead|head|director/i.test(jdText)) {
    seniority = 'Senior';
  } else if (/junior|entry|associate|graduate|intern/i.test(jdText)) {
    seniority = 'Junior';
  }

  const responsibilities: string[] = [];
  const requirements: Requirement[] = [];
  let reqCount = 0;

  // Patterns for must-have vs nice-to-have
  const mustKeywords = /\b(must|required|requirements|essential|proficiency|proven|experience with|\d+\+?\s*years?)\b/i;
  const niceKeywords = /\b(nice to have|plus|bonus|preferred|advantage|good to have|familiarity with|ideally)\b/i;

  for (const line of lines) {
    const cleanLine = line.replace(/^[-*•\d.)]\s*/, '').trim();
    if (cleanLine.length < 5) continue;

    // Skip generic section headings
    if (/^(requirements|qualifications|responsibilities|what you will do|about the role|about you|who you are|minimum qualifications|preferred qualifications|key responsibilities):?$/i.test(cleanLine)) {
      continue;
    }

    // Check if line represents a requirement
    if (mustKeywords.test(line) || niceKeywords.test(line) || /knowledge of|hands-on|deep understanding/i.test(line)) {
      reqCount++;
      const isNice = niceKeywords.test(line);

      let kind: RequirementKind = 'technical';
      if (/mentor|leadership|collaborat|communicat|cross-functional|stakeholder|empathy|agile/i.test(line)) {
        kind = 'behavioural';
      } else if (/fintech|healthcare|compliance|domain|regulat|banking|e-commerce/i.test(line)) {
        kind = 'domain';
      }

      requirements.push({
        id: `r${reqCount}`,
        text: cleanLine,
        kind,
        priority: isNice ? 'nice' : 'must',
      });
    } else if (/build|develop|maintain|design|ship|collaborate|lead/i.test(cleanLine) && cleanLine.length > 20) {
      if (responsibilities.length < 6) {
        responsibilities.push(cleanLine);
      }
    }
  }

  // Handle thin JD: If very few requirements were found, extract distinct sentences honestly
  if (requirements.length === 0) {
    if (isShort && lines.length > 0) {
      // Honest representation of thin JD
      lines.forEach((line, idx) => {
        if (line.length > 10) {
          requirements.push({
            id: `r${idx + 1}`,
            text: line,
            kind: 'technical',
            priority: 'must',
          });
        }
      });
    }

    if (requirements.length === 0) {
      requirements.push({
        id: 'r1',
        text: 'Core software engineering fundamentals and problem solving',
        kind: 'technical',
        priority: 'must',
      });
    }
  }

  if (responsibilities.length === 0) {
    responsibilities.push('Contribute to development and architecture according to specifications');
  }

  return {
    title,
    seniority,
    responsibilities,
    requirements,
  };
}

/**
 * Extracts structured role information and requirements from a job description.
 */
export async function extractRoleFromJD(
  jdText: string,
  llmClient?: ResilientLLMClient
): Promise<JDExtractionResult> {
  const isThin = jdText.trim().length < 250;
  const warnings: string[] = [];

  if (isThin) {
    warnings.push('Thin job description provided. Extracted minimal factual requirements without inventing details.');
  }

  if (!llmClient || !llmClient.isConfigured) {
    const role = extractRequirementsHeuristic(jdText);
    return {
      role,
      isThinDescription: isThin,
      warnings,
    };
  }

  const sanitized = sanitizeUntrustedContent(jdText, 'job_description');

  const prompt = `
You are an expert technical recruiter analyzing a job description.
Your goal is to extract ONLY what is explicitly stated in the job description.
DO NOT invent, fabricate, or hallucinate skills or requirements not present in the text.
If the description is brief, extract only what is there and mark it honestly.

Text to analyze:
${sanitized.delimitedForPrompt}

Respond ONLY with a JSON object strictly matching this schema:
{
  "title": "exact or closest role title",
  "seniority": "Junior | Mid-Level | Senior | Staff | Lead",
  "responsibilities": ["list of explicit responsibilities stated in the text"],
  "requirements": [
    {
      "id": "r1",
      "text": "verbatim or concise requirement",
      "kind": "technical | behavioural | domain",
      "priority": "must | nice"
    }
  ]
}

Rules for priority:
- "must": Required qualifications, mandatory years of experience, core tech stack.
- "nice": Mentioned as bonus, plus, preferred, optional, or good to have.
Each requirement id must be sequential: r1, r2, r3, etc.
`;

  try {
    const extracted = await llmClient.generateJSON<RoleBreakdown>(prompt);

    // Validate requirement IDs are well-formed (coerce arrays -> strings)
    const toStr = (v: unknown, fb: string): string =>
      typeof v === 'string' && v.trim()
        ? v
        : Array.isArray(v)
          ? (v as unknown[]).map(String).join('\n') || fb
          : fb;
    const normalizedReqs = (extracted.requirements || []).map((req, idx) => ({
      id: toStr(req.id, `r${idx + 1}`),
      text: toStr(req.text, 'Core technical capability'),
      kind: (['technical', 'behavioural', 'domain'].includes(req.kind) ? req.kind : 'technical') as RequirementKind,
      priority: (['must', 'nice'].includes(req.priority) ? req.priority : 'must') as RequirementPriority,
    }));

    // If description was a 2-line stub and model extracted 0 requirements, fall back honestly
    if (normalizedReqs.length === 0) {
      return {
        role: extractRequirementsHeuristic(jdText),
        isThinDescription: true,
        warnings: [...warnings, 'LLM extracted 0 requirements from brief text; used faithful line-by-line extraction.'],
      };
    }

    return {
      role: {
        title: toStr(extracted.title, 'Software Engineer'),
        seniority: toStr(extracted.seniority, 'Mid-Level'),
        responsibilities: Array.isArray(extracted.responsibilities) && extracted.responsibilities.length
          ? extracted.responsibilities.map((r: unknown) => toStr(r, 'Develop high quality software'))
          : ['Develop high quality software'],
        requirements: normalizedReqs,
      },
      isThinDescription: isThin,
      warnings,
    };
  } catch (err: any) {
    console.warn(`[JDExtractor] LLM extraction failed (${err.message}). Falling back to heuristic extractor.`);
    return {
      role: extractRequirementsHeuristic(jdText),
      isThinDescription: isThin,
      warnings: [...warnings, 'Fell back to rule-based requirement extraction due to LLM error.'],
    };
  }
}
