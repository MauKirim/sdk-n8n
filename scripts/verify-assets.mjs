import { access, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Guards the assets a published community node depends on. A community node may not import
 * `node:fs`, so this check lives in a script rather than in the jest suite.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const manifest = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))

const builtModules = [...manifest.n8n.credentials, ...manifest.n8n.nodes]

const failures = []

for (const modulePath of builtModules) {
	const absolute = join(repoRoot, modulePath)
	try {
		await access(absolute)
	} catch {
		failures.push(`manifest points at a missing build output: ${modulePath}`)
		continue
	}
	// Every `file:` icon the built module declares must sit next to it, because n8n resolves
	// the path relative to the declaring file.
	const source = await readFile(absolute, 'utf8')
	const iconDir = dirname(absolute)
	for (const [, icon] of source.matchAll(/file:([A-Za-z0-9._-]+\.svg)/g)) {
		try {
			await access(join(iconDir, icon))
		} catch {
			failures.push(`${modulePath} declares file:${icon}, which is not next to it`)
		}
	}
}

if (failures.length > 0) {
	for (const failure of failures) console.error(`verify-assets: ${failure}`)
	process.exit(1)
}

console.log(`verify-assets: ${builtModules.length} built modules and their declared icons are present`)
