const Razorpay = require('razorpay');
const crypto = require('crypto');
const logger = require('../config/logger');

let razorpayClient;

const isConfigured = () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

const getClient = () => {
  if (!isConfigured()) {
    throw new Error('Razorpay credentials are not configured');
  }

  if (!razorpayClient) {
    razorpayClient = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });
  }

  return razorpayClient;
};

const createOrder = async ({ amount, currency, receipt, notes }) => {
  try {
    const client = getClient();
    return await client.orders.create({
      amount,
      currency,
      receipt,
      notes
    });
  } catch (error) {
    logger.error('Failed to create Razorpay order:', error);
    throw error;
  }
};

const verifySignature = ({ orderId, paymentId, signature }) => {
  if (!isConfigured()) return false;

  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return expectedSignature === signature;
};

module.exports = {
  isConfigured,
  createOrder,
  verifySignature
};
