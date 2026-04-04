module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'api_key',
      label: 'API Key',
      helpText:
        'Your FetchTheChange API key. Generate one at https://ftc.bd73.com/settings under API Keys (Power plan required).',
      required: true,
      type: 'password',
    },
  ],
  test: {
    url: 'https://ftc.bd73.com/api/v1/ping',
    headers: {
      Authorization: 'Bearer {{bundle.authData.api_key}}',
    },
  },
  connectionLabel: (z, bundle) => {
    const key = bundle.authData.api_key || '';
    return `FetchTheChange (${key.substring(0, 12)}...)`;
  },
};
