import crypto from 'crypto'

export class WebpParser {
  #cBlock
  #checksum

  constructor(cBlock) {
    this.#cBlock = new Uint8Array(cBlock)
    this.#calculateChecksum()
  }

  get checksum() {
    return this.#checksum
  }

  #calculateChecksum() {
    try {
      const riffStart = this.#findRiffHeader()
      
      if (riffStart !== -1) {
        const webpData = this.#cBlock.slice(riffStart, riffStart + 8192)
        this.#checksum = crypto.createHash('sha256').update(webpData).digest('hex')
      } else {
        this.#checksum = null
      }
    } catch (error) {
      console.error('Error generating checksum:', error)
      this.#checksum = null
    }
  }

  #findRiffHeader() {
    for (let i = 0; i < this.#cBlock.length - 4; i++) {
      if (this.#cBlock[i] === 0x52 && 
          this.#cBlock[i + 1] === 0x49 && 
          this.#cBlock[i + 2] === 0x46 && 
          this.#cBlock[i + 3] === 0x46) {
        return i
      }
    }

    return -1
  }
} 