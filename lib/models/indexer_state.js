export class IndexerState {
  #db

  constructor(db) {
    this.#db = db
  }

  async getLastBlockHeight() {
    return new Promise((resolve, reject) => {
      this.#db.get('SELECT last_block_height FROM indexer_state LIMIT 1', (err, row) => {
        if (err) reject(err)
        else resolve(row ? row.last_block_height : 0)
      })
    })
  }

  async updateLastBlockHeight(blockHeight) {
    return new Promise((resolve, reject) => {
      this.#db.run('UPDATE indexer_state SET last_block_height = ?', [blockHeight], (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }
} 