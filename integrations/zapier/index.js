const { version } = require('./package.json');
const { version: platformVersion } = require('zapier-platform-core');
const authentication = require('./authentication');
const monitorChangedTrigger = require('./triggers/monitorChanged');

module.exports = {
  version,
  platformVersion,
  authentication,
  triggers: {
    [monitorChangedTrigger.key]: monitorChangedTrigger,
  },
};
