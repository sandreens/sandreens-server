const express = require('express');
const router = express.Router();

router.get('/shipping', (req, res) => {
  res.json({
    shippingFee: parseFloat(process.env.SHIPPING_FEE || '3.99'),
    freeShippingThreshold: parseFloat(process.env.FREE_SHIPPING_THRESHOLD || '50.00')
  });
});

module.exports = router;
