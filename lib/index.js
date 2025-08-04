import sqlite3 from 'sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { IndexerState } from './models/indexer_state.js'
import { Labitbu } from './models/labitbu.js'
import { WebpParser } from './models/webp_parser.js'
import { Tap } from '@cmdcode/tapscript'
import { hex } from "@scure/base"
import axios from 'axios'

const execAsync = promisify(exec)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const STARTING_BLOCK = 908070
const POLLING_INTERVAL = 1000
const ERROR_RETRY_DELAY = 5000

const LABITBU_INTERNAL_KEY = hex.decode(`96053db5b18967b5a410326ecca687441579225a6d190f398e2180deec6e429e`)

const ORD_API_SERVER = `http://0.0.0.0`

class LabitbuIndexer {
  #dbPath
  #db
  #indexerState
  #labitbu

  constructor() {
    this.#dbPath = join(__dirname, '..', 'data', 'labitbu.db')
    this.#db = null
    this.#indexerState = null
    this.#labitbu = null
  }

  async run() {
    console.log(`Starting indexing from block ${STARTING_BLOCK}`)
    
    // while (true) {
      try {
        this.#connect()
        await this.#runPollingLoop()
        // await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL))
      } catch (error) {
        console.error('Indexing error:', error)
        this.disconnect()
        await new Promise(resolve => setTimeout(resolve, ERROR_RETRY_DELAY))
      }
    // }
  }

  #connect() {
    this.#db = new sqlite3.Database(this.#dbPath)
    this.#indexerState = new IndexerState(this.#db)
    this.#labitbu = new Labitbu(this.#db)
  }

  disconnect() {
    if (this.#db) this.#db.close()
  }

  async #flushDatabase() {
    return new Promise((resolve, reject) => {
      this.#db.run('PRAGMA wal_checkpoint(FULL)', (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  async #getBlockHash(blockHeight) {
    const { stdout } = await execAsync(`bitcoin-cli getblockhash ${blockHeight}`)
    return stdout.trim()
  }

  async #getBlockTransactions(blockHeight) {
    const blockHash = await this.#getBlockHash(blockHeight)
    const { stdout } = await execAsync(`bitcoin-cli getblock ${blockHash} 2`, { maxBuffer: 50 * 1024 * 1024 })
    const block = JSON.parse(stdout)
    return block.tx || []
  }

  async #getLatestBlockHeight() {
    const response = await axios.get(`${ORD_API_SERVER}/blockheight`, {
      headers: { 'Accept': 'application/json' },
      timeout: 30000
    })

    return parseInt(response.data)
  }
  
  async #processTransaction(tx, blockHeight) {
    for (let vinIndex = 0; vinIndex < tx.vin.length; vinIndex++) {
      const vin = tx.vin[vinIndex]

      if (vin.txinwitness && vin.txinwitness.length === 3 && vin.txinwitness[2].length > 8192) {
        const cBlock = Tap.util.readCtrlBlock(vin.txinwitness[2])

        if (Buffer.from(cBlock.intkey).equals(LABITBU_INTERNAL_KEY)) {
          console.log(`Found labitbu in tx: ${tx.txid}`)

          const webpParser = new WebpParser(hex.decode(vin.txinwitness[2]))
          if (webpParser.checksum) {
            console.log(`WebP found, checksum: ${webpParser.checksum}`)
            
            await this.#labitbu.insert(tx.txid, vinIndex, webpParser.checksum)
            console.log(`Inserted labitbu record for tx: ${tx.txid}`)
          } else {
            console.log(`No WebP data found in tx: ${tx.txid}`)
          }
        }
      }
    }
  }

  async #processBlock(blockHeight) {
    console.log(`Processing block ${blockHeight}`)
    
    const transactions = await this.#getBlockTransactions(blockHeight)
    console.log(`Found ${transactions.length} transactions in block ${blockHeight}`)
    
    for (const tx of transactions) {
      await this.#processTransaction(tx, blockHeight)
    }
  }

  async #runPollingLoop() {
    let currentBlock = await this.#indexerState.getLastBlockHeight()
    if (currentBlock === 0) currentBlock = STARTING_BLOCK
    
    const latestBlockHeight = await this.#getLatestBlockHeight()
    
    if (currentBlock === latestBlockHeight) {
      console.log(`Caught up to latest block (${latestBlockHeight}), waiting for new blocks...`)
      return
    }
    
    console.log(`Processing blocks ${currentBlock} to ${latestBlockHeight}`)
    
    while (currentBlock <= latestBlockHeight) {
      console.log(`Processing block ${currentBlock} (latest: ${latestBlockHeight})`)

      await this.#processBlock(currentBlock)
      await this.#flushDatabase()

      currentBlock++
    }

    await this.#indexerState.updateLastBlockHeight(currentBlock)
  }
}

const indexer = new LabitbuIndexer()

process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...')
  indexer.disconnect()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...')
  indexer.disconnect()
  process.exit(0)
})

indexer.run()
  .catch((error) => {
    console.error('Indexing failed:', error)
    process.exit(1)
  })
