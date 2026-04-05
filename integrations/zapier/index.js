const { version } = require('./package.json');
const { version: platformVersion } = require('zapier-platform-core');
const authentication = require('./authentication');
const monitorChangedTrigger = require('./triggers/monitorChanged');
const monitorListTrigger = require('./triggers/monitorList');

module.exports = {
  version,
  platformVersion,
  authentication,
  triggers: {
    [monitorChangedTrigger.key]: monitorChangedTrigger,
    [monitorListTrigger.key]: monitorListTrigger,
  },
};
