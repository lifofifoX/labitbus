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
} 