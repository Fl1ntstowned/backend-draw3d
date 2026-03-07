import { v4 as uuidv4 } from 'uuid'
import { storage } from './unified-storage.service'
import { Mint } from '../types/draw3d.types'
import * as crypto from 'crypto'

class CollectionService {
  getCollectionInfo() {
    const collection = storage.getCollection()
    return {
      name: collection.name,
      description: collection.description,
      supply: collection.supply,
      mintCount: collection.mintCount,
      remaining: collection.supply - collection.mintCount,
      mintPrice: collection.mintPrice,
      status: collection.status
    }
  }

  canMint(): { allowed: boolean; reason?: string } {
    const collection = storage.getCollection()

    if (collection.status === 'paused') {
      return { allowed: false, reason: 'Minting is currently paused' }
    }
    if (collection.status === 'soldout') {
      return { allowed: false, reason: 'Collection is sold out' }
    }

    // Check confirmed + pending against supply to prevent overselling
    const pendingCount = storage.getPendingMintCount()
    const totalReserved = collection.mintCount + pendingCount
    if (totalReserved >= collection.supply) {
      return { allowed: false, reason: 'Collection is sold out' }
    }

    return { allowed: true }
  }

  async createMint(params: {
    creatorAddress: string
    orderId: string
    contentHtml: string
    contentSize: number
  }): Promise<Mint> {
    const { creatorAddress, orderId, contentHtml, contentSize } = params

    const contentHash = crypto
      .createHash('sha256')
      .update(contentHtml)
      .digest('hex')

    // Tentative mint number for display — real number assigned on confirmation
    const collection = storage.getCollection()
    const mintNumber = collection.mintCount + 1

    const mint: Mint = {
      id: uuidv4(),
      mintNumber,
      creatorAddress,
      inscriptionId: null,
      orderId,
      contentHash,
      contentSize,
      timestamp: new Date().toISOString(),
      status: 'pending'
    }

    await storage.saveMint(mint)
    console.log(`🎨 Mint #${mintNumber} created for ${creatorAddress} (pending payment)`)
    return mint
  }

  async updateMintStatus(mintId: string, status: Mint['status'], inscriptionId?: string): Promise<Mint | null> {
    const mint = storage.getMint(mintId)
    if (!mint) return null

    mint.status = status
    if (inscriptionId) {
      mint.inscriptionId = inscriptionId
    }

    await storage.saveMint(mint)
    return mint
  }

  /**
   * Confirm a mint — called when Unisat reports inscription complete.
   * Increments the collection mintCount (the real confirmed count).
   */
  async confirmMint(mintId: string, inscriptionId: string): Promise<Mint | null> {
    const mint = storage.getMint(mintId)
    if (!mint) return null

    // Avoid double-counting
    if (mint.status === 'inscribed') {
      console.log(`⚠️ Mint ${mintId} already confirmed, skipping`)
      return mint
    }

    // Assign real mint number based on confirmed count, then increment
    const collection = storage.getCollection()
    mint.mintNumber = collection.mintCount + 1
    mint.status = 'inscribed'
    mint.inscriptionId = inscriptionId
    await storage.saveMint(mint)

    const newCount = await storage.incrementMintCount()
    console.log(`✅ Mint #${mint.mintNumber} confirmed! Collection count: ${newCount}`)

    return mint
  }

  /**
   * Mark a mint as failed — called when order expires/cancels without payment.
   * Does NOT affect mintCount (was never incremented).
   */
  async failMint(mintId: string): Promise<void> {
    const mint = storage.getMint(mintId)
    if (!mint) return

    // Don't fail already-confirmed or already-failed mints
    if (mint.status === 'inscribed' || mint.status === 'failed') return

    mint.status = 'failed'
    await storage.saveMint(mint)
    console.log(`❌ Mint #${mint.mintNumber} marked as failed`)
  }

  getMint(id: string): Mint | null {
    return storage.getMint(id)
  }

  getMintByOrderId(orderId: string): Mint | null {
    return storage.getMintByOrderId(orderId)
  }

  getMints(page: number = 1, limit: number = 20, statusFilter?: string): { mints: Mint[]; total: number; page: number; totalPages: number } {
    let allMints = storage.getAllMints()

    // Filter by status if provided, otherwise exclude failed mints
    if (statusFilter) {
      allMints = allMints.filter(m => m.status === statusFilter)
    } else {
      allMints = allMints.filter(m => m.status !== 'failed')
    }

    const total = allMints.length
    const totalPages = Math.ceil(total / limit)
    const start = (page - 1) * limit
    const mints = allMints.slice(start, start + limit)

    return { mints, total, page, totalPages }
  }
}

export const collectionService = new CollectionService()
