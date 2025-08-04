import sqlite3 from 'sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const dbPath = join(__dirname, 'data', 'labitbu.db')

async function exportDatabase() {
  const db = new sqlite3.Database(dbPath)
  
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM labitbus ORDER BY id DESC', (err, rows) => {
      if (err) {
        reject(err)
      } else {
        resolve(rows)
      }
      db.close()
    })
  })
}

async function generateStats() {
  const db = new sqlite3.Database(dbPath)
  
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT 
        COUNT(*) as total_entries,
        COUNT(CASE WHEN sat IS NOT NULL THEN 1 END) as entries_with_sat,
        COUNT(CASE WHEN inscription_id IS NOT NULL THEN 1 END) as entries_with_inscription,
        COUNT(DISTINCT checksum) as unique_checksums
      FROM labitbus
    `, (err, row) => {
      if (err) {
        reject(err)
      } else {
        resolve(row)
      }
      db.close()
    })
  })
}

async function main() {
  try {
    console.log('Exporting database...')
    const data = await exportDatabase()
    const stats = await generateStats()
    
    const exportData = {
      stats,
      data,
      lastUpdated: new Date().toISOString()
    }
    
    fs.writeFileSync('docs/db_export.json', JSON.stringify(exportData, null, 2))
    console.log(`Exported ${data.length} entries to docs/db_export.json`)
    console.log('Stats:', stats)
    
  } catch (error) {
    console.error('Export failed:', error)
    process.exit(1)
  }
}

main() 