import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `tsc` compiles TypeScript only; static assets the node declares must be copied alongside it. */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const assets = [['nodes/MauKirim/maukirim.svg', 'dist/nodes/MauKirim/maukirim.svg']]

for (const [from, to] of assets) {
	const destination = join(repoRoot, to)
	await mkdir(dirname(destination), { recursive: true })
	await copyFile(join(repoRoot, from), destination)
}
