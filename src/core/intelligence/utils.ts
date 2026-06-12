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

/**
 * Honest layer-response parsing.
 *
 * The old pattern — `safeParseJSON(content, {})` followed by `parsed.score ?? 90`
 * — meant a completely unparseable LLM response scored 85–95/100 and passed the
 * layer. That is governance theater: a layer that couldn't analyze anything
 * reported near-perfect confidence.
 *
 * This returns an explicit `ok` flag so layers can downgrade to 'warned' with a
 * conservative score and a visible finding when the analysis didn't actually run.
 */
export function parseLayerJSON<T = Record<string, any>>(
  text: string
): { parsed: T; ok: boolean } {
  try {
    const parsed = JSON.parse(extractJSON(text)) as T
    // extractJSON falls back to '{}' — treat an empty object as a parse failure,
    // since every layer prompt requires at least one field.
    const ok = parsed != null && typeof parsed === 'object' && Object.keys(parsed as object).length > 0
    return { parsed: (parsed ?? {}) as T, ok }
  } catch {
    return { parsed: {} as T, ok: false }
  }
}

/** Standard finding appended when a layer's LLM response could not be parsed. */
export function unparseableFinding(layer: string): {
  id: string; layer: string; severity: 'medium'; category: string; message: string; autoFixable: false
} {
  return {
    id: `${layer}-unparseable-${Date.now()}`,
    layer,
    severity: 'medium',
    category: 'Analysis',
    message: `${layer} layer response could not be parsed — this layer's checks did NOT run. Treat its score as low-confidence.`,
    autoFixable: false
  }
}
