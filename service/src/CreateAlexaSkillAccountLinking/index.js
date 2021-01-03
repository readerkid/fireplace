const AWS = require('aws-sdk');
const Alexa = require('ask-smapi-sdk');
const cfnCR = require('cfn-custom-resource');

exports.handler = async event => {
  // Log the event argument for debugging and for use in local development.
  console.log(JSON.stringify(event, undefined, 2));

  try {
    switch (event.RequestType) {
      case 'Create':
      case 'Update':
        await updateAccountLinking();
        return cfnCR.sendSuccess(`${process.env.ALEXA_SKILL_ID}-account-linking`, {}, event);

      case 'Delete':
        await deleteAccountLinking();
        return cfnCR.sendSuccess(event.PhysicalResourceId, {}, event);

      default:
        throw new Error(`Invalid CFN custom resource event type ${event.RequestType}`);
    }
  } catch (error) {
    await cfnCR.sendFailure(error.message, event);
    throw error;
  }
};

async function getClientSecret() {
  const idp = new AWS.CognitoIdentityServiceProvider();

  const { UserPoolClient: client } = await idp.describeUserPoolClient({
    ClientId: process.env.AUTH_CLIENT_ID,
    UserPoolId: process.env.AUTH_USER_POOL_ID
  }).promise();

  return client.ClientSecret;
}

async function getASKClient() {
  const secretsmanager = new AWS.SecretsManager();

  const { SecretString: secret } = await secretsmanager.getSecretValue({
    SecretId: process.env.ASK_CREDENTIALS_SECRET
  }).promise();

  const creds = JSON.parse(secret);

  return new Alexa.StandardSmapiClientBuilder()
    .withRefreshTokenConfig(creds)
    .client();
}

async function updateAccountLinking() {
  const smapiClient = await getASKClient();

  let redirectURI;
  switch (process.env.AWS_REGION) {
    case 'us-east-1':
      redirectURI = `https://pitangui.amazon.com/api/skill/link/${process.env.ASK_VENDOR_ID}`;
      break;
    
    case 'us-west-2':
      redirectURI = `https://alexa.amazon.co.jp/api/skill/link/${process.env.ASK_VENDOR_ID}`;
      break;

    case 'eu-west-1':
      redirectURI = `https://layla.amazon.com/api/skill/link/${process.env.ASK_VENDOR_ID}`;
      break;

    default:
      throw new Error(`Invalid region for Alexa Smart Home Skills: ${process.env.AWS_REGION}`);
  }

  await smapiClient.updateAccountLinkingInfoV1(process.env.ALEXA_SKILL_ID, 'development', {
    accountLinkingRequest: {
      accessTokenScheme: 'HTTP_BASIC',
      accessTokenUrl: `https://${process.env.WEB_AUTH_DOMAIN}/oauth2/token`,
      authorizationUrl: `https://${process.env.WEB_AUTH_DOMAIN}/oauth2/authorize?response_type=code&redirect_uri=${redirectURI}`,
      clientId: process.env.AUTH_CLIENT_ID,
      clientSecret: await getClientSecret(),
      domains: [],
      scopes: [
        'email'
      ],
      type: 'AUTH_CODE'
    }
  });
}

async function deleteAccountLinking() {
  const smapiClient = await getASKClient();

  try {
    await smapiClient.deleteAccountLinkingInfoV1(process.env.ALEXA_SKILL_ID, 'development');
  } catch (err) {
    if (err.statusCode !== 404) {
      throw err;
    }
  }
}
