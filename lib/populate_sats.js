import sqlite3 from 'sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import axios from 'axios'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const dbPath = join(__dirname, '..', 'data', 'labitbu.db')

const ORD_API_SERVER = `http://0.0.0.0`
const ELECTRS_API_SERVER = `https://mempool.space/api`

class SatPopulator {
  #db

  constructor() {
    this.#db = new sqlite3.Database(dbPath)
  }

  async #getEntriesWithNullSat() {
    return new Promise((resolve, reject) => {
      this.#db.all(
        'SELECT id, txid, vin FROM labitbus WHERE sat IS NULL',
        (err, rows) => {
          if (err) reject(err)
          else resolve(rows)
        }
      )
    })
  }

  async #getEntriesWithSatButNoInscription() {
    return new Promise((resolve, reject) => {
      this.#db.all(
        'SELECT id, sat FROM labitbus WHERE sat IS NOT NULL AND inscription_id IS NULL',
        (err, rows) => {
          if (err) reject(err)
          else resolve(rows)
        }
      )
    })
  }

  async #updateSatAndInscription(id, sat, inscriptionId) {
    return new Promise((resolve, reject) => {
      this.#db.run(
        'UPDATE labitbus SET sat = ?, inscription_id = ? WHERE id = ?',
        [sat, inscriptionId, id],
        function(err) {
          if (err) reject(err)
          else resolve(this.changes)
        }
      )
    })
  }

  async #findSat(txid, vin) {
    console.log(`Looking up sat for txid: ${txid}, vin: ${vin}`)
    
    return await this.#findSatFromUTXO(txid) || await this.#findSatFromOutspends(txid)
  }

  async #findSatFromUTXO(txid) {
    try {
      const response = await axios.get(`${ORD_API_SERVER}/output/${txid}:0`, {
        headers: { 'Accept': 'application/json' },
        timeout: 10000
      })
      
      const output = response.data
      
      if (output.spent) {
        console.log(`Output ${txid}:0 is spent, skipping`)
        return null
      }
      
      if (!output.sat_ranges || output.sat_ranges.length === 0) {
        console.log(`No sat ranges found for ${txid}:0`)
        return null
      }
      
      const firstSatRange = output.sat_ranges[0]
      const sat = firstSatRange[0]
      
      console.log(`Found sat: ${sat} for txid: ${txid}`)
      
      return sat
      
    } catch (error) {
      console.error(`Error looking up sat for ${txid}:`, error.message)
      return null
    }
  }

  async #findSatFromOutspends(txid) {
    console.log(`Looking up outspends for txid: ${txid}`)
    
    let currentTxid = txid
    let depth = 0
    const maxDepth = 10
    
    while (depth < maxDepth) {
      try {
        const response = await axios.get(`${ELECTRS_API_SERVER}/tx/${currentTxid}/outspend/0`, {
          headers: { 'Accept': 'application/json' },
          timeout: 10000
        })
        
        const outspend = response.data
        
        if (!outspend.spent) {
          console.log(`Found unspent output at depth ${depth}: ${currentTxid}:0`)
          return await this.#findSatFromUTXO(currentTxid)
        }
        
        if (outspend.vin !== 0) {
          console.log(`Output ${currentTxid}:0 is spent by ${outspend.txid}:${outspend.vin} (vin not 0, stopping)`)
          return null
        }
        
        console.log(`Output ${currentTxid}:0 is spent by ${outspend.txid}:${outspend.vin}`)
        
        currentTxid = outspend.txid
        depth++
      } catch (error) {
        console.error(`Error looking up outspend for ${currentTxid}:0:`, error.message)
        return null
      }
    }
    
    console.log(`Reached max depth ${maxDepth} for txid: ${txid}`)
    return null
  }

  async #findInscriptionForSat(sat) {
    try {
      console.log(`Looking up inscription for sat: ${sat}`)
      
      const response = await axios.get(`${ORD_API_SERVER}/sat/${sat}`, {
        headers: { 'Accept': 'application/json' },
        timeout: 10000
      })
      
      const satData = response.data
      
      if (satData.inscriptions && satData.inscriptions.length > 0) {
        const inscriptionId = satData.inscriptions[0]
        console.log(`Found inscription: ${inscriptionId} for sat: ${sat}`)
        return inscriptionId
      }
      
      console.log(`No inscription found for sat: ${sat}`)
      return null
      
    } catch (error) {
      console.error(`Error looking up inscription for sat ${sat}:`, error.message)
      return null
    }
  }

  async #processBatch(entries) {
    console.log(`Processing ${entries.length} entries with null sat values`)
    
    for (const entry of entries) {
      try {
        const sat = await this.#findSat(entry.txid, entry.vin)
        
        if (sat !== null) {
          await this.#updateSatAndInscription(entry.id, sat, null)
          console.log(`Updated entry ${entry.id}: sat=${sat}`)
        } else {
          console.log(`No sat found for entry ${entry.id}`)
        }
      } catch (error) {
        console.error(`Error processing entry ${entry.id}:`, error)
      }
    }
  }

  async #processInscriptionBatch(entries) {
    console.log(`Processing ${entries.length} entries with sat but no inscription`)
    
    for (const entry of entries) {
      try {
        const inscriptionId = await this.#findInscriptionForSat(entry.sat)
        
        if (inscriptionId !== null) {
          await this.#updateSatAndInscription(entry.id, entry.sat, inscriptionId)
          console.log(`Updated entry ${entry.id}: inscription=${inscriptionId}`)
        } else {
          console.log(`No inscription found for entry ${entry.id}`)
        }
      } catch (error) {
        console.error(`Error processing entry ${entry.id}:`, error)
      }
    }
  }

  async run() {
    try {
      console.log('Starting sat population process...')
      
      const entries = await this.#getEntriesWithNullSat()
      console.log(`Found ${entries.length} entries with null sat values`)
      
      if (entries.length > 0) {
        await this.#processBatch(entries)
        console.log('Sat population process completed')
      } else {
        console.log('No entries to process for sat population')
      }
      
      console.log('Starting inscription population process...')
      
      const inscriptionEntries = await this.#getEntriesWithSatButNoInscription()
      console.log(`Found ${inscriptionEntries.length} entries with sat but no inscription`)
      
      if (inscriptionEntries.length > 0) {
        await this.#processInscriptionBatch(inscriptionEntries)
        console.log('Inscription population process completed')
      } else {
        console.log('No entries to process for inscription population')
      }
      
    } catch (error) {
      console.error('Error in population process:', error)
      throw error
    } finally {
      this.#db.close()
    }
  }
}

const populator = new SatPopulator()

populator.run()
  .then(() => {
    console.log('Sat population completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Sat population failed:', error)
    process.exit(1)
  }) 