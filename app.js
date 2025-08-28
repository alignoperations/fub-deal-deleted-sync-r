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

      // Get deal data from FollowUpBoss to determine pipeline
      let dealData = null;
      let pipelineName = null;
      
      try {
        console.log(`📡 Fetching deal data from FollowUpBoss for deal ${dealId}`);
        dealData = await this.getDealData(dealId);
        pipelineName = dealData?.pipelineName;
        console.log(`📊 Retrieved pipeline name: ${pipelineName}`);
      } catch (err) {
        console.log(`⚠️ Could not retrieve deal data from FUB: ${err.message}`);
        // If we can't get the deal data, we'll search both tables
        console.log('🔄 Will search both tables since pipeline is unknown');
      }

      // Determine which table to search based on pipeline
      let tableName, fieldName;
      let searchBothTables = false;

      if (pipelineName === 'Agent Recruiting') {
        tableName = 'Agents';
        fieldName = 'FUB Deal ID';
        console.log('🏢 Searching in Agents table for Agent Recruiting pipeline');
      } else if (pipelineName) {
        tableName = 'Transactions Log';
        fieldName = 'FUB Deal ID';
        console.log('📋 Searching in Transactions Log table');
      } else {
        // If we couldn't determine pipeline, search both tables
        searchBothTables = true;
        console.log('🔍 Pipeline unknown - will search both tables');
      }

      let airtableRecord = null;
      let finalTableName = null;

      if (searchBothTables) {
        // Try Transactions Log first, then Agents
        console.log('📋 Searching Transactions Log table first...');
        airtableRecord = await this.findAirtableRecord('Transactions Log', 'FUB Deal ID', dealId);
        
        if (airtableRecord) {
          finalTableName = 'Transactions Log';
          console.log('✅ Found record in Transactions Log');
        } else {
          console.log('🏢 Not found in Transactions Log, searching Agents table...');
          airtableRecord = await this.findAirtableRecord('Agents', 'FUB Deal ID', dealId);
          if (airtableRecord) {
            finalTableName = 'Agents';
            console.log('✅ Found record in Agents table');
          }
        }
      } else {
        // Search specific table based on pipeline
        airtableRecord = await this.findAirtableRecord(tableName, fieldName, dealId);
        finalTableName = tableName;
      }
      
      if (!airtableRecord) {
        const searchedTables = searchBothTables ? 'Transactions Log and Agents tables' : finalTableName;
        console.log(`⚠️ No Airtable record found for deal ID: ${dealId} in ${searchedTables}`);
        return res.json({ 
          status: 'not_found', 
          message: `No Airtable record found for deal ID: ${dealId} in ${searchedTables}` 
        });
      }

      console.log(`📋 Found Airtable record: ${airtableRecord.id} in ${finalTableName}`);

      // Delete the Airtable record
      await this.deleteAirtableRecord(finalTableName, airtableRecord.id);
      
      console.log(`✅ Successfully deleted Airtable record ${airtableRecord.id} for deal ${dealId} from ${finalTableName}`);

      // Only send Slack notifications for errors, not for successful deletions
      // await this.sendSlackNotification(dealId, airtableRecord.id, 'success', null, finalTableName, pipelineName);

      return res.json({ 
        status: 'success', 
        dealId: dealId,
        deletedRecordId: airtableRecord.id,
        tableName: finalTableName,
        pipelineName: pipelineName
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

  async getDealData(dealId) {
    if (!this.config.followUpBossApi || !this.config.followUpBossToken) {
      throw new Error('FollowUpBoss API configuration missing');
    }
    
    const response = await axios.get(
      `${this.config.followUpBossApi}/deals/${dealId}`,
      { headers: { Authorization: `Basic ${Buffer.from(this.config.followUpBossToken + ':').toString('base64')}` } }
    );
    return response.data;
  }

  async sendSlackNotification(dealId, recordId, status, errorMessage = null, tableName = null, pipelineName = null) {
    try {
      const channel = this.config.slack.channelJulianna;
      
      let text;
      if (status === 'success') {
        text = `*Deal Deletion Processed Successfully* ✅\n• Deal ID: *${dealId}*\n• Pipeline: *${pipelineName || 'Unknown'}*\n• Deleted Airtable Record: *${recordId}*\n• Table: *${tableName}*\n• Timestamp: ${new Date().toISOString()}`;
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
  followUpBossApi: process.env.FUB_API_URL,
  followUpBossToken: process.env.FUB_TOKEN,
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