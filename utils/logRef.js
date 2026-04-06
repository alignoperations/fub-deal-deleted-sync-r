// utils/logRef.js - Builds a searchable _ref string from log data
const REF_FIELDS = {
  personId:    'p',
  contactId:   'p',
  dealId:      'd',
  pipelineId:  'pl',
  appointmentId: 'apt',
  stageId:     'st',
  eventId:     'ev',
  requestId:   'r',
  recordId:    'rec',
  taskId:      'task',
  projectId:   'proj',
};

function buildRef(data) {
  if (!data || typeof data !== 'object') return undefined;
  const tokens = [];
  for (const [field, prefix] of Object.entries(REF_FIELDS)) {
    const val = data[field];
    if (val != null && val !== '') {
      if (Array.isArray(val)) {
        for (const item of val) { if (item != null) tokens.push(`${prefix}${item}`); }
      } else { tokens.push(`${prefix}${val}`); }
    }
  }
  if (data.resourceIds && Array.isArray(data.resourceIds)) {
    for (const id of data.resourceIds) { if (id != null && !tokens.includes(`p${id}`)) tokens.push(`p${id}`); }
  }
  if (data.dealIds && Array.isArray(data.dealIds)) {
    for (const id of data.dealIds) { if (id != null && !tokens.includes(`d${id}`)) tokens.push(`d${id}`); }
  }
  return tokens.length > 0 ? tokens.join(' ') : undefined;
}

module.exports = { buildRef };
