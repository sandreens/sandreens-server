const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: { type: String, required: true },
    image: { type: String },
    price: { type: Number, required: true },
    size: { type: String },
    qty: { type: Number, required: true, default: 1 }
});

const orderSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    customerName: { type: String, required: true },
    phone: { type: String, required: true },
    shippingAddress: {
        fullName: { type: String, required: true },
        email: { type: String, required: true },
        addressLine1: { type: String, required: true },
        addressLine2: { type: String, default: '' },
        city: { type: String, required: true },
        postcode: { type: String, required: true },
        countryCode: { type: String, default: 'GBR' }
    },
    orderItems: [orderItemSchema],
    subTotal: { type: Number, required: true },
    shippingPrice: { type: Number, required: true },
    totalPrice: { type: Number, required: true, default: 0 },
    couponCode: { type: String, default: null },
    discountAmount: { type: Number, default: 0 },
    paymentMethod: { type: String, default: 'COD' },
    paymentStatus: {
        type: String,
        enum: ['Unpaid', 'Paid', 'Refunded'],
        default: 'Unpaid'
    },
    paymentResult: {
        id: String,
        status: String,
        update_time: String,
        email_address: String
    },
    orderStatus: {
        type: String,
        enum: ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'],
        default: 'Pending'
    },
    isPaid: { type: Boolean, default: false },
    paidAt: { type: Date },
    isDelivered: { type: Boolean, default: false },
    deliveredAt: { type: Date },
    notes: { type: String },
    trackingNumber: { type: String, default: '' },
    carrierName: { type: String, default: 'Royal Mail' },
    royalMailOrderId: { type: String, default: '' },
    courierStatus: {
        type: String,
        enum: ['Pending', 'Processing', 'Dispatched', 'Delivered', 'Cancelled'],
        default: 'Pending'
    },
    paymentIntentId: { type: String, default: '' },
    refundRequest: {
        isRequested: { type: Boolean, default: false },
        reason: { type: String, default: '' },
        comment: { type: String, default: '' },
        images: [{ type: String }],
        status: { type: String, enum: ['None', 'Pending', 'Approved', 'Rejected'], default: 'None' },
        requestedAt: { type: Date }
    },
    returnStatus: {
        type: String,
        enum: ['None', 'Requested', 'Approved', 'Rejected'],
        default: 'None'
    },
    returnReason: { type: String },
    returnRequestedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
