import { orchestrator } from '../../providers/AIOrchestrator'
import type { Finding, LayerResult, PipelineContext } from '../../../types'
import { safeParseJSON } from '../utils'

// Well-known package-name patterns mentioned in natural language prompts.
// Covers common npm ecosystem references so we can surface dependency risk even
// when no source code is provided yet.
const KNOWN_PACKAGE_MENTIONS: Record<string, string> = {
  // HTTP / data-fetching
  axios: 'axios', fetch: 'node-fetch', 'node-fetch': 'node-fetch',
  'got': 'got', superagent: 'superagent', ky: 'ky',
  // State management
  redux: 'redux', zustand: 'zustand', jotai: 'jotai', recoil: 'recoil', mobx: 'mobx',
  // Frameworks / meta-frameworks
  react: 'react', vue: 'vue', angular: '@angular/core', svelte: 'svelte',
  next: 'next', nuxt: 'nuxt', remix: '@remix-run/react', astro: 'astro',
  // ORMs / databases
  prisma: '@prisma/client', drizzle: 'drizzle-orm', typeorm: 'typeorm',
  mongoose: 'mongoose', sequelize: 'sequelize', knex: 'knex',
  // Auth
  'next-auth': 'next-auth', 'auth0': '@auth0/nextjs-auth0', clerk: '@clerk/nextjs',
  // UI
  tailwind: 'tailwindcss', mui: '@mui/material', chakra: '@chakra-ui/react',
  shadcn: 'shadcn-ui', radix: '@radix-ui/react-dialog',
  // Testing
  jest: 'jest', vitest: 'vitest', playwright: '@playwright/test', cypress: 'cypress',
  // Utilities
  lodash: 'lodash', dayjs: 'dayjs', moment: 'moment', zod: 'zod', yup: 'yup',
  'date-fns': 'date-fns', uuid: 'uuid', nanoid: 'nanoid',
  // Build / bundlers
  vite: 'vite', webpack: 'webpack', esbuild: 'esbuild', rollup: 'rollup',
  // Backend
  express: 'express', fastify: 'fastify', hono: 'hono', koa: 'koa', nestjs: '@nestjs/core',
  // Payments / services
  stripe: 'stripe', twilio: 'twilio', sendgrid: '@sendgrid/mail',
  supabase: '@supabase/supabase-js', firebase: 'firebase',
  // AI / ML
  openai: 'openai', langchain: 'langchain', 'anthropic': '@anthropic-ai/sdk',
}

/**
 * Extract package names explicitly imported in code via `import … from '…'`
 * plus `require('…')` patterns.
 */
function extractCodeImports(code: string): string[] {
  const esmMatches = (code.match(/import\s+.*?from\s+['"]([^'"]+)['"]/g) ?? [])
    .map((m) => m.match(/from\s+['"]([^'"]+)['"]/)?.[1])
  const cjsMatches = (code.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g) ?? [])
    .map((m) => m.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/)?.[1])
  return [...esmMatches, ...cjsMatches]
    .filter((s): s is string => !!s && !s.startsWith('.') && !s.startsWith('/'))
    .map((s) => s.split('/')[0].replace(/^@[^/]+\/[^/]+.*/, (x) => x.split('/').slice(0, 2).join('/')))
    // dedupe
    .filter((v, i, a) => a.indexOf(v) === i)
}

/**
 * FIX 9: When no source code is selected, scan the developer's natural-language
 * prompt for well-known package names so the layer never silently skips.
 */
function extractPromptImpliedPackages(prompt: string): string[] {
  const lower = prompt.toLowerCase()
  const found: string[] = []
  for (const [keyword, pkg] of Object.entries(KNOWN_PACKAGE_MENTIONS)) {
    // Match whole words/phrases to avoid false positives (e.g. "reacts" → react)
    const pattern = new RegExp(`\\b${keyword.replace(/[-/]/g, '[\\-/]')}\\b`, 'i')
    if (pattern.test(lower) && !found.includes(pkg)) {
      found.push(pkg)
    }
  }
  return found
}

export async function runDependencyLayer(context: PipelineContext): Promise<LayerResult> {
  const start = Date.now()
  const findings: Finding[] = []

  // 1. Imports found in selected code
  const codeImports = extractCodeImports(context.selectedCode ?? '')

  // 2. FIX 9: When no code is provided, infer packages from the prompt text
  const promptImports =
    codeImports.length === 0 ? extractPromptImpliedPackages(context.userPrompt) : []

  const allPackages = [...new Set([...codeImports, ...promptImports])]
  const source = codeImports.length > 0 ? 'code' : promptImports.length > 0 ? 'prompt' : null

  // Still nothing to analyze — genuinely skip
  if (allPackages.length === 0) {
    return {
      layer: 'dependency',
      status: 'skipped',
      score: 100,
      findings: [],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }

  const prompt = `You are the Dependency Layer of the PLATPHORM engineering OS.

Analyze these dependencies for risk${source === 'prompt' ? ' (inferred from the developer\'s request — no code selected yet)' : ''}:
${allPackages.map((i) => `- ${i}`).join('\n')}

Developer request: "${context.userPrompt}"

Check for:
1. Fake/nonexistent package names (hallucinated imports)
2. Known vulnerable packages (general knowledge)
3. Packages not in provider abstraction registry (direct provider calls)
4. Ecosystem risk (unmaintained, deprecated, low quality)
5. Supply chain risk
6. Unnecessary dependencies (can native APIs solve this?)
7. License conflicts

${source === 'prompt' ? 'Note: These packages were inferred from the prompt text — flag any that sound hallucinated or misremembered.' : ''}

Respond in JSON:
{
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "category": "Hallucination|Vulnerability|Supply Chain|Ecosystem|Abstraction Violation",
      "package": "...",
      "message": "...",
      "suggestedFix": "..."
    }
  ],
  "score": 90
}`

  try {
    const result = await orchestrator.orchestrate({ prompt, role: 'backend' })
    const parsed = safeParseJSON(result.result.content, {})

    for (const f of (parsed.findings ?? []) as any[]) {
      findings.push({
        id: `dep-${f.package ?? 'unknown'}-${Date.now()}`,
        layer: 'dependency',
        severity: f.severity ?? 'medium',
        category: f.category ?? 'Dependency',
        message: f.message,
        suggestedFix: f.suggestedFix,
        autoFixable: false
      })
    }

    const hasBlocker = findings.some((f) => f.severity === 'critical')

    return {
      layer: 'dependency',
      status: hasBlocker ? 'failed' : findings.length > 0 ? 'warned' : 'passed',
      score: typeof parsed.score === 'number' ? parsed.score : 90,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  } catch {
    return {
      layer: 'dependency',
      status: 'skipped',
      score: 80,
      findings: [],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }
}
