#!/usr/bin/env node
// Checks that the template literal string in buildAgentSystemPrompt()
// contains no unescaped backticks that would break esbuild.
// Run before committing changes to AgentRunner.ts.

const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '../src/core/intelligence/AgentRunner.ts')
const src = fs.readFileSync(file, 'utf8')
const lines = src.split('\n')

// Find the start of the return template literal in buildAgentSystemPrompt
const startLine = lines.findIndex(l => l.includes('return `You are PLATPHORM'))
const endLine   = lines.findIndex((l, i) => i > startLine && l.match(/^}$/))

if (startLine === -1) {
  console.error('ERROR: Could not find buildAgentSystemPrompt return statement')
  process.exit(1)
}

let errors = 0
for (let i = startLine; i <= endLine; i++) {
  const line = lines[i]
  // Find unescaped backticks: backtick not preceded by backslash,
  // and not at the very start/end of the template literal delimiters
  const matches = [...line.matchAll(/(?<!\\)`/g)]
  for (const m of matches) {
    // Skip the opening backtick on the return line and closing on end line
    if (i === startLine && m.index === line.indexOf('`')) continue
    if (i === endLine) continue
    console.error(`UNESCAPED BACKTICK at line ${i + 1}, col ${m.index}: ${line.trim().slice(0, 80)}`)
    errors++
  }
}

if (errors > 0) {
  console.error(`\n${errors} unescaped backtick(s) found. Replace them with \\` + '`' + ` in the template literal.`)
  process.exit(1)
} else {
  console.log('✓ No unescaped backticks in AgentRunner.ts template literal')
}
