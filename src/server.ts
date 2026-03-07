/**
 * Draw-to-3D Backend Server
 * User-generated Three.js PFP art inscription service
 *
 * Port: 5009
 */

import dotenv from 'dotenv'
dotenv.config()

import express, { Application } from 'express'
import compression from 'compression'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'

import collectionRoutes from './routes/collection'
import mintRoutes from './routes/mint'
import adminRoutes from './routes/admin'
import { orderMonitoringService } from './services/order-monitoring.service'
import { collectionService } from './services/collection.service'
import { storage } from './services/unified-storage.service'

const app: Application = express()
const PORT = process.env.PORT || 5009

// Trust proxy for production
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1)
  console.log('🔒 Trust proxy enabled (production)')
}

// Security
app.use(helmet())

// CORS
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.FRONTEND_URL,
  'https://ord-dropz-frontend-production.up.railway.app',
  'https://ord-dropz.xyz',
  'https://www.ord-dropz.xyz',
  'https://admin.ord-dropz.xyz',
  'https://super-admin-production-f165.up.railway.app'
].filter(Boolean) as string[]

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}))

// Gzip compression
app.use(compression())

// Body parsing - 2MB limit for compressed HTML content
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true, limit: '2mb' }))

// Logging
app.use(morgan('dev'))

// Routes
app.use('/api/draw3d/collection', collectionRoutes)
console.log('✅ COLLECTION routes registered at /api/draw3d/collection')

// Mints list — must be registered before /mint to avoid segment matching issues
app.get('/api/draw3d/mints', (req, res) => {
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

app.use('/api/draw3d/mint', mintRoutes)
console.log('✅ MINT routes registered at /api/draw3d/mint')

app.use('/api/draw3d/admin', adminRoutes)
console.log('✅ ADMIN routes registered at /api/draw3d/admin')

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'OK',
    service: 'backend-draw3d',
    timestamp: new Date().toISOString()
  })
})

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'OK',
    service: 'backend-draw3d',
    timestamp: new Date().toISOString()
  })
})

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack)
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  })
})

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED REJECTION at:', promise)
  console.error('Reason:', reason)
})

// Resume monitoring for in-progress orders after server restart
async function resumeOrderMonitoring() {
  try {
    console.log('\n🔄 [Startup] Resuming monitoring for in-progress orders...')
    const allOrders = storage.getAllOrders()
    let resumedCount = 0

    for (const order of allOrders) {
      if (order.status === 'paid') {
        console.log(`   📋 Resuming monitoring: ${order.orderId}`)
        orderMonitoringService.startMonitoring(order.orderId)
        resumedCount++
      }
    }

    if (resumedCount > 0) {
      console.log(`✅ [Startup] Resumed monitoring for ${resumedCount} order(s)\n`)
    } else {
      console.log(`✅ [Startup] No in-progress orders to resume\n`)
    }
  } catch (error: any) {
    console.error('❌ [Startup] Error resuming order monitoring:', error.message)
  }
}

// Expire stale pending orders (initiated but never paid)
async function expireStaleOrders() {
  try {
    const allOrders = storage.getAllOrders()
    const now = Date.now()
    const EXPIRE_MINUTES = 30

    for (const order of allOrders) {
      if (order.status === 'pending') {
        const createdAt = new Date(order.createdAt).getTime()
        const minutesElapsed = (now - createdAt) / 60000

        if (minutesElapsed > EXPIRE_MINUTES) {
          console.log(`⏰ [Cleanup] Expiring stale order ${order.orderId} (${minutesElapsed.toFixed(0)} min old)`)
          order.status = 'expired'
          order.updatedAt = new Date().toISOString()
          await storage.saveOrder(order)

          if (order.mintId) {
            await collectionService.failMint(order.mintId)
          }
        }
      }
    }
  } catch (error: any) {
    console.error('❌ [Cleanup] Error expiring stale orders:', error.message)
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🎨 DRAW-TO-3D BACKEND STARTED                          ║
║                                                          ║
║   Port: ${PORT}                                            ║
║   Environment: ${process.env.NODE_ENV || 'development'}                       ║
║                                                          ║
║   Endpoints:                                             ║
║   - GET  /api/draw3d/collection                          ║
║   - POST /api/draw3d/mint/initiate                       ║
║   - POST /api/draw3d/mint/confirm                        ║
║   - GET  /api/draw3d/mint/status/:orderId                ║
║   - POST /api/draw3d/mint/estimate                       ║
║   - GET  /api/draw3d/mint/:id                            ║
║   - GET  /api/draw3d/mints                               ║
║   - POST /api/draw3d/admin/configure                     ║
║   - GET  /api/draw3d/admin/orders                        ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `)

  // Log env var status
  console.log('🔑 ENV CHECK:')
  console.log(`   UNISAT_API_KEY: ${process.env.UNISAT_API_KEY ? '✅ SET (' + process.env.UNISAT_API_KEY.slice(0, 6) + '...)' : '❌ NOT SET'}`)
  console.log(`   PLATFORM_FEE_ADDRESS: ${process.env.PLATFORM_FEE_ADDRESS ? '✅ SET' : '❌ NOT SET'}`)
  console.log(`   REDIS_URL: ${process.env.REDIS_URL ? '✅ SET' : '❌ NOT SET'}`)
  console.log(`   FRONTEND_URL: ${process.env.FRONTEND_URL || 'not set'}`)

  // Resume monitoring for any in-progress orders
  resumeOrderMonitoring()

  // Run stale order cleanup every 5 minutes
  setInterval(expireStaleOrders, 5 * 60 * 1000)
})
