const SHIPPING_FEE = parseFloat(process.env.SHIPPING_FEE || '3.99');
const FREE_SHIPPING_THRESHOLD = parseFloat(process.env.FREE_SHIPPING_THRESHOLD || '50.00');

function calculateShipping(subTotal) {
  const shippingPrice = subTotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
  return {
    shippingPrice,
    totalPrice: parseFloat((subTotal + shippingPrice).toFixed(2))
  };
}

module.exports = { calculateShipping, SHIPPING_FEE, FREE_SHIPPING_THRESHOLD };
