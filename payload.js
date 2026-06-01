const payload = {
  event: 'successful.sale',
  sale: {
    id: 'test_sale_xb1knupovw6y',
    amount: {
      value: 9999,
      formatted: '9999$US',
      short: '10.0K',
      currency: 'USD'
    },
    status: 'completed',
    custom_fields: [ [Object], [Object] ],
    created_at: '2026-05-28T11:30:39.855716Z',
    completed_at: '2026-05-28T11:35:39.855814Z',
    abandoned_at: null
  },
  product: {
    id: 'test_product_juuw4bxhpk9n',
    name: 'Test Product',
    url: 'https://example.com/test-product',
    price: {
      value: 9999,
      formatted: '9999$US',
      short: '10.0K',
      currency: 'USD'
    }
  },
  customer: {
    id: 'test_customer_oin6fy9myo6f',
    name: 'John Doe',
    first_name: 'John',
    last_name: 'Doe',
    email: 'test@example.com',
    phone: '1234567890',
    country: 'US',
    created_at: '2026-05-27T11:35:39.856078Z'
  },
  store: {
    id: 'store_apgj18v8d1yo',
    name: 'Ecom Blueprint',
    url: 'https://plglnbtn.mychariow.shop',
    created_at: '2026-05-15T11:06:25.000000Z'
  },
  note: 'This is a test sale for pulse testing.'
}