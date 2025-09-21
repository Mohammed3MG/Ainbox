/**
 * Advanced email content cleaning and repair utilities
 */

/**
 * Detect if HTML content has been corrupted by URL auto-linking
 */
export const isCorruptedByAutoLinking = (htmlContent) => {
  // Check for common patterns of URL auto-linking corruption
  const corruptionPatterns = [
    // URLs that got auto-linked inside attributes
    /target="_blank"[^>]*style="color: #1a73e8[^>]*>https?:\/\//gi,
    // Attributes that got wrapped as links
    /xmlns="<[^>]*target="_blank"/gi,
    // Image sources that got corrupted
    /src=""\s*target="_blank"[^>]*>https?:\/\//gi,
    // Href attributes that got corrupted
    /href=""\s*target="_blank"[^>]*>https?:\/\//gi
  ];

  return corruptionPatterns.some(pattern => pattern.test(htmlContent));
};

/**
 * Repair corrupted HTML from aggressive URL auto-linking
 */
export const repairAutoLinkCorruption = (htmlContent) => {
  if (!htmlContent || typeof htmlContent !== 'string') return htmlContent;

  let repaired = htmlContent;

  console.log('🔧 Attempting to repair auto-link corruption...');

  // Fix corrupted xmlns attributes
  repaired = repaired.replace(
    /xmlns="<html"\s*target="_blank"[^>]*>([^"]+)"/gi,
    'xmlns="$1"'
  );

  // Fix corrupted image src attributes (multiple patterns)
  repaired = repaired.replace(
    /src=""\s*target="_blank"[^>]*>(https?:\/\/[^"]*)/gi,
    'src="$1"'
  );

  // Handle src attributes with extra markup
  repaired = repaired.replace(
    /src="([^"]*"\s*target="_blank"[^>]*>)(https?:\/\/[^"]*)/gi,
    'src="$2"'
  );

  // Fix corrupted href attributes (multiple patterns)
  repaired = repaired.replace(
    /href=""\s*target="_blank"[^>]*>(https?:\/\/[^"]*)/gi,
    'href="$1"'
  );

  // Handle href attributes with extra markup
  repaired = repaired.replace(
    /href="([^"]*"\s*target="_blank"[^>]*>)(https?:\/\/[^"]*)/gi,
    'href="$2"'
  );

  // Fix corrupted DOCTYPE declarations
  repaired = repaired.replace(
    /<!DOCTYPE[^>]*target="_blank"[^>]*>([^<]+)/gi,
    '<!DOCTYPE html>'
  );

  // Fix complex auto-link corruptions with nested quotes
  repaired = repaired.replace(
    /" target="_blank" style="color: #1a73e8; text-decoration: none;">([^<"]+)/gi,
    '"$1'
  );

  // Remove orphaned auto-link artifacts
  repaired = repaired.replace(
    /"\s*target="_blank"\s*style="color:\s*#1a73e8;\s*text-decoration:\s*none;">([^<"]+)/gi,
    '"$1'
  );

  // Clean up duplicate or malformed attributes
  repaired = repaired.replace(
    /\s+(target="_blank"\s*style="color:\s*#1a73e8[^"]*")\s*>/gi,
    '>'
  );

  // Remove stray auto-link closing tags
  repaired = repaired.replace(
    /<\/a>\s*"/gi,
    '"'
  );

  // Fix malformed opening tags that got auto-linked
  repaired = repaired.replace(
    /<([a-zA-Z][^>]*)\s*target="_blank"[^>]*>([^<]*)<\/[^>]*>/gi,
    '<$1>$2'
  );

  console.log('🔧 Auto-link corruption repair completed');
  return repaired;
};

/**
 * Enhanced content type detection with corruption analysis
 */
export const analyzeEmailContent = (message) => {
  const html = message?.html || '';
  const text = message?.text || message?.body || '';

  const analysis = {
    hasHtml: Boolean(html && html.trim()),
    hasText: Boolean(text && text.trim()),
    htmlLength: html.length,
    textLength: text.length,
    isCorrupted: false,
    corruptionType: null,
    recommendedAction: 'use_as_is',
    detectedIssues: [],
    confidenceScore: 1.0
  };

  if (analysis.hasHtml) {
    let issues = [];

    // Check for auto-linking corruption
    if (isCorruptedByAutoLinking(html)) {
      analysis.isCorrupted = true;
      analysis.corruptionType = 'auto_linking';
      analysis.recommendedAction = 'repair_html';
      issues.push('Auto-linking corruption detected');
      analysis.confidenceScore -= 0.3;
    }

    // Check for malformed HTML structure
    const htmlTagCount = (html.match(/<[^>]+>/g) || []).length;
    const openTagCount = (html.match(/<[^\/][^>]*>/g) || []).length;
    const closeTagCount = (html.match(/<\/[^>]+>/g) || []).length;
    const tagImbalance = Math.abs(openTagCount - closeTagCount);

    if (tagImbalance > 5) {
      analysis.isCorrupted = true;
      analysis.corruptionType = analysis.corruptionType || 'malformed_tags';
      analysis.recommendedAction = 'fallback_to_text';
      issues.push(`Tag imbalance detected (${tagImbalance} unmatched tags)`);
      analysis.confidenceScore -= 0.4;
    }

    // Check for extremely long lines (often indicates corruption)
    const lines = html.split('\n');
    const longLines = lines.filter(line => line.length > 5000);
    if (longLines.length > 0) {
      issues.push(`Extremely long lines detected (${longLines.length} lines > 5000 chars)`);
      analysis.confidenceScore -= 0.2;
    }

    // Check for broken DOCTYPE
    if (html.includes('<!DOCTYPE') && !html.includes('<!DOCTYPE html')) {
      const doctype = html.match(/<!DOCTYPE[^>]*>/i)?.[0];
      if (doctype && (doctype.includes('target="_blank"') || doctype.length > 200)) {
        issues.push('Corrupted DOCTYPE declaration');
        analysis.confidenceScore -= 0.2;
      }
    }

    // Check for missing critical HTML structure
    const hasHtmlTag = /<html[^>]*>/i.test(html);
    const hasBodyTag = /<body[^>]*>/i.test(html);
    const hasHeadTag = /<head[^>]*>/i.test(html);

    if (htmlTagCount > 50 && (!hasHtmlTag || !hasBodyTag)) {
      issues.push('Missing essential HTML structure tags');
      analysis.confidenceScore -= 0.3;
    }

    // Check content-to-markup ratio
    const textLength = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().length;
    const markupRatio = htmlTagCount / Math.max(textLength, 1);

    if (markupRatio > 0.5) {
      issues.push('Excessive markup-to-content ratio');
      analysis.confidenceScore -= 0.2;
    }

    // Check for empty or minimal content
    if (textLength < 20 && htmlTagCount > 10) {
      issues.push('HTML structure present but minimal readable content');
      analysis.confidenceScore -= 0.4;
    }

    analysis.detectedIssues = issues;

    // Adjust recommendation based on confidence
    if (analysis.confidenceScore < 0.3 && analysis.hasText) {
      analysis.recommendedAction = 'fallback_to_text';
    } else if (analysis.confidenceScore < 0.5 && analysis.isCorrupted) {
      analysis.recommendedAction = 'repair_html';
    }
  }

  // If HTML is problematic but we have good text, prefer text
  if (analysis.hasText && analysis.textLength > 100 && analysis.confidenceScore < 0.4) {
    analysis.recommendedAction = 'prefer_text';
  }

  return analysis;
};

/**
 * Get the best content based on analysis
 */
export const getBestEmailContent = (message) => {
  const analysis = analyzeEmailContent(message);

  console.log('📧 Smart Email Content Analysis:', {
    hasHtml: analysis.hasHtml,
    hasText: analysis.hasText,
    isCorrupted: analysis.isCorrupted,
    corruptionType: analysis.corruptionType,
    recommendedAction: analysis.recommendedAction,
    confidenceScore: analysis.confidenceScore,
    detectedIssues: analysis.detectedIssues
  });

  // Strategy 1: Use clean HTML as-is
  if (analysis.hasHtml && !analysis.isCorrupted && analysis.confidenceScore > 0.7) {
    console.log('✅ Using clean HTML content');
    return {
      content: message.html,
      type: 'html',
      processed: false,
      analysis: analysis
    };
  }

  // Strategy 2: Repair corrupted HTML
  if (analysis.hasHtml && analysis.recommendedAction === 'repair_html') {
    console.log('🔧 Repairing corrupted HTML content');
    const repairedHtml = repairAutoLinkCorruption(message.html);
    return {
      content: repairedHtml,
      type: 'html_repaired',
      processed: true,
      originalIssue: analysis.corruptionType,
      analysis: analysis
    };
  }

  // Strategy 3: Prefer text when HTML is poor quality
  if (analysis.hasText && (analysis.recommendedAction === 'prefer_text' || analysis.recommendedAction === 'fallback_to_text')) {
    console.log('📝 Using text content due to poor HTML quality');
    return {
      content: message.text || message.body,
      type: 'text',
      processed: false,
      originalIssue: analysis.isCorrupted ? analysis.corruptionType : null,
      analysis: analysis
    };
  }

  // Strategy 4: Use any available text
  if (analysis.hasText) {
    console.log('📝 Using available text content');
    return {
      content: message.text || message.body,
      type: 'text',
      processed: false,
      analysis: analysis
    };
  }

  // Strategy 5: Extract text from corrupted HTML as last resort
  if (analysis.hasHtml) {
    console.log('⚠️ Extracting text from corrupted HTML');
    const extractedText = extractTextFromCorruptedHtml(message.html);
    return {
      content: extractedText,
      type: 'extracted_text',
      processed: true,
      originalIssue: 'corrupted_html',
      analysis: analysis
    };
  }

  console.log('❌ No usable content found');
  return {
    content: '',
    type: 'empty',
    processed: false,
    analysis: analysis
  };
};

/**
 * Extract readable text from heavily corrupted HTML
 */
export const extractTextFromCorruptedHtml = (html) => {
  if (!html) return '';

  let text = html;

  // Remove style tags and their content
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Remove script tags and their content
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Remove all HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Clean up whitespace
  text = text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();

  return text;
};

/**
 * Content quality assessment
 */
export const assessContentQuality = (content, type) => {
  if (!content) return 'empty';

  const length = content.length;
  const hasStructure = type === 'html' ?
    content.includes('<') && content.includes('>') :
    content.includes('\n') || content.length > 100;

  if (length < 20) return 'very_poor';
  if (length < 100) return 'poor';
  if (length < 500 && !hasStructure) return 'fair';
  if (hasStructure) return 'good';

  return 'excellent';
};