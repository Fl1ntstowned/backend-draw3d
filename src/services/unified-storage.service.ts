import Redis from 'ioredis'
import * as fs from 'fs'
import * as path from 'path'
import { CollectionConfig, DEFAULT_COLLECTION, Mint, MintOrder } from '../types/draw3d.types'

const STORAGE_KEYS = {
  COLLECTION: 'draw3d:collection',
  MINTS: 'draw3d:mints',
  ORDERS: 'draw3d:orders'
}

class UnifiedStorageService {
  private redis: Redis | null = null
  private useRedis: boolean = false

  private collectionCache: CollectionConfig = DEFAULT_COLLECTION
  private mintsCache: Map<string, Mint> = new Map()
  private ordersCache: Map<string, MintOrder> = new Map()
  private initialized: boolean = false

  private storageDir = process.env.DRAW3D_DATA_DIR || path.join(process.cwd(), 'data')

  constructor() {
    this.initRedis()
  }

  private initRedis() {
    const redisUrl = process.env.REDIS_URL

    if (redisUrl) {
      try {
        this.redis = new Redis(redisUrl, {
          family: 0,
          maxRetriesPerRequest: 3,
          retryStrategy(times: number) {
            const delay = Math.min(times * 50, 2000)
            return delay
          },
          lazyConnect: true
        })

        this.redis.connect()
          .then(() => {
            console.log('✅ Redis connected successfully (Railway production mode)')
            this.useRedis = true
            this.loadFromRedis()
          })
          .catch((err: any) => {
            console.warn('⚠️ Redis connection failed, falling back to file storage:', err.message)
            this.useRedis = false
            this.redis = null
            this.loadFromFile()
          })

        this.redis.on('error', (err: any) => {
          console.warn('⚠️ Redis error (non-fatal):', err.message)
        })
      } catch (error: any) {
        console.warn('⚠️ Failed to initialize Redis, using file storage:', error.message)
        this.useRedis = false
        this.redis = null
        this.loadFromFile()
      }
    } else {
      console.log('📁 No REDIS_URL found - using file storage (local dev mode)')
      this.useRedis = false
      this.loadFromFile()
    }
  }

  private async loadFromRedis() {
    try {
      if (!this.redis) return

      // Load collection config
      const collectionData = await this.redis.get(STORAGE_KEYS.COLLECTION)
      if (collectionData) {
        this.collectionCache = JSON.parse(collectionData)
        console.log('💾 [Redis] Loaded collection config')
      } else {
        console.log('💾 [Redis] No collection config, using defaults')
      }

      // Load mints
      const mintsData = await this.redis.hgetall(STORAGE_KEYS.MINTS)
      if (mintsData) {
        for (const [id, json] of Object.entries(mintsData)) {
          this.mintsCache.set(id, JSON.parse(json))
        }
      }
      console.log(`💾 [Redis] Loaded ${this.mintsCache.size} mints`)

      // Load orders
      const ordersData = await this.redis.hgetall(STORAGE_KEYS.ORDERS)
      if (ordersData) {
        for (const [id, json] of Object.entries(ordersData)) {
          this.ordersCache.set(id, JSON.parse(json))
        }
      }
      console.log(`💾 [Redis] Loaded ${this.ordersCache.size} orders`)

      this.initialized = true
      this.migrateData()
    } catch (error: any) {
      console.error('❌ [Redis] Load failed, falling back to file storage:', error.message)
      this.useRedis = false
      this.redis = null
      this.loadFromFile()
    }
  }

  private loadFromFile() {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true })
      }

      // Load collection
      const collectionFile = path.join(this.storageDir, 'collection.json')
      if (fs.existsSync(collectionFile)) {
        this.collectionCache = JSON.parse(fs.readFileSync(collectionFile, 'utf-8'))
        console.log('📁 [File] Loaded collection config')
      } else {
        console.log('📁 [File] No collection config, using defaults')
      }

      // Load mints
      const mintsFile = path.join(this.storageDir, 'mints.json')
      if (fs.existsSync(mintsFile)) {
        const parsed = JSON.parse(fs.readFileSync(mintsFile, 'utf-8'))
        for (const [id, mint] of Object.entries(parsed)) {
          this.mintsCache.set(id, mint as Mint)
        }
        console.log(`📁 [File] Loaded ${this.mintsCache.size} mints`)
      }

      // Load orders
      const ordersFile = path.join(this.storageDir, 'orders.json')
      if (fs.existsSync(ordersFile)) {
        const parsed = JSON.parse(fs.readFileSync(ordersFile, 'utf-8'))
        for (const [id, order] of Object.entries(parsed)) {
          this.ordersCache.set(id, order as MintOrder)
        }
        console.log(`📁 [File] Loaded ${this.ordersCache.size} orders`)
      }

      this.initialized = true
      this.migrateData()
    } catch (error: any) {
      console.error('❌ [File] Failed to load:', error.message)
      this.initialized = true
    }
  }

  /**
   * One-time migration: initialize nextMintNumber and fix mintCount
   * to reflect only confirmed inscriptions (not pending/failed ones).
   */
  private migrateData() {
    let needsSave = false

    // Initialize nextMintNumber from existing mints if missing
    if (this.collectionCache.nextMintNumber === undefined || this.collectionCache.nextMintNumber === null) {
      let maxNumber = 0
      for (const mint of this.mintsCache.values()) {
        if (mint.mintNumber > maxNumber) maxNumber = mint.mintNumber
      }
      this.collectionCache.nextMintNumber = maxNumber
      console.log(`🔄 [Migration] Initialized nextMintNumber to ${maxNumber}`)
      needsSave = true
    }

    // Fix mintCount to only reflect confirmed inscriptions
    let confirmedCount = 0
    for (const mint of this.mintsCache.values()) {
      if (mint.status === 'inscribed') confirmedCount++
    }

    if (this.collectionCache.mintCount !== confirmedCount) {
      console.log(`🔄 [Migration] Fixing mintCount: ${this.collectionCache.mintCount} -> ${confirmedCount} (confirmed inscriptions)`)
      this.collectionCache.mintCount = confirmedCount

      // Fix soldout status if count was wrong
      if (confirmedCount < this.collectionCache.supply && this.collectionCache.status === 'soldout') {
        this.collectionCache.status = 'active'
      }
      needsSave = true
    }

    if (needsSave) {
      this.collectionCache.updatedAt = new Date().toISOString()
      this.saveCollection()
    }
  }

  // ===== PERSISTENCE =====

  private async saveCollection() {
    if (this.useRedis && this.redis) {
      try {
        await this.redis.set(STORAGE_KEYS.COLLECTION, JSON.stringify(this.collectionCache))
      } catch (error: any) {
        console.error('❌ [Redis] Collection save failed:', error.message)
        this.persistToFile()
      }
    } else {
      this.persistToFile()
    }
  }

  private async saveHashItem(key: string, id: string, item: any) {
    if (this.useRedis && this.redis) {
      try {
        await this.redis.hset(key, id, JSON.stringify(item))
      } catch (error: any) {
        console.error(`❌ [Redis] Save failed for ${key}:${id}:`, error.message)
        this.persistToFile()
      }
    } else {
      this.persistToFile()
    }
  }

  private persistToFile() {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true })
      }

      fs.writeFileSync(
        path.join(this.storageDir, 'collection.json'),
        JSON.stringify(this.collectionCache, null, 2)
      )

      const mintsObj: Record<string, Mint> = {}
      this.mintsCache.forEach((mint, id) => { mintsObj[id] = mint })
      fs.writeFileSync(
        path.join(this.storageDir, 'mints.json'),
        JSON.stringify(mintsObj, null, 2)
      )

      const ordersObj: Record<string, MintOrder> = {}
      this.ordersCache.forEach((order, id) => { ordersObj[id] = order })
      fs.writeFileSync(
        path.join(this.storageDir, 'orders.json'),
        JSON.stringify(ordersObj, null, 2)
      )
    } catch (error: any) {
      console.error('❌ [File] Persist failed:', error.message)
    }
  }

  // ===== COLLECTION =====

  getCollection(): CollectionConfig {
    return { ...this.collectionCache }
  }

  async updateCollection(updates: Partial<CollectionConfig>): Promise<CollectionConfig> {
    this.collectionCache = {
      ...this.collectionCache,
      ...updates,
      updatedAt: new Date().toISOString()
    }
    await this.saveCollection()
    return this.collectionCache
  }

  async assignNextMintNumber(): Promise<number> {
    this.collectionCache.nextMintNumber = (this.collectionCache.nextMintNumber || 0) + 1
    this.collectionCache.updatedAt = new Date().toISOString()
    await this.saveCollection()
    return this.collectionCache.nextMintNumber
  }

  async incrementMintCount(): Promise<number> {
    this.collectionCache.mintCount += 1
    if (this.collectionCache.mintCount >= this.collectionCache.supply) {
      this.collectionCache.status = 'soldout'
    }
    this.collectionCache.updatedAt = new Date().toISOString()
    await this.saveCollection()
    return this.collectionCache.mintCount
  }

  getPendingMintCount(): number {
    let count = 0
    for (const mint of this.mintsCache.values()) {
      if (mint.status === 'pending' || mint.status === 'paid') {
        count++
      }
    }
    return count
  }

  // ===== MINTS =====

  getMint(id: string): Mint | null {
    return this.mintsCache.get(id) || null
  }

  getMintByOrderId(orderId: string): Mint | null {
    for (const mint of this.mintsCache.values()) {
      if (mint.orderId === orderId) return mint
    }
    return null
  }

  getAllMints(): Mint[] {
    return Array.from(this.mintsCache.values()).sort((a, b) => a.mintNumber - b.mintNumber)
  }

  async saveMint(mint: Mint): Promise<void> {
    this.mintsCache.set(mint.id, mint)
    await this.saveHashItem(STORAGE_KEYS.MINTS, mint.id, mint)
  }

  // ===== ORDERS =====

  getOrder(id: string): MintOrder | null {
    return this.ordersCache.get(id) || null
  }

  getOrderByUnisatId(unisatOrderId: string): MintOrder | null {
    for (const order of this.ordersCache.values()) {
      if (order.orderId === unisatOrderId) return order
    }
    return null
  }

  getAllOrders(): MintOrder[] {
    return Array.from(this.ordersCache.values())
  }

  async saveOrder(order: MintOrder): Promise<void> {
    this.ordersCache.set(order.id, order)
    await this.saveHashItem(STORAGE_KEYS.ORDERS, order.id, order)
  }

  // ===== UTILITY =====

  isReady(): boolean {
    return this.initialized
  }

  getMode(): 'redis' | 'file' {
    return this.useRedis ? 'redis' : 'file'
  }
}

export const storage = new UnifiedStorageService()
