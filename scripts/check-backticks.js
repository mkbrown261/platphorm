#!/usr/bin/env node
// Validates that AgentRunner.ts parses cleanly — catches unescaped backticks
// or any other syntax breakage in the big template literal.
//
// The previous version of this script used a regex that could not distinguish
// backticks inside ${...} interpolations (valid nested template literals) from
// genuinely unescaped backticks — producing false positives on valid code.
// We now use the TypeScript compiler's own parser, which is always right.

const path = require('path')
const ts = require(path.join(__dirname, '../node_modules/typescript'))
const fs = require('fs')

const file = path.join(__dirname, '../src/core/intelligence/AgentRunner.ts')
const src = fs.readFileSync(file, 'utf8')

const result = ts.transpileModule(src, {
  reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.Preserve }
})

const syntaxErrors = (result.diagnostics ?? []).filter(
  d => d.category === ts.DiagnosticCategory.Error
)

if (syntaxErrors.length) {
  for (const d of syntaxErrors) {
    const { line, character } = d.file
      ? d.file.getLineAndCharacterOfPosition(d.start)
      : { line: 0, character: 0 }
    const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n')
    console.error(`SYNTAX ERROR at line ${line + 1}, col ${character + 1}: ${msg}`)
  }
  console.error(`\n${syntaxErrors.length} syntax error(s) found in AgentRunner.ts.`)
  process.exit(1)
}

console.log('AgentRunner.ts parses cleanly.')
