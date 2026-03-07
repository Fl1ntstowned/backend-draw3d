export interface CollectionConfig {
  name: string
  description: string
  supply: number
  mintCount: number          // confirmed inscriptions only
  nextMintNumber: number     // auto-increment for assigning mint numbers
  mintPrice: number // sats
  status: 'active' | 'paused' | 'soldout'
  createdAt: string
  updatedAt: string
}

export const DEFAULT_COLLECTION: CollectionConfig = {
  name: 'Draw-to-3D PFP Collection',
  description: 'User-generated Three.js PFP art inscribed on Bitcoin',
  supply: 369,
  mintCount: 0,
  nextMintNumber: 0,
  mintPrice: 6500, // 6500 sats to mint
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}

export interface Mint {
  id: string
  mintNumber: number
  creatorAddress: string
  inscriptionId: string | null
  orderId: string
  contentHash: string
  contentSize: number
  timestamp: string
  status: 'pending' | 'paid' | 'inscribed' | 'failed'
}

export interface MintOrder {
  id: string
  mintId: string
  creatorAddress: string
  orderId: string // Unisat order ID
  payAddress: string
  amount: number // sats to pay
  feeRate: number
  status: 'pending' | 'paid' | 'inscribed' | 'failed' | 'expired'
  contentHtml: string
  createdAt: string
  updatedAt: string
  inscriptionId?: string
  txId?: string
}
