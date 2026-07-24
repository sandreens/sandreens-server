const Order = require('../models/Order');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const { calculateShipping } = require('../utils/shippingCalculator');

// @desc    Get all orders
// @route   GET /api/orders
// @access  Private/Admin
const getAllOrders = async (req, res) => {
    try {
        const orders = await Order.find({})
            .populate('user', 'name email')
            .sort({ createdAt: -1 });
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get logged-in user's own orders
// @route   GET /api/orders/myorders
// @access  Private
const getMyOrders = async (req, res) => {
    try {
        const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Request a return/refund for own order (Legacy fallback)
// @route   PUT /api/orders/:id/return
// @access  Private
const requestReturn = async (req, res) => {
    try {
        const { returnReason } = req.body;
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        if (order.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized for this order' });
        }

        if (order.orderStatus !== 'Delivered') {
            return res.status(400).json({ message: 'Only delivered orders can be returned' });
        }

        if (order.returnStatus !== 'None') {
            return res.status(400).json({ message: 'Return already requested for this order' });
        }

        order.returnStatus = 'Requested';
        order.returnReason = returnReason || '';
        order.returnRequestedAt = new Date();

        order.refundRequest = {
            isRequested: true,
            reason: returnReason || 'Defective',
            comment: '',
            images: [],
            status: 'Pending',
            requestedAt: new Date()
        };

        const updated = await order.save();
        res.json(updated);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get single order
// @route   GET /api/orders/:id
// @access  Private/Admin
const getOrderById = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id).populate('user', 'name email');
        if (!order) return res.status(404).json({ message: 'Order not found' });
        res.json(order);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Create new order (updated with dynamic shipping calculator and GBR address validation)
// @route   POST /api/orders
// @access  Private
const createOrder = async (req, res) => {
    try {
        const { customerName, phone, shippingAddress, orderItems, paymentMethod, notes, couponCode } = req.body;

        if (!shippingAddress || !shippingAddress.addressLine1 || !shippingAddress.city || !shippingAddress.postcode) {
            return res.status(400).json({ message: 'Address Line 1, City, and Postcode are required' });
        }

        // Validate items and calculate subTotal backend-side
        let subTotal = 0;
        const validatedOrderItems = [];
        for (const item of orderItems) {
            const product = await Product.findById(item.product);
            if (!product) {
                return res.status(404).json({ message: `Product not found: ${item.name}` });
            }
            const price = product.salePrice !== null && product.salePrice !== undefined ? product.salePrice : product.price;
            subTotal += price * item.qty;
            validatedOrderItems.push({
                product: product._id,
                name: product.name,
                image: product.images?.[0] || product.imageUrl || '',
                price,
                size: item.size,
                qty: item.qty
            });
        }

        // Coupon discount check
        let discountAmount = 0;
        if (couponCode) {
            const coupon = await Coupon.findOne({ code: couponCode.toUpperCase().trim() });
            if (coupon && coupon.isActive && (!coupon.expiryDate || new Date(coupon.expiryDate) >= new Date()) && subTotal >= coupon.minOrderAmount) {
                if (coupon.discountType === 'percentage') {
                    discountAmount = (subTotal * coupon.discountValue) / 100;
                    if (coupon.maxDiscount !== null && discountAmount > coupon.maxDiscount) {
                        discountAmount = coupon.maxDiscount;
                    }
                } else {
                    discountAmount = coupon.discountValue;
                }
                if (discountAmount > subTotal) discountAmount = subTotal;
                discountAmount = Number(discountAmount.toFixed(2));
            }
        }

        // Calculate shipping using dynamic calculator utility
        const { shippingPrice, totalPrice } = calculateShipping(subTotal - discountAmount);

        // Snap user email from auth
        const userEmail = req.user.email;

        const order = await Order.create({
            user: req.user ? req.user._id : null,
            customerName,
            phone,
            shippingAddress: {
                fullName: customerName,
                email: userEmail,
                addressLine1: shippingAddress.addressLine1,
                addressLine2: shippingAddress.addressLine2 || '',
                city: shippingAddress.city,
                postcode: shippingAddress.postcode,
                countryCode: shippingAddress.countryCode || 'GBR'
            },
            orderItems: validatedOrderItems,
            subTotal,
            shippingPrice,
            totalPrice,
            couponCode: couponCode || null,
            discountAmount,
            paymentMethod: paymentMethod || 'COD',
            notes,
            paymentIntentId: 'COD-' + Date.now(), // placeholder
            courierStatus: 'Pending',
            orderStatus: 'Pending'
        });

        res.status(201).json(order);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
const updateOrderStatus = async (req, res) => {
    try {
        const { orderStatus } = req.body;
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        const STATUS_HIERARCHY = {
            'Pending': 0,
            'Processing': 1,
            'Shipped': 2,
            'Delivered': 3,
            'Cancelled': 4
        };

        const currentIdx = STATUS_HIERARCHY[order.orderStatus] !== undefined ? STATUS_HIERARCHY[order.orderStatus] : 0;
        const newIdx = STATUS_HIERARCHY[orderStatus] !== undefined ? STATUS_HIERARCHY[orderStatus] : 0;

        // Block modifications if already Cancelled or Delivered (terminal states)
        if (order.orderStatus === 'Cancelled' || order.orderStatus === 'Delivered') {
            return res.status(400).json({ message: `Cannot modify terminal order status: ${order.orderStatus}` });
        }

        // Prevent moving backward (e.g. from Processing back to Pending)
        if (newIdx < currentIdx) {
            return res.status(400).json({ message: `Cannot change status backward from ${order.orderStatus} to ${orderStatus}` });
        }

        order.orderStatus = orderStatus;
        
        // Sync orderStatus and courierStatus
        if (orderStatus === 'Delivered') {
            order.isDelivered = true;
            order.deliveredAt = new Date();
            order.courierStatus = 'Delivered';
        } else if (orderStatus === 'Shipped') {
            order.courierStatus = 'Dispatched';
        } else if (orderStatus === 'Cancelled') {
            order.courierStatus = 'Cancelled';
        } else if (orderStatus === 'Processing') {
            order.courierStatus = 'Processing';
        } else if (orderStatus === 'Pending') {
            order.courierStatus = 'Pending';
        }

        const updated = await order.save();
        res.json(updated);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Update payment status
// @route   PUT /api/orders/:id/pay
// @access  Private/Admin
const updatePaymentStatus = async (req, res) => {
    try {
        const { paymentStatus, paymentResult } = req.body;
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        order.paymentStatus = paymentStatus;
        if (paymentStatus === 'Paid') {
            order.isPaid = true;
            order.paidAt = new Date();
            order.paymentResult = paymentResult;
        }

        const updated = await order.save();
        res.json(updated);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Delete order
// @route   DELETE /api/orders/:id
// @access  Private/Admin
const deleteOrder = async (req, res) => {
    try {
        const order = await Order.findByIdAndDelete(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found' });
        res.json({ message: 'Order deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Admin: approve or reject a return request (legacy dropdown fallback)
// @route   PUT /api/orders/:id/return-status
// @access  Private/Admin
const updateReturnStatus = async (req, res) => {
    try {
        const { returnStatus } = req.body; // 'Approved' or 'Rejected'
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        order.returnStatus = returnStatus;

        // If approved, mark payment as refunded
        if (returnStatus === 'Approved') {
            order.paymentStatus = 'Refunded';
        }

        // Keep refundRequest in sync
        if (order.refundRequest) {
            order.refundRequest.status = returnStatus;
        }

        const updated = await order.save();
        res.json(updated);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Send order to Royal Mail Click & Drop Courier
// @route   PUT /api/orders/:id/send-to-courier
// @access  Private/Admin
const sendToCourier = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id).populate('orderItems.product');
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        if (order.courierStatus === 'Dispatched') {
            return res.status(400).json({ message: 'Order already sent to courier' });
        }

        // Calculate total weight (Default to 500g if missing)
        let totalWeight = 0;
        if (order.orderItems && order.orderItems.length > 0) {
            for (const item of order.orderItems) {
                const weight = item.product?.weightInGrams || 500;
                totalWeight += weight * item.qty;
            }
        } else {
            totalWeight = 500;
        }

        const rawUrl = (process.env.ROYAL_MAIL_API_URL || 'https://api.parcel.royalmail.com/api/v1/orders').trim();
        const apiKey = (process.env.ROYAL_MAIL_API_KEY || '').trim();

        // Mock response if API key is not configured
        if (!apiKey || apiKey === 'your_key_here') {
            const orderIdentifier = `RM-MOCK-${Math.floor(100000 + Math.random() * 900000)}`;
            order.trackingNumber = orderIdentifier;
            order.royalMailOrderId = orderIdentifier;
            order.courierStatus = 'Dispatched';
            order.orderStatus = 'Shipped';
            await order.save();
            return res.json(order);
        }

        // 💡 Click & Drop Exact Expected Payload Schema
        const shippingCostCharged = Number(order.shippingPrice) || 0;
        const subtotal = Number(order.subTotal) || (Number(order.totalPrice) - shippingCostCharged) || 0;
        const total = Number(order.totalPrice) || 0;

        const payload = {
            items: [
                {
                    orderReference: order._id.toString(),
                    orderDate: new Date(order.createdAt || Date.now()).toISOString(),
                    recipient: {
                        address: {
                            fullName: (order.shippingAddress?.fullName || order.customerName || 'Customer').slice(0, 40),
                            addressLine1: (order.shippingAddress?.addressLine1 || '').slice(0, 50),
                            addressLine2: (order.shippingAddress?.addressLine2 || '').slice(0, 50),
                            city: (order.shippingAddress?.city || '').slice(0, 40),
                            postcode: (order.shippingAddress?.postcode || order.shippingAddress?.postalCode || '').toUpperCase().trim().slice(0, 8),
                            countryCode: 'GBR' // Royal Mail wants 3-letter ISO code
                        },
                        emailAddress: order.shippingAddress?.email || '',
                        phoneNumber: order.phone || ''
                    },
                    packages: [
                        {
                            weightInGrams: Number(totalWeight) || 500,
                            packageFormatIdentifier: 'parcel'
                        }
                    ],
                    subtotal: Number(subtotal.toFixed(2)),
                    shippingCostCharged: Number(shippingCostCharged.toFixed(2)),
                    total: Number(total.toFixed(2)),
                    currencyCode: 'GBP'
                }
            ]
        };

        console.log("👉 Sending Payload to Royal Mail:", JSON.stringify(payload, null, 2));

        const response = await fetch(rawUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': apiKey
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            console.error("❌ Royal Mail Error Response:", JSON.stringify(data, null, 2));
            return res.status(response.status).json({
                message: data.message || `Royal Mail API returned status ${response.status}`,
                error: data
            });
        }

        console.log("✅ Royal Mail Success Response:", JSON.stringify(data, null, 2));

        // Click & Drop returns generated order details inside response array/object
        const orderIdentifier = 
            data.createdOrders?.[0]?.orderIdentifier || 
            data.orders?.[0]?.orderIdentifier || 
            data.orderIdentifier || 
            `RM-${Date.now()}`;

        order.trackingNumber = orderIdentifier;
        order.royalMailOrderId = orderIdentifier;
        order.courierStatus = 'Dispatched';
        order.orderStatus = 'Shipped';

        await order.save();
        res.json(order);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Cancel order by customer
// @route   PUT /api/orders/:id/cancel
// @access  Private
const cancelOrder = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        if (order.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized to cancel this order' });
        }

        if (order.courierStatus !== 'Pending' && order.courierStatus !== 'Processing') {
            return res.status(400).json({ message: 'Cannot cancel order. It has already been dispatched or cancelled.' });
        }

        order.courierStatus = 'Cancelled';
        order.orderStatus = 'Cancelled';

        // Restore stock
        for (const item of order.orderItems) {
            await Product.findByIdAndUpdate(item.product, {
                $inc: { stock: item.qty }
            });
        }

        await order.save();
        res.json(order);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Request a refund with Cloudinary images by customer
// @route   PUT /api/orders/:id/request-refund
// @access  Private
const requestRefund = async (req, res) => {
    try {
        const { reason, comment, images } = req.body;
        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        if (order.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized for this order' });
        }

        if (order.courierStatus !== 'Delivered') {
            return res.status(400).json({ message: 'Refunds can only be requested for delivered orders' });
        }

        order.refundRequest = {
            isRequested: true,
            reason: reason || 'Defective',
            comment: comment || '',
            images: images || [],
            status: 'Pending',
            requestedAt: new Date()
        };

        // For backward compatibility
        order.returnStatus = 'Requested';
        order.returnReason = reason + (comment ? `: ${comment}` : '');
        order.returnRequestedAt = new Date();

        await order.save();
        res.json(order);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Approve/Reject refund by admin
// @route   PUT /api/orders/:id/approve-refund
// @access  Private/Admin
const approveRefund = async (req, res) => {
    try {
        const { refundStatus } = req.body; // 'Approved' or 'Rejected'
        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        if (!order.refundRequest || order.refundRequest.status !== 'Pending') {
            return res.status(400).json({ message: 'No pending refund request found' });
        }

        order.refundRequest.status = refundStatus;
        order.returnStatus = refundStatus;

        if (refundStatus === 'Approved') {
            order.paymentStatus = 'Refunded';
        }

        await order.save();
        res.json(order);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = {
    getAllOrders,
    getMyOrders,
    getOrderById,
    createOrder,
    updateOrderStatus,
    updatePaymentStatus,
    deleteOrder,
    requestReturn,
    updateReturnStatus,
    sendToCourier,
    cancelOrder,
    requestRefund,
    approveRefund
};
