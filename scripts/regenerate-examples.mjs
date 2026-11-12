// Rewrites every shipped example (src/examples/*.gamut.json) in the current
// canonical format: parsed, migrated, and serialized again by the application's
// own canonical-document module. Run it with `npm run examples:regenerate`
// after a format version change, then review the diff.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runnerImport } from 'vite'

const examples = fileURLToPath(new URL('../src/examples/', import.meta.url))
const { module } = await runnerImport(
  fileURLToPath(new URL('../src/document/canonicalDocument.ts', import.meta.url)),
  { configFile: false, logLevel: 'error' },
)

for (const name of readdirSync(examples).filter((file) => file.endsWith('.gamut.json')).sort()) {
  const path = examples + name
  const source = readFileSync(path, 'utf8')
  const canonical = `${module.serializeCanonicalDocument(module.parseCanonicalDocument(source))}\n`
  if (canonical === source) {
    console.log(`${name}: unchanged`)
  } else {
    writeFileSync(path, canonical)
    console.log(`${name}: rewritten`)
  }
}
