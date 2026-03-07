import { Router, Request, Response } from 'express'
import { collectionService } from '../services/collection.service'
import { inscriptionService } from '../services/inscription.service'
import { orderMonitoringService } from '../services/order-monitoring.service'
import { storage } from '../services/unified-storage.service'

const router = Router()

// POST /api/draw3d/mint/initiate - Start a new mint
router.post('/initiate', async (req: Request, res: Response) => {
  try {
    const { htmlContent, receiveAddress, feeRate } = req.body

    if (!htmlContent || !receiveAddress || !feeRate) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: htmlContent, receiveAddress, feeRate'
      })
      return
    }

    // Check if minting is allowed (checks confirmed + pending against supply)
    const canMint = collectionService.canMint()
    if (!canMint.allowed) {
      res.status(403).json({ success: false, error: canMint.reason })
      return
    }

    // Size check - max 390KB
    const contentSize = Buffer.byteLength(htmlContent, 'utf-8')
    if (contentSize > 390 * 1024) {
      res.status(400).json({
        success: false,
        error: `Content too large: ${(contentSize / 1024).toFixed(1)}KB (max 390KB)`
      })
      return
    }

    const collection = storage.getCollection()

    // Create Unisat inscription order
    const order = await inscriptionService.createOrder({
      receiveAddress,
      feeRate: parseInt(feeRate),
      htmlContent,
      mintPrice: collection.mintPrice
    })

    // Create mint record (assigns mintNumber but does NOT increment confirmed mintCount)
    const mint = await collectionService.createMint({
      creatorAddress: receiveAddress,
      orderId: order.orderId,
      contentHtml: htmlContent,
      contentSize
    })

    // Link order to mint
    order.mintId = mint.id
    await storage.saveOrder(order)

    res.json({
      success: true,
      mint: {
        id: mint.id,
        mintNumber: mint.mintNumber
      },
      order: {
        orderId: order.orderId,
        payAddress: order.payAddress,
        amount: order.amount
      }
    })
  } catch (error: any) {
    console.error('❌ Mint initiate error:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// POST /api/draw3d/mint/confirm - Confirm payment was sent, start monitoring
router.post('/confirm', async (req: Request, res: Response) => {
  try {
    const { orderId, txId } = req.body

    if (!orderId) {
      res.status(400).json({ success: false, error: 'Missing orderId' })
      return
    }

    const order = storage.getOrderByUnisatId(orderId)
    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found' })
      return
    }

    // Update order with payment info
    order.status = 'paid'
    order.txId = txId
    order.updatedAt = new Date().toISOString()
    await storage.saveOrder(order)

    // Update mint status to paid
    if (order.mintId) {
      await collectionService.updateMintStatus(order.mintId, 'paid')
    }

    console.log(`✅ Payment confirmed for order ${orderId}, TX: ${txId}`)

    // Start monitoring the order for inscription completion
    orderMonitoringService.startMonitoring(orderId)

    res.json({
      success: true,
      message: 'Payment confirmed, monitoring inscription'
    })
  } catch (error: any) {
    console.error('❌ Mint confirm error:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/draw3d/mint/status/:orderId - Poll order + mint status
router.get('/status/:orderId', async (req: Request, res: Response) => {
  try {
    const orderId = req.params.orderId as string

    const order = storage.getOrderByUnisatId(orderId)
    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found' })
      return
    }

    const mint = order.mintId ? collectionService.getMint(order.mintId) : null

    res.json({
      success: true,
      order: {
        orderId: order.orderId,
        status: order.status,
        inscriptionId: order.inscriptionId || null,
        txId: order.txId || null
      },
      mint: mint ? {
        id: mint.id,
        mintNumber: mint.mintNumber,
        status: mint.status,
        inscriptionId: mint.inscriptionId
      } : null
    })
  } catch (error: any) {
    console.error('❌ Mint status error:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/draw3d/mints - List all mints (paginated, excludes failed by default)
// Must be defined BEFORE /:id to avoid the param catch-all grabbing "s"
router.get('s', (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const status = req.query.status as string | undefined
    const result = collectionService.getMints(page, Math.min(limit, 100), status)
    res.json({ success: true, ...result })
  } catch (error: any) {
    console.error('❌ List mints error:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/draw3d/mint/:id - Get mint details
router.get('/:id', (req: Request, res: Response) => {
  try {
    const id = req.params.id as string
    const mint = collectionService.getMint(id)

    if (!mint) {
      res.status(404).json({ success: false, error: 'Mint not found' })
      return
    }

    res.json({ success: true, mint })
  } catch (error: any) {
    console.error('❌ Get mint error:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// POST /api/draw3d/mint/estimate - Estimate inscription fee
router.post('/estimate', (req: Request, res: Response) => {
  try {
    const { contentSize, feeRate, receiveAddress } = req.body

    if (!contentSize || !feeRate || !receiveAddress) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: contentSize, feeRate, receiveAddress'
      })
      return
    }

    const estimated = inscriptionService.estimateFee({
      contentSize: parseInt(contentSize),
      feeRate: parseInt(feeRate),
      receiveAddress
    })

    const collection = storage.getCollection()

    res.json({
      success: true,
      estimate: {
        inscriptionFee: estimated,
        mintPrice: collection.mintPrice,
        total: estimated + collection.mintPrice
      }
    })
  } catch (error: any) {
    console.error('❌ Estimate error:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
