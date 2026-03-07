import { inscriptionService } from './inscription.service'
import { collectionService } from './collection.service'
import { storage } from './unified-storage.service'

/**
 * Order Monitoring Service
 *
 * Polls Unisat API for order status until inscription is complete or order fails.
 * Mirrors the marketplace's order-monitoring.service.ts pattern.
 */

const monitoringIntervals: Map<string, NodeJS.Timeout> = new Map()

async function monitorOrder(orderId: string) {
  const order = storage.getOrderByUnisatId(orderId)
  if (!order) {
    console.error(`❌ [Monitor] Order ${orderId} not found`)
    stopMonitoring(orderId)
    return
  }

  // Already terminal — stop monitoring
  if (order.status === 'inscribed' || order.status === 'failed' || order.status === 'expired') {
    console.log(`✅ [Monitor] Order ${orderId} already ${order.status}, stopping`)
    stopMonitoring(orderId)
    return
  }

  try {
    console.log(`🔄 [Monitor] Checking order ${orderId}`)

    const orderData = await inscriptionService.checkOrderStatus(orderId)

    // Check for closed/cancelled/expired with no payment
    if ((orderData.status === 'closed' || orderData.status === 'cancelled' ||
         orderData.status === 'expired' || orderData.status === 'refunded') &&
        orderData.paidAmount === 0) {
      console.log(`❌ [Monitor] Order ${orderId} ${orderData.status} with no payment — marking as failed`)

      order.status = 'failed'
      order.updatedAt = new Date().toISOString()
      await storage.saveOrder(order)

      if (order.mintId) {
        await collectionService.failMint(order.mintId)
      }

      stopMonitoring(orderId)
      return
    }

    // Check if inscription is ready
    if (orderData.files && orderData.files.length > 0) {
      const allInscribed = orderData.files.every((f: any) => f.inscriptionId)

      if (allInscribed) {
        const inscriptionId = orderData.files[0].inscriptionId
        const inscriptionNumber = orderData.files[0].inscriptionNumber
        console.log(`✅ [Monitor] Inscription ready: ${inscriptionId} (#${inscriptionNumber})`)

        order.status = 'inscribed'
        order.inscriptionId = inscriptionId
        order.updatedAt = new Date().toISOString()
        await storage.saveOrder(order)

        if (order.mintId) {
          await collectionService.confirmMint(order.mintId, inscriptionId)
        }

        stopMonitoring(orderId)
      }
    } else if (orderData.status === 'minted') {
      // Unisat says minted but no file details yet — will get inscription ID on next poll
      console.log(`⏳ [Monitor] Order ${orderId} minted, waiting for inscription ID...`)
    }
  } catch (error: any) {
    console.error(`❌ [Monitor] Error monitoring order ${orderId}:`, error.message)
  }
}

function startMonitoring(orderId: string) {
  if (monitoringIntervals.has(orderId)) {
    console.log(`⏸️ [Monitor] Already monitoring ${orderId}`)
    return
  }

  console.log(`🚀 [Monitor] Starting monitoring for order ${orderId}`)

  // Check immediately
  monitorOrder(orderId)

  // Then check every 60 seconds
  const intervalId = setInterval(() => {
    monitorOrder(orderId)
  }, 60000)

  monitoringIntervals.set(orderId, intervalId)
}

function stopMonitoring(orderId: string) {
  const intervalId = monitoringIntervals.get(orderId)
  if (intervalId) {
    clearInterval(intervalId)
    monitoringIntervals.delete(orderId)
    console.log(`⏹️ [Monitor] Stopped monitoring order ${orderId}`)
  }
}

export const orderMonitoringService = {
  startMonitoring,
  stopMonitoring
}
