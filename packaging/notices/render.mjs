// Writes THIRD-PARTY-NOTICES.txt: the licence of every crate and npm package built into a
// release, which those licences require to travel with the binaries.
//   pnpm notices [out file]   (default target/notices/THIRD-PARTY-NOTICES.txt)
// Needs cargo-about (`cargo install --locked --features cli cargo-about`) and `pnpm install`.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const out = resolve(process.argv[2] ?? join(root, 'target/notices/THIRD-PARTY-NOTICES.txt'))

// devDependencies whose code still lands in the window's bundle: Tailwind compiles its preflight
// and utilities into the CSS.
const BUNDLED_DEV_PACKAGES = ['tailwindcss']

const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'inherit'] })

// --frozen keeps cargo-about off the network (no ClearlyDefined lookups), so the notices come only
// from the crates' own files and the lockfile; --fail stops on a crate whose licence text is missing.
run('cargo', ['fetch', '--locked', '--quiet'])
const crates = JSON.parse(
  run('cargo', ['about', 'generate', '--frozen', '--fail', '--workspace', '--format', 'json', '-c', 'packaging/notices/about.toml']),
)

const npmPackages = Object.values(JSON.parse(run('pnpm', ['licenses', 'list', '--prod', '--json'])))
  .flat()
  .flatMap((pkg) => pkg.versions.map((version, i) => ({ name: pkg.name, version, licence: pkg.license, path: pkg.paths[i] })))
for (const name of BUNDLED_DEV_PACKAGES) {
  const path = realpathSync(join(root, 'node_modules', name))
  const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
  npmPackages.push({ name, version: manifest.version, licence: manifest.license, path })
}
npmPackages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))

// Drops blank lines around a text but keeps its first line's indentation (Apache's centred title).
const tidy = (text) => text.replace(/^\s*\n/, '').trimEnd()

// Every licence file, since a dual-licensed package (MIT OR Apache-2.0) ships one per licence.
const licenceText = (pkg) => {
  const files = readdirSync(pkg.path)
    .filter((name) => /^(licen[cs]e|copying)/i.test(name))
    .sort()
  if (files.length === 0) throw new Error(`${pkg.name} ${pkg.version} has no licence file in ${pkg.path}`)
  return files.map((file) => tidy(readFileSync(join(pkg.path, file), 'utf8'))).join('\n\n')
}

const heading = (title) => `${'='.repeat(78)}\n${title}\n${'='.repeat(78)}\n`
const entry = (title, text) => `${'-'.repeat(78)}\n${title}\n${'-'.repeat(78)}\n\n${tidy(text)}\n`

const sections = [
  `EnvRouter third-party notices

EnvRouter is Copyright (C) 2026 Tyler Robertson and Pixel Perfect Software Inc., licensed under
the GNU General Public License v3.0 or later (LICENSE). It is built with the open source software
below, each part under its own licence, reproduced here. The Rust standard library, compiled into
every binary, is under MIT OR Apache-2.0, like many of the crates below.
`,
  heading('Rust crates'),
  ...crates.licenses.map((licence) => {
    const users = licence.used_by.map(({ crate }) => `${crate.name} ${crate.version}`)
    return entry(`${licence.name} (${licence.id})\nUsed by: ${[...new Set(users)].sort().join(', ')}`, licence.text)
  }),
  heading('JavaScript packages (the app window)'),
  ...npmPackages.map((pkg) => entry(`${pkg.name} ${pkg.version} (${pkg.licence})`, licenceText(pkg))),
]

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, sections.join('\n'))
console.log(`Wrote ${out}: ${crates.crates.length} crates, ${npmPackages.length} npm packages`)
