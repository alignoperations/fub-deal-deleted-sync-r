const axios = require('axios');

// Test webhook payload
const testPayload = {
  resourceIds: ['test_deal_123'],
  event: 'deal.deleted',
  timestamp: new Date().toISOString()
};

// Alternative payload format
const alternativePayload = {
  dealId: 'test_deal_456',
  action: 'deleted',
  timestamp: new Date().toISOString()
};

async function testWebhook(baseUrl = 'http://localhost:3000') {
  console.log('🧪 Testing FUB Deal Deleted Sync Webhook...');
  console.log(`📡 Target URL: ${baseUrl}`);

  try {
    // Test health endpoint first
    console.log('\n1. Testing health endpoint...');
    const healthResponse = await axios.get(`${baseUrl}/health`);
    console.log('✅ Health check passed:', healthResponse.data);

    // Test webhook with first payload format
    console.log('\n2. Testing webhook with resourceIds format...');
    const response1 = await axios.post(`${baseUrl}/webhook/deal-deleted`, testPayload);
    console.log('📤 Sent payload:', testPayload);
    console.log('📥 Response:', response1.data);

    // Test webhook with alternative payload format
    console.log('\n3. Testing webhook with dealId format...');
    const response2 = await axios.post(`${baseUrl}/webhook/deal-deleted`, alternativePayload);
    console.log('📤 Sent payload:', alternativePayload);
    console.log('📥 Response:', response2.data);

    // Test with invalid payload
    console.log('\n4. Testing webhook with invalid payload...');
    try {
      const response3 = await axios.post(`${baseUrl}/webhook/deal-deleted`, { invalid: 'payload' });
      console.log('📥 Response:', response3.data);
    } catch (err) {
      console.log('❌ Expected error for invalid payload:', err.response?.data);
    }

    console.log('\n✅ All tests completed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// Run tests
if (require.main === module) {
  const baseUrl = process.argv[2] || 'http://localhost:3000';
  testWebhook(baseUrl);
}

module.exports = { testWebhook };