import sqlite3 from 'sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import axios from 'axios'
import { decode } from 'cbor2'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const dbPath = join(__dirname, '..', 'data', 'labitbu.db')

const ORD_API_SERVER = `http://0.0.0.0`

const EXPECTED_DELEGATE = '0afcead3c7b6c065ec4e00411aec22f04f8b93d9a81de690bbc161b14d1beb00i0'

class InscriptionValidator {
  #db

  constructor() {
    this.#db = new sqlite3.Database(dbPath)
  }

  async #getEntriesWithInscriptions() {
    return new Promise((resolve, reject) => {
      this.#db.all(
        'SELECT id, txid, inscription_id, sat FROM labitbus WHERE inscription_id IS NOT NULL',
        (err, rows) => {
          if (err) reject(err)
          else resolve(rows)
        }
      )
    })
  }

  async #validateInscription(inscriptionId, sat) {
    try {
      const validTxids = await this.#getTxidsForSat(sat)
      
      if (validTxids.length === 0) {
        return { valid: false, reason: 'no_txids_for_sat' }
      }
      
      const inscriptionResponse = await axios.get(`${ORD_API_SERVER}/r/inscription/${inscriptionId}`, {
        headers: { 'Accept': 'application/json' },
        timeout: 10000
      })
      
      const inscription = inscriptionResponse.data
      
      if (inscription.delegate !== EXPECTED_DELEGATE) {
        const validAlternative = await this.#findValidInscriptionOnSat(sat, validTxids, inscriptionId)
        return { 
          valid: false, 
          reason: 'wrong_delegate', 
          actual: inscription.delegate,
          validAlternative
        }
      }
      
      const metadataResponse = await axios.get(`${ORD_API_SERVER}/r/metadata/${inscriptionId}`, {
        headers: { 'Accept': 'application/json' },
        timeout: 10000
      })
      
      const metadataHex = metadataResponse.data
      
      if (!metadataHex || typeof metadataHex !== 'string') {
        const validAlternative = await this.#findValidInscriptionOnSat(sat, validTxids, inscriptionId)
        return { 
          valid: false, 
          reason: 'no_metadata',
          validAlternative
        }
      }
      
      const metadata = this.#decodeCborMetadata(metadataHex)
      
      if (!metadata || !metadata.labitbu) {
        const validAlternative = await this.#findValidInscriptionOnSat(sat, validTxids, inscriptionId)
        return { 
          valid: false, 
          reason: 'no_labitbu_key',
          validAlternative
        }
      }
      
      if (!validTxids.includes(metadata.labitbu)) {
        const validAlternative = await this.#findValidInscriptionOnSat(sat, validTxids, inscriptionId)
        return { 
          valid: false, 
          reason: 'wrong_txid', 
          actual: metadata.labitbu,
          validAlternative
        }
      }
      
      return { valid: true }
      
    } catch (error) {
      return { valid: false, reason: 'api_error', error: error.message }
    }
  }

  async #findValidInscriptionOnSat(sat, validTxids, excludeInscriptionId) {
    try {
      const response = await axios.get(`${ORD_API_SERVER}/sat/${sat}`, {
        headers: { 'Accept': 'application/json' },
        timeout: 10000
      })
      
      const satData = response.data
      
      if (!satData.inscriptions || satData.inscriptions.length === 0) {
        return null
      }
      
      for (const inscriptionId of satData.inscriptions) {
        if (inscriptionId === excludeInscriptionId) {
          continue
        }
        
        try {
          const inscriptionResponse = await axios.get(`${ORD_API_SERVER}/r/inscription/${inscriptionId}`, {
            headers: { 'Accept': 'application/json' },
            timeout: 10000
          })
          
          const inscription = inscriptionResponse.data
          
          if (inscription.delegate !== EXPECTED_DELEGATE) {
            continue
          }
          
          const metadataResponse = await axios.get(`${ORD_API_SERVER}/r/metadata/${inscriptionId}`, {
            headers: { 'Accept': 'application/json' },
            timeout: 10000
          })
          
          const metadataHex = metadataResponse.data
          
          if (!metadataHex || typeof metadataHex !== 'string') {
            continue
          }
          
          const metadata = this.#decodeCborMetadata(metadataHex)
          
          if (!metadata || !metadata.labitbu) {
            continue
          }
          
          if (validTxids.includes(metadata.labitbu)) {
            return inscriptionId
          }
          
        } catch (error) {
          continue
        }
      }
      
      return null
      
    } catch (error) {
      return null
    }
  }

  async #getTxidsForSat(sat) {
    return new Promise((resolve, reject) => {
      this.#db.all(
        'SELECT DISTINCT txid FROM labitbus WHERE sat = ?',
        [sat],
        (err, rows) => {
          if (err) reject(err)
          else resolve(rows.map(row => row.txid))
        }
      )
    })
  }

  async #updateInscriptionId(id, inscriptionId) {
    return new Promise((resolve, reject) => {
      this.#db.run(
        'UPDATE labitbus SET inscription_id = ? WHERE id = ?',
        [inscriptionId, id],
        function(err) {
          if (err) reject(err)
          else resolve(this.changes)
        }
      )
    })
  }

  async #clearInscriptionId(id) {
    return new Promise((resolve, reject) => {
      this.#db.run(
        'UPDATE labitbus SET inscription_id = NULL WHERE id = ?',
        [id],
        function(err) {
          if (err) reject(err)
          else resolve(this.changes)
        }
      )
    })
  }

  #decodeCborMetadata(hexString) {
    try {
      const buffer = Buffer.from(hexString, 'hex')
      const decoded = decode(buffer)
      return decoded
    } catch (error) {
      console.error('Error decoding CBOR metadata:', error.message)
      return null
    }
  }



  async run() {
    try {
      console.log('Starting inscription validation process...')
      
      const entries = await this.#getEntriesWithInscriptions()
      console.log(`Found ${entries.length} entries with inscriptions to validate`)
      
      const results = {
        total: entries.length,
        valid: 0,
        invalid: 0,
        invalidWithAlternative: 0,
        updated: 0,
        cleared: 0,
        errors: 0,
        reasons: {}
      }
      
      for (const entry of entries) {
        try {
          const validation = await this.#validateInscription(entry.inscription_id, entry.sat)
          
          const reason = validation.reason || 'unknown'
          const details = validation.actual || validation.error || ''
          
          if (validation.valid) {
            results.valid++
          } else {
            results.invalid++
            results.reasons[reason] = (results.reasons[reason] || 0) + 1
            console.log(`❌ Entry ${entry.id} (${entry.txid}): ${reason}`)
            if (details) {
              console.log(`  Details: ${details}`)
            }
            if (validation.validAlternative) {
              results.invalidWithAlternative++
              console.log(`  ✅ Valid alternative found on same sat: ${validation.validAlternative}`)
              await this.#updateInscriptionId(entry.id, validation.validAlternative)
              results.updated++
              console.log(`  🔄 Updated entry ${entry.id} with valid inscription: ${validation.validAlternative}`)
            } else {
              await this.#clearInscriptionId(entry.id)
              results.cleared++
              console.log(`  🗑️ Cleared invalid inscription from entry ${entry.id}`)
            }
          }
          
        } catch (error) {
          console.error(`Error processing entry ${entry.id}:`, error)
          results.errors++
        }
      }
      
      console.log('\n=== VALIDATION RESULTS ===')
      console.log(`Total entries: ${results.total}`)
      console.log(`Valid inscriptions: ${results.valid}`)
      console.log(`Invalid inscriptions: ${results.invalid}`)
      console.log(`Invalid with valid alternative: ${results.invalidWithAlternative}`)
      console.log(`Updated with valid inscription: ${results.updated}`)
      console.log(`Cleared invalid inscriptions: ${results.cleared}`)
      console.log(`Processing errors: ${results.errors}`)
      console.log('\nInvalid reasons:')
      for (const [reason, count] of Object.entries(results.reasons)) {
        console.log(`  ${reason}: ${count}`)
      }
      
    } catch (error) {
      console.error('Error in validation process:', error)
      throw error
    } finally {
      this.#db.close()
    }
  }
}

const validator = new InscriptionValidator()

validator.run()
  .then(() => {
    console.log('Inscription validation completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Inscription validation failed:', error)
    process.exit(1)
  }) 