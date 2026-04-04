const subscribeHook = async (z, bundle) => {
  const data = {
    hookUrl: bundle.targetUrl,
  };
  if (bundle.inputData.monitor_id) {
    data.monitorId = parseInt(bundle.inputData.monitor_id, 10);
  }
  const response = await z.request({
    url: 'https://ftc.bd73.com/api/v1/zapier/subscribe',
    method: 'POST',
    headers: { Authorization: `Bearer ${bundle.authData.api_key}` },
    body: data,
  });
  return response.data;
};

const unsubscribeHook = async (z, bundle) => {
  const hookId = bundle.subscribeData.id;
  await z.request({
    url: 'https://ftc.bd73.com/api/v1/zapier/unsubscribe',
    method: 'DELETE',
    headers: { Authorization: `Bearer ${bundle.authData.api_key}` },
    body: { id: hookId },
  });
};

const getMonitors = async (z, bundle) => {
  const response = await z.request({
    url: 'https://ftc.bd73.com/api/v1/zapier/monitors',
    headers: { Authorization: `Bearer ${bundle.authData.api_key}` },
  });
  return response.data;
};

const getFallbackChanges = async (z, bundle) => {
  const params = { limit: 3 };
  if (bundle.inputData.monitor_id) {
    params.monitorId = bundle.inputData.monitor_id;
  }
  const response = await z.request({
    url: 'https://ftc.bd73.com/api/v1/zapier/changes',
    headers: { Authorization: `Bearer ${bundle.authData.api_key}` },
    params,
  });
  return response.data;
};

module.exports = {
  key: 'monitor_changed',
  noun: 'Monitor Change',
  display: {
    label: 'Monitor Value Changed',
    description:
      'Triggers when FetchTheChange detects a change on a monitored web page. Use this to kick off automations when a price drops, a product comes back in stock, or any tracked value changes.',
  },
  operation: {
    type: 'hook',
    inputFields: [
      {
        key: 'monitor_id',
        label: 'Monitor (optional)',
        helpText:
          'Choose a specific monitor to watch, or leave blank to trigger on any monitor change.',
        dynamic: 'monitor_changed.id.name',
        required: false,
        altersDynamicFields: false,
      },
    ],
    performSubscribe: subscribeHook,
    performUnsubscribe: unsubscribeHook,
    perform: (z, bundle) => [bundle.cleanedRequest],
    performList: getFallbackChanges,
    sample: {
      id: 1,
      event: 'change.detected',
      monitorId: 42,
      monitorName: 'Competitor pricing page',
      url: 'https://example.com/pricing',
      oldValue: '$49/mo',
      newValue: '$59/mo',
      detectedAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
    },
  },
};
