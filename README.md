\# FollowUpBoss Deal Deleted Sync



This service receives webhooks from FollowUpBoss when deals are deleted and automatically removes the corresponding records from Airtable.



\## Features



\- ✅ Receives FollowUpBoss deal deletion webhooks

\- ✅ Finds corresponding Airtable records by FUB Deal ID

\- ✅ Deletes Airtable records safely

\- ✅ Sends Slack notifications for success/failure

\- ✅ Comprehensive error handling and logging

\- ✅ Health check endpoint



\## Setup



\### 1. Environment Variables



Copy `.env.example` to `.env` and fill in your values:



```bash

cp .env.example .env

```



Required environment variables:

\- `AIRTABLE\_BASE\_URL` - Your Airtable base URL

\- `AIRTABLE\_TOKEN` - Your Airtable Personal Access Token

\- `AIRTABLE\_TRANSACTIONS\_TABLE` - Table ID for your Transactions Log

\- `SLACK\_BOT\_TOKEN` - Your Slack bot token

\- `SLACK\_CHANNEL\_JULIANNA` - Slack channel ID for notifications



\### 2. Local Development



```bash

\# Install dependencies

npm install



\# Start the server

npm start



\# Or for development with auto-reload

npm run dev

```



\### 3. Deploy to Heroku



```bash

\# Create Heroku app

heroku create fub-deal-deleted-sync



\# Set environment variables

heroku config:set AIRTABLE\_BASE\_URL=your\_base\_url

heroku config:set AIRTABLE\_TOKEN=your\_token

heroku config:set AIRTABLE\_TRANSACTIONS\_TABLE=your\_table\_id

heroku config:set SLACK\_BOT\_TOKEN=your\_slack\_token

heroku config:set SLACK\_CHANNEL\_JULIANNA=your\_channel\_id



\# Deploy

git push heroku main

```



\### 4. GitHub Repository



```bash

\# Initialize git repository

git init

git add .

git commit -m "Initial commit"



\# Add GitHub remote

git remote add origin https://github.com/yourusername/fub-deal-deleted-sync.git

git push -u origin main

```



\## API Endpoints



\### POST /webhook/deal-deleted

Receives FollowUpBoss deal deletion webhooks.



\*\*Expected payload formats:\*\*

```json

{

&nbsp; "resourceIds": \["deal\_id\_123"],

&nbsp; "event": "deal.deleted"

}

```



or



```json

{

&nbsp; "dealId": "deal\_id\_123",

&nbsp; "action": "deleted"

}

```



\*\*Response:\*\*

```json

{

&nbsp; "status": "success",

&nbsp; "dealId": "deal\_id\_123",

&nbsp; "deletedRecordId": "airtable\_record\_id"

}

```



\### GET /health

Health check endpoint.



\*\*Response:\*\*

```json

{

&nbsp; "status": "healthy",

&nbsp; "timestamp": "2025-08-13T12:00:00.000Z",

&nbsp; "service": "fub-deal-deleted-sync"

}

```



\## Webhook Configuration in FollowUpBoss



1\. Go to your FollowUpBoss settings

2\. Navigate to Webhooks/Integrations

3\. Add a new webhook with:

&nbsp;  - \*\*URL\*\*: `https://fub-deal-deleted-sync.herokuapp.com/webhook/deal-deleted`

&nbsp;  - \*\*Events\*\*: Deal Deleted

&nbsp;  - \*\*Method\*\*: POST



\## Error Handling



The service includes comprehensive error handling:



\- \*\*Invalid payload\*\*: Returns 400 with error message

\- \*\*Record not found\*\*: Returns success with "not\_found" status

\- \*\*Airtable errors\*\*: Returns 500 with error details

\- \*\*Slack notifications\*\*: Sent for both success and failure cases



\## Monitoring



\- Check Heroku logs: `heroku logs --tail`

\- Health check: `curl https://fub-deal-deleted-sync.herokuapp.com/health`

\- Slack notifications provide real-time status updates



\## Security Considerations



\- All API tokens should be stored as environment variables

\- Consider adding webhook signature verification for production

\- Monitor logs for any suspicious activity



\## Troubleshooting



\### Common Issues



1\. \*\*No deal ID found\*\*: Check webhook payload format

2\. \*\*Airtable record not found\*\*: Verify the deal ID exists in your Transactions Log

3\. \*\*Permission errors\*\*: Ensure Airtable token has delete permissions

4\. \*\*Slack notifications not working\*\*: Verify bot token and channel ID



\### Logging



The service provides detailed console logging:

\- 🗑️ Webhook received

\- 🔍 Processing deletion

\- 📋 Record found

\- ✅ Success

\- ❌ Errors

