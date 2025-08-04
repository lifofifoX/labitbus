export class Labitbu {
  #db

  constructor(db) {
    this.#db = db
  }

  async insert(txid, vin, checksum) {
    return new Promise((resolve, reject) => {
      this.#db.run(
        'INSERT INTO labitbus (txid, vin, checksum) VALUES (?, ?, ?)',
        [txid, vin, checksum],
        function(err) {
          if (err) reject(err)
          else resolve(this.lastID)
        }
      )
    })
  }

  async findByTxid(txid) {
    return new Promise((resolve, reject) => {
      this.#db.all('SELECT * FROM labitbus WHERE txid = ?', [txid], (err, rows) => {
        if (err) reject(err)
        else resolve(rows)
      })
    })
  }

  async findByTxidAndSat(txid, sat) {
    return new Promise((resolve, reject) => {
      this.#db.get('SELECT * FROM labitbus WHERE txid = ? AND sat = ?', [txid, sat], (err, row) => {
        if (err) reject(err)
        else resolve(row)
      })
    })
  }
} 