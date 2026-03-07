import { Router, Request, Response } from 'express'
import { collectionService } from '../services/collection.service'

const router = Router()

// GET /api/draw3d/collection - Get collection info
router.get('/', (_req: Request, res: Response) => {
  try {
    const info = collectionService.getCollectionInfo()
    res.json({ success: true, collection: info })
  } catch (error: any) {
    console.error('❌ Error getting collection info:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
