import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'
import { storage } from './unified-storage.service'
import { MintOrder } from '../types/draw3d.types'

const UNISAT_OPEN_API_URL = process.env.UNISAT_OPEN_API_URL || 'https://open-api.unisat.io'

const unisatClient = axios.create({
  baseURL: UNISAT_OPEN_API_URL
})

unisatClient.interceptors.request.use((config) => {
  const apiKey = process.env.UNISAT_API_KEY
  if (!apiKey) {
    throw new Error('UNISAT_API_KEY is not configured')
  }
  config.headers['Authorization'] = `Bearer ${apiKey}`
  config.headers['Content-Type'] = 'application/json'
  config.headers['Accept'] = 'application/json'
  return config
})

class InscriptionService {
  /**
   * Create a Unisat inscription order for a Draw-to-3D mint.
   * The HTML content is base64-encoded and sent as a text/html file.
   */
  async createOrder(params: {
    receiveAddress: string
    feeRate: number
    htmlContent: string
    mintPrice: number
  }): Promise<MintOrder> {
    const { receiveAddress, feeRate, htmlContent, mintPrice } = params

    console.log(`📝 [Draw3D] Creating inscription order:`)
    console.log(`  Receiver: ${receiveAddress}`)
    console.log(`  Fee Rate: ${feeRate} sat/vB`)
    console.log(`  Content Size: ${htmlContent.length} bytes`)

    // Base64 encode the HTML content for Unisat
    const base64Content = Buffer.from(htmlContent).toString('base64')
    const dataURL = `data:text/html;base64,${base64Content}`

    const requestData: any = {
      receiveAddress: receiveAddress.trim(),
      feeRate: Math.max(1, feeRate),
      outputValue: 546,
      files: [{
        filename: 'draw3d.html',
        dataURL
      }]
    }

    // Add mint price as devFee if applicable
    const platformAddress = process.env.PLATFORM_FEE_ADDRESS
    if (mintPrice > 0 && platformAddress) {
      requestData.devAddress = platformAddress
      requestData.devFee = mintPrice
    }

    try {
      const response = await unisatClient.post('/v2/inscribe/order/create', requestData)

      if ((response.data.code === 0 || response.data.code === 1) && response.data.data) {
        const orderData = response.data.data

        console.log(`✅ [Draw3D] Order created: ${orderData.orderId}`)
        console.log(`  Pay: ${orderData.payAddress}`)
        console.log(`  Amount: ${orderData.amount} sats`)

        const order: MintOrder = {
          id: uuidv4(),
          mintId: '', // Set later after mint creation
          creatorAddress: receiveAddress,
          orderId: orderData.orderId,
          payAddress: orderData.payAddress,
          amount: orderData.amount,
          feeRate,
          status: 'pending',
          contentHtml: htmlContent,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }

        await storage.saveOrder(order)
        return order
      } else {
        throw new Error(response.data.msg || 'Failed to create inscription order')
      }
    } catch (error: any) {
      console.error(`❌ [Draw3D] Order creation failed:`, error.message)
      if (error.response?.data) {
        console.error('API Error:', JSON.stringify(error.response.data, null, 2))
      }
      throw new Error(error.response?.data?.msg || error.message)
    }
  }

  /**
   * Check Unisat order status and update local records
   */
  async checkOrderStatus(orderId: string): Promise<any> {
    try {
      const response = await unisatClient.get(`/v2/inscribe/order/${orderId}`)

      if ((response.data.code === 0 || response.data.code === 1) && response.data.data) {
        const orderData = response.data.data
        console.log(`📊 [Draw3D] Order ${orderId} status: ${orderData.status}`)
        return orderData
      }
      throw new Error(response.data.msg || 'Failed to get order status')
    } catch (error: any) {
      console.error(`❌ [Draw3D] Status check failed:`, error.message)
      throw error
    }
  }

  /**
   * Estimate inscription fee (client-side convenience)
   */
  estimateFee(params: {
    contentSize: number
    feeRate: number
    receiveAddress: string
  }): number {
    const { contentSize, feeRate, receiveAddress } = params

    let addrSize = 26
    if (receiveAddress.startsWith('bc1q') || receiveAddress.startsWith('tb1q')) {
      addrSize = 23
    } else if (receiveAddress.startsWith('bc1p') || receiveAddress.startsWith('tb1p')) {
      addrSize = 35
    } else if (receiveAddress.startsWith('2') || receiveAddress.startsWith('3')) {
      addrSize = 24
    }

    const baseSize = 88
    const contentTypeSize = 100

    const networkSats = Math.ceil(
      ((contentSize + contentTypeSize) / 4 + (baseSize + 8 + addrSize + 8 + 23)) * feeRate
    )

    const serviceFee = Math.ceil(contentSize * 0.05)
    const outputValue = 546

    return networkSats + serviceFee + outputValue
  }
}

export const inscriptionService = new InscriptionService()
