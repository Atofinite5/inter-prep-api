import * as cheerio from 'cheerio';

export interface CleanedPageContent {
  title: string;
  metaDescription: string;
  headings: string[];
  cleanText: string;
  charCount: number;
}

/**
 * Extracts high-signal text content from raw HTML, stripping layout boilerplate,
 * scripts, styles, navigation bars, and cookie banners.
 */
export function cleanHtmlContent(html: string, maxChars = 8000): CleanedPageContent {
  if (!html || typeof html !== 'string') {
    return { title: '', metaDescription: '', headings: [], cleanText: '', charCount: 0 };
  }

  const $ = cheerio.load(html);

  // Remove non-content and layout tags
  $('script, style, noscript, iframe, svg, canvas, nav, footer, header, aside, form').remove();
  $('.cookie-banner, #cookie-consent, .cookie-notice, .modal, [role="dialog"]').remove();
  $('.advertisement, .ad-banner, .social-share').remove();

  const title = $('title').first().text().trim().replace(/\s+/g, ' ');
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() || '';

  const headings: string[] = [];
  $('h1, h2, h3').each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (text && text.length > 2 && text.length < 150) {
      headings.push(text);
    }
  });

  // Extract structured paragraphs and list items
  const contentBlocks: string[] = [];

  $('main, article, [role="main"], .content, body').first().find('p, li, h1, h2, h3, h4, blockquote').each((_, el) => {
    const blockText = $(el).text().trim().replace(/\s+/g, ' ');
    if (blockText && blockText.length > 15) {
      contentBlocks.push(blockText);
    }
  });

  let rawClean = contentBlocks.join('\n\n');

  // Fallback if main blocks produced very little text
  if (rawClean.length < 100) {
    rawClean = $('body').text().replace(/\s+/g, ' ').trim();
  }

  // Enforce max character limit to protect LLM context window
  if (rawClean.length > maxChars) {
    rawClean = rawClean.slice(0, maxChars) + '...';
  }

  return {
    title,
    metaDescription,
    headings: headings.slice(0, 10),
    cleanText: rawClean,
    charCount: rawClean.length,
  };
}
