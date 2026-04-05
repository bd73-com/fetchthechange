const getMonitors = async (z, bundle) => {
  const response = await z.request({
    url: 'https://ftc.bd73.com/api/v1/zapier/monitors',
    headers: { Authorization: `Bearer ${bundle.authData.api_key}` },
  });
  return response.data;
};

module.exports = {
  key: 'monitor_list',
  noun: 'Monitor',
  display: {
    label: 'Monitor List',
    description: 'Hidden trigger used to populate the monitor dropdown.',
    hidden: true,
  },
  operation: {
    perform: getMonitors,
    sample: {
      id: 1,
      name: 'Example Monitor',
      url: 'https://example.com',
      active: true,
    },
    outputFields: [
      { key: 'id', label: 'Monitor ID', type: 'integer' },
      { key: 'name', label: 'Monitor Name', type: 'string' },
      { key: 'url', label: 'Monitored URL', type: 'string' },
      { key: 'active', label: 'Active', type: 'boolean' },
    ],
  },
};
