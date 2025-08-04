import sqlite3 from 'sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const dbPath = join(__dirname, '..', 'data', 'labitbu.db')

async function setupDatabase() {
  const db = new sqlite3.Database(dbPath)
  
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('PRAGMA journal_mode = WAL')
      db.run('PRAGMA synchronous = NORMAL')
      db.run('PRAGMA cache_size = 10000')
      db.run('PRAGMA temp_store = MEMORY')
      db.run('PRAGMA mmap_size = 268435456')
      
      db.run(`
        CREATE TABLE IF NOT EXISTS labitbus (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          txid TEXT NOT NULL,
          vin INTEGER NOT NULL,
          sat INTEGER,
          checksum TEXT NOT NULL,
          inscription_id TEXT
        )
      `)
      
      db.run(`
        CREATE TABLE IF NOT EXISTS indexer_state (
          last_block_height INTEGER NOT NULL
        )
      `)
      
      db.run('CREATE INDEX IF NOT EXISTS idx_labitbus_txid ON labitbus(txid)')
      db.run('CREATE INDEX IF NOT EXISTS idx_labitbus_sat ON labitbus(sat)')
      db.run('CREATE INDEX IF NOT EXISTS idx_labitbus_checksum ON labitbus(checksum)')
      db.run('CREATE INDEX IF NOT EXISTS idx_labitbus_inscription_id ON labitbus(inscription_id)')
      
      db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_labitbus_unique ON labitbus(txid, vin)')
      
      db.run('INSERT OR IGNORE INTO indexer_state (last_block_height) VALUES (0)')
      
      db.close((err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  })
}

setupDatabase()
  .then(() => {
    console.log('Database setup completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Database setup failed:', error)
    process.exit(1)
  })
