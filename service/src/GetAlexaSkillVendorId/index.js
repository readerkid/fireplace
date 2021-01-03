const AWS = require('aws-sdk');
const Alexa = require('ask-smapi-sdk');
const cfnCR = require('cfn-custom-resource');

exports.handler = async event => {
  // Log the event argument for debugging and for use in local development.
  console.log(JSON.stringify(event, undefined, 2));

  try {
    if (event.RequestType !== 'Create' && event.RequestType !== 'Update') {
      return cfnCR.sendSuccess(event.PhysicalResourceId, {}, event);
    }

    const id = await getVendorId();

    await cfnCR.sendSuccess(id, {}, event);
  } catch (error) {
    console.error(error);
    await cfnCR.sendFailure(error.message, event);
    throw error;
  }
};

async function getVendorId() {
  const creds = await getASKCredentials();

  const smapiClient = new Alexa.StandardSmapiClientBuilder()
    .withRefreshTokenConfig(creds)
    .client();

  const { vendors: [ vendor ] } = await smapiClient.getVendorListV1();
  if (!vendor) {
    throw new Error('No Alexa Skill Vendor Found');
  }

  return vendor.id;
}

async function getASKCredentials() {
  const secretsmanager = new AWS.SecretsManager();

  const { SecretString: secret } = await secretsmanager.getSecretValue({
    SecretId: process.env.ASK_CREDENTIALS_SECRET
  }).promise();

  return JSON.parse(secret);
}
