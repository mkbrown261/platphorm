/**
 * Shared JSON extraction utility for all pipeline layers.
 *
 * The naive regex /\{[\s\S]*\}/ breaks when AI-generated JSON contains code
 * with braces inside string values. This uses proper bracket counting +
 * multiple fallback strategies so it handles real-world AI responses.
 */

/**
 * Extract and parse a JSON object/array from an AI response string.
 * Tries 5 strategies in order before throwing.
 */
export function parseJSONFromAI(text: string): any {
  const t = text.trim()

  // 1. Direct parse — AI returned pure JSON
  try { return JSON.parse(t) } catch { /* continue */ }

  // 2. Strip markdown code fences, then parse
  const stripped = t
    .replace(/^```(?:json|javascript|typescript|js|ts)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim()
  try { return JSON.parse(stripped) } catch { /* continue */ }

  // 3. Find the outermost { } with proper bracket counting
  const obj = extractBalanced(t, '{', '}')
  if (obj) { try { return JSON.parse(obj) } catch { /* continue */ } }

  // 4. Same on the stripped text
  const obj2 = extractBalanced(stripped, '{', '}')
  if (obj2) { try { return JSON.parse(obj2) } catch { /* continue */ } }

  // 5. Array responses — find outermost [ ]
  const arr = extractBalanced(t, '[', ']')
  if (arr) { try { return JSON.parse(arr) } catch { /* continue */ } }

  throw new Error(`parseJSONFromAI: could not parse JSON. Preview: ${t.slice(0, 200)}`)
}

/**
 * Parse or return a safe default — never throws.
 */
export function parseJSONSafe<T>(text: string, fallback: T): T {
  try { return parseJSONFromAI(text) as T } catch { return fallback }
}

/**
 * Find the first balanced open/close bracket pair in text.
 * Correctly skips brackets that appear inside JSON string values.
 */
function extractBalanced(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open)
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]

    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue

    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }

  return null
}
