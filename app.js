require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { logError, classifyError } = require('./errorLogger');
const { buildRef } = require('./utils/logRef');

const HANDLER = 'fub-deal-deleted-sync-r';

function _log(data) {
  const ref = buildRef(data);
  if (ref) data._ref = ref;
  const method = data.level === 'error' ? 'error' : data.level === 'warn' ? 'warn' : 'log';
  console[method](JSON.stringify(data));
}


// Suffix helpers for Airtable FUB Deal ID disambiguation
const FUB_SUFFIX = process.env.FUB_ACCOUNT_SUFFIX || '';
function toAirtableKey(dealId) {
  return FUB_SUFFIX ? `${dealId}-${FUB_SUFFIX}` : `${dealId}`;
}
function toFubDealId(airtableKey) {
  return parseInt(String(airtableKey).split('-')[0]);
}

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
      _log({ level: 'info', handler: HANDLER, type: 'RECEIVED_DEAL_DELETION_WEBHOOK' });
      
      // Extract deal ID from webhook payload
      const dealId = this.extractDealId(req.body);
      
      if (!dealId) {
        _log({ level: 'info', handler: HANDLER, type: 'NO_DEAL_ID_FOUND_IN_WEBHOOK_PAYLOAD' });
        return res.status(400).json({ 
          status: 'error', 
          message: 'No deal ID found in webhook payload' 
        });
      }

      _log({ level: 'info', handler: HANDLER, type: 'PROCESSING_DELETION_FOR_DEAL_ID_DEALID', dealId });

      // Get deal data from FollowUpBoss to determine pipeline
      let dealData = null;
      let pipelineName = null;
      
      try {
        _log({ level: 'info', handler: HANDLER, type: 'FETCHING_DEAL_DATA_FROM_FOLLOWUPBOSS_FOR_DEAL_DEAL', dealId });
        dealData = await this.getDealData(dealId);
        pipelineName = dealData?.pipelineName;
        _log({ level: 'info', handler: HANDLER, type: 'RETRIEVED_PIPELINE_NAME_PIPELINENAME' });
      } catch (err) {
        _log({ level: 'info', handler: HANDLER, type: 'COULD_NOT_RETRIEVE_DEAL_DATA_FROM_FUB_ERRMESSAGE', error: err.message });
        // If we can't get the deal data, we'll search both tables
        _log({ level: 'info', handler: HANDLER, type: 'WILL_SEARCH_BOTH_TABLES_SINCE_PIPELINE_IS_UNKNOWN' });
      }

      // Determine which table to search based on pipeline
      let tableName, fieldName;
      let searchBothTables = false;

      if (pipelineName === 'Agent Recruiting') {
        tableName = 'Agents';
        fieldName = 'FUB Deal ID';
        _log({ level: 'info', handler: HANDLER, type: 'SEARCHING_IN_AGENTS_TABLE_FOR_AGENT_RECRUITING_PIP' });
      } else if (pipelineName) {
        tableName = 'Transactions Log';
        fieldName = 'FUB Deal ID';
        _log({ level: 'info', handler: HANDLER, type: 'SEARCHING_IN_TRANSACTIONS_LOG_TABLE' });
      } else {
        // If we couldn't determine pipeline, search both tables
        searchBothTables = true;
        _log({ level: 'info', handler: HANDLER, type: 'PIPELINE_UNKNOWN_WILL_SEARCH_BOTH_TABLES' });
      }

      let airtableRecord = null;
      let finalTableName = null;

      if (searchBothTables) {
        // Try Transactions Log first, then Agents
        _log({ level: 'info', handler: HANDLER, type: 'SEARCHING_TRANSACTIONS_LOG_TABLE_FIRST' });
        airtableRecord = await this.findAirtableRecord('Transactions Log', 'FUB Deal ID', toAirtableKey(dealId));

        if (airtableRecord) {
          finalTableName = 'Transactions Log';
          _log({ level: 'info', handler: HANDLER, type: 'FOUND_RECORD_IN_TRANSACTIONS_LOG' });
        } else {
          _log({ level: 'info', handler: HANDLER, type: 'NOT_FOUND_IN_TRANSACTIONS_LOG_SEARCHING_AGENTS_TAB' });
          airtableRecord = await this.findAirtableRecord('Agents', 'FUB Deal ID', toAirtableKey(dealId));
          if (airtableRecord) {
            finalTableName = 'Agents';
            _log({ level: 'info', handler: HANDLER, type: 'FOUND_RECORD_IN_AGENTS_TABLE' });
          }
        }
      } else {
        // Search specific table based on pipeline
        airtableRecord = await this.findAirtableRecord(tableName, fieldName, toAirtableKey(dealId));
        finalTableName = tableName;
      }
      
      if (!airtableRecord) {
        const searchedTables = searchBothTables ? 'Transactions Log and Agents tables' : finalTableName;
        _log({ level: 'info', handler: HANDLER, type: 'NO_AIRTABLE_RECORD_FOUND_FOR_DEAL_ID_DEALID_IN_SEA', dealId });
        return res.json({ 
          status: 'not_found', 
          message: `No Airtable record found for deal ID: ${dealId} in ${searchedTables}` 
        });
      }

      _log({ level: 'info', handler: HANDLER, type: 'FOUND_AIRTABLE_RECORD_AIRTABLERECORDID_IN_FINALTAB' });

      // Delete the Airtable record
      await this.deleteAirtableRecord(finalTableName, airtableRecord.id);
      
      _log({ level: 'info', handler: HANDLER, type: 'SUCCESSFULLY_DELETED_AIRTABLE_RECORD_AIRTABLERECOR', dealId });

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
      _log({ level: 'error', handler: HANDLER, type: 'PROCESSING_ERROR', error: err.message });

      logError({
        appName: 'fub-deal-deleted-sync-r',
        errorType: classifyError(err),
        errorMessage: `Deal deletion processing error: ${err.message}`,
        httpStatus: err.response?.status,
        context: JSON.stringify(err.response?.data || {}).slice(0, 1000)
      });

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
      _log({ level: 'error', handler: HANDLER, type: 'ERROR_FINDING_AIRTABLE_RECORD_ERRMESSAGE', error: err.message });
      logError({
        appName: 'fub-deal-deleted-sync-r',
        errorType: classifyError(err),
        errorMessage: `Failed to find Airtable record: ${err.message}`,
        httpStatus: err.response?.status,
        context: JSON.stringify(err.response?.data || {}).slice(0, 1000)
      });
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
      _log({ level: 'error', handler: HANDLER, type: 'ERROR_DELETING_AIRTABLE_RECORD_ERRMESSAGE', error: err.message });
      logError({
        appName: 'fub-deal-deleted-sync-r',
        errorType: classifyError(err),
        errorMessage: `Failed to delete Airtable record: ${err.message}`,
        httpStatus: err.response?.status,
        context: JSON.stringify(err.response?.data || {}).slice(0, 1000)
      });
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
    // Disabled: error notifications now go through centralized errorLogger -> Airtable -> daily review task
    return;
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
    _log({ level: 'info', handler: HANDLER, type: 'FUB_DEAL_DELETED_SYNC_LISTENING_ON_PORT_PORT' });
    _log({ level: 'info', handler: HANDLER, type: 'WEBHOOK_ENDPOINT_POST_WEBHOOKDEALDELETED' });
    _log({ level: 'info', handler: HANDLER, type: 'HEALTH_CHECK_GET_HEALTH' });
  });
}