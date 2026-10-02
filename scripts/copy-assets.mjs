import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `tsc` compiles TypeScript only; the icons a node or credential declares must be copied alongside
 * their compiled module, because n8n resolves `file:` icons relative to the declaring file.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const assets = [
	'nodes/MauKirim/maukirim.svg',
	'nodes/MauKirim/maukirim-dark.svg',
	'credentials/maukirim.svg',
	'credentials/maukirim-dark.svg',
]

for (const asset of assets) {
	const destination = join(repoRoot, 'dist', asset)
	await mkdir(dirname(destination), { recursive: true })
	await copyFile(join(repoRoot, asset), destination)
}
