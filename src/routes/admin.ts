import { Router, Request, Response } from 'express'
import { storage } from '../services/unified-storage.service'

const router = Router()

// Simple admin key check
const checkAdmin = (req: Request, res: Response): boolean => {
  const adminKey = req.headers['x-admin-key'] as string
  const expectedKey = process.env.ADMIN_KEY

  if (!expectedKey) {
    console.warn('⚠️ ADMIN_KEY not set in environment')
    res.status(500).json({ success: false, error: 'Admin key not configured' })
    return false
  }

  if (adminKey !== expectedKey) {
    res.status(401).json({ success: false, error: 'Unauthorized' })
    return false
  }

  return true
}

// POST /api/draw3d/admin/configure - Update collection config
router.post('/configure', async (req: Request, res: Response) => {
  if (!checkAdmin(req, res)) return

  try {
    const { supply, mintPrice, status, name, description } = req.body

    const updates: any = {}
    if (supply !== undefined) updates.supply = parseInt(supply)
    if (mintPrice !== undefined) updates.mintPrice = parseInt(mintPrice)
    if (status !== undefined) updates.status = status
    if (name !== undefined) updates.name = name
    if (description !== undefined) updates.description = description

    const collection = await storage.updateCollection(updates)
    console.log('🔧 [Admin] Collection updated:', updates)

    res.json({ success: true, collection })
  } catch (error: any) {
    console.error('❌ Admin configure error:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/draw3d/admin/orders - List all orders (admin view)
router.get('/orders', (req: Request, res: Response) => {
  if (!checkAdmin(req, res)) return

  try {
    const orders = storage.getAllOrders()
    res.json({
      success: true,
      orders: orders.map(o => ({
        id: o.id,
        orderId: o.orderId,
        creatorAddress: o.creatorAddress,
        amount: o.amount,
        status: o.status,
        inscriptionId: o.inscriptionId,
        createdAt: o.createdAt
      })),
      total: orders.length
    })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
