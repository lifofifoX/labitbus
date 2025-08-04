import { unlink } from 'fs/promises'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const dbPath = join(__dirname, '..', 'data', 'labitbu.db')

try {
  await unlink(dbPath)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const { exec } = await import('child_process')
const { promisify } = await import('util')
const execAsync = promisify(exec)

await execAsync('node lib/setup.js')
console.log('Database reset successfully')
 