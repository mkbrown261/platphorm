/**
 * Shared utilities for intelligence pipeline layers.
 * Single source of truth — do not copy into individual layer files.
 */

/**
 * Extracts the first valid JSON object from a string.
 * Handles LLM responses that wrap JSON in markdown code fences or prose.
 */
export function extractJSON(text: string): string {
  // First try a direct parse — maybe the response is already clean JSON
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed

  // Strip markdown code fences  (```json ... ``` or ``` ... ```)
  const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenced) {
    const inner = fenced[1].trim()
    if (inner.startsWith('{')) return inner
  }

  // Fallback: find the outermost { ... } block
  const match = text.match(/\{[\s\S]*\}/)
  return match ? match[0] : '{}'
}

/**
 * Safe JSON parse — returns a fallback value instead of throwing.
 */
export function safeParseJSON<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(extractJSON(text)) as T
  } catch {
    return fallback
  }
}

/**
 * Clamps a numeric score to [0, 100].
 */
export function clampScore(score: unknown, fallback = 75): number {
  const n = Number(score)
  if (isNaN(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}
