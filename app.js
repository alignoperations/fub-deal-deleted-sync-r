require('dotenv').config();
const express = require('express');
const axios = require('axios');

class FubDealDeletedSync {
  constructor(config) {
    this.config = config;
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
  }

  setupRoutes() {
    this.app.post('/webhook/deal-deleted', this.handleDealDeletion.bind(this));
    this.app.get('/health', (req, res) => res.json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      service: 'fub-deal-deleted-sync'
    }));
  }

  async handleDealDeletion(req, res) {
    try {
      console.log('🗑️ Received deal deletion webhook:', JSON.stringify(req.body, null, 2));
      
      // Extract deal ID from webhook payload
      const dealId = this.extractDealId(req.body);
      
      if (!dealId) {
        console.log('❌ No deal ID found in webhook payload');
        return res.status(400).json({ 
          status: 'error', 
          message: 'No deal ID found in webhook payload' 
        });
      }

      console.log(`🔍 Processing deletion for deal ID: ${dealId}`);

      // Find the corresponding Airtable record
      const airtableRecord = await this.findAirtableRecord('Transactions Log', 'FUB Deal ID', dealId);
      
      if (!airtableRecord) {
        console.log(`⚠️ No Airtable record found for deal ID: ${dealId}`);
        return res.json({ 
          status: 'not_found', 
          message: `No Airtable record found for deal ID: ${dealId}` 
        });
      }

      console.log(`📋 Found Airtable record: ${airtableRecord.id}`);

      // Delete the Airtable record
      await this.deleteAirtableRecord('Transactions Log', airtableRecord.id);
      
      console.log(`✅ Successfully deleted Airtable record ${airtableRecord.id} for deal ${dealId}`);

      // Send success notification to Slack
      await this.sendSlackNotification(dealId, airtableRecord.id, 'success');

      return res.json({ 
        status: 'success', 
        dealId: dealId,
        deletedRecordId: airtableRecord.id
      });

    } catch (err) {
      console.error('❌ Processing error:', err.message);
      
      // Send error notification to Slack
      await this.sendSlackNotification(
        req.body?.resourceIds?.[0] || 'unknown', 
        null, 
        'error', 
        err.message
      );

      return res.status(500).json({ 
        status: 'error', 
        message: err.message 
      });
    }
  }

  extractDealId(webhookPayload) {
    // Handle different webhook payload structures
    if (webhookPayload.resourceIds && webhookPayload.resourceIds.length > 0) {
      return webhookPayload.resourceIds[0];
    }
    
    if (webhookPayload.dealId) {
      return webhookPayload.dealId;
    }
    
    if (webhookPayload.id) {
      return webhookPayload.id;
    }
    
    // Handle nested data structures
    if (webhookPayload.data && webhookPayload.data.id) {
      return webhookPayload.data.id;
    }
    
    return null;
  }

  async findAirtableRecord(tableName, fieldName, searchValue) {
    const tableId = this.getTableId(tableName);
    
    try {
      const response = await axios.get(
        `${this.config.airtableBaseUrl}/${tableId}`,
        {
          headers: { 
            Authorization: `Bearer ${this.config.airtableToken}` 
          },
          params: { 
            filterByFormula: `{${fieldName}} = "${searchValue}"`, 
            maxRecords: 1 
          }
        }
      );
      
      return response.data.records[0] || null;
    } catch (err) {
      console.error(`Error finding Airtable record: ${err.message}`);
      throw new Error(`Failed to find Airtable record: ${err.message}`);
    }
  }

  async deleteAirtableRecord(tableName, recordId) {
    const tableId = this.getTableId(tableName);
    
    try {
      const response = await axios.delete(
        `${this.config.airtableBaseUrl}/${tableId}/${recordId}`,
        {
          headers: { 
            Authorization: `Bearer ${this.config.airtableToken}` 
          }
        }
      );
      
      return response.data;
    } catch (err) {
      console.error(`Error deleting Airtable record: ${err.message}`);
      throw new Error(`Failed to delete Airtable record: ${err.message}`);
    }
  }

  getTableId(tableName) {
    switch (tableName) {
      case 'Agents':
        return this.config.airtableAgentsTable;
      case 'Transactions Log':
        return this.config.airtableTransactionsTable;
      default:
        throw new Error(`Unknown table name: ${tableName}`);
    }
  }

  async sendSlackNotification(dealId, recordId, status, errorMessage = null) {
    try {
      const channel = this.config.slack.channelJulianna;
      
      let text;
      if (status === 'success') {
        text = `*Deal Deletion Processed Successfully* ✅\n• Deal ID: *${dealId}*\n• Deleted Airtable Record: *${recordId}*\n• Timestamp: ${new Date().toISOString()}`;
      } else {
        text = `*Deal Deletion Processing Error* ❌\n• Deal ID: *${dealId}*\n• Error: ${errorMessage}\n• Timestamp: ${new Date().toISOString()}`;
      }

      await axios.post(
        'https://slack.com/api/chat.postMessage',
        { channel, text },
        {
          headers: {
            Authorization: `Bearer ${this.config.slack.botToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (err) {
      console.error('Failed to send Slack notification:', err.message);
      // Don't throw here as this is just a notification
    }
  }
}

const config = {
  airtableBaseUrl: process.env.AIRTABLE_BASE_URL,
  airtableToken: process.env.AIRTABLE_TOKEN,
  airtableAgentsTable: process.env.AIRTABLE_AGENTS_TABLE,
  airtableTransactionsTable: process.env.AIRTABLE_TRANSACTIONS_TABLE,
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN,
    channelJulianna: process.env.SLACK_CHANNEL_JULIANNA || 'C093UR5GGF2'
  }
};

// Export for testing
module.exports = { FubDealDeletedSync, config };

// Start server if this file is run directly
if (require.main === module) {
  const sync = new FubDealDeletedSync(config);
  const port = process.env.PORT || 3000;
  
  sync.app.listen(port, () => {
    console.log(`🚀 FUB Deal Deleted Sync listening on port ${port}`);
    console.log(`📝 Webhook endpoint: POST /webhook/deal-deleted`);
    console.log(`💚 Health check: GET /health`);
  });
}