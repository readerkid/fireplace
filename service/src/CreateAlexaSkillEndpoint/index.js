const AWS = require('aws-sdk');
const Alexa = require('ask-smapi-sdk');
const cfnCR = require('cfn-custom-resource');

exports.handler = async event => {
  // Log the event argument for debugging and for use in local development.
  console.log(JSON.stringify(event, undefined, 2));

  try {
    switch (event.RequestType) {
      case 'Create':
        await updateSkillEndpoint(process.env.ALEXA_SKILL_ID);
        return cfnCR.sendSuccess(`${process.env.ALEXA_SKILL_ID}-endpoint`, {}, event);

      case 'Update':
        await updateSkillEndpoint(process.env.ALEXA_SKILL_ID);
        return cfnCR.sendSuccess(event.PhysicalResourceId, {}, event);

      case 'Delete':
        return cfnCR.sendSuccess(event.PhysicalResourceId, {}, event);

      default:
        throw new Error(`Invalid CFN custom resource event type ${event.RequestType}`);
    }
  } catch (error) {
    await cfnCR.sendFailure(error.message, event);
    throw error;
  }
};

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

function manifest() {
  return {
    manifestVersion: '1.0',
    apis: {
      smartHome: {
        endpoint: {
          uri: process.env.ALEXA_HANDLER_ARN
        },
        protocolVersion: '3'
      }
    },
    permissions: [
      {
        name: 'alexa::async_event:write'
      }
    ],
    publishingInformation: {
      locales: {
        'en-US': {
          name: process.env.ALEXA_SKILL_NAME
        }
      }
    }
  }
}

async function validateSkill(skillId, smapiClient) {
  while (true) {
    const { manifest } = await smapiClient.getSkillStatusV1(skillId);

    switch (manifest.lastUpdateRequest.status) {
      case 'IN_PROGRESS':
        await new Promise(resolve => setTimeout(resolve, 1000));
        break;

      case 'SUCCEEDED':
        return;

      case 'FAILED':
        throw new Error(`Error creating/updating skill endpoint '${skillId}': ${manifest.lastUpdateRequest.errors[0].message}`);

      default:
        throw new Error(`Error creating/updating skill endpoint '${skillId}': Invalid skill status ${manifest.lastUpdateRequest.status}`);
    }
  }
}

async function updateSkillEndpoint(skillId) {
  const smapiClient = await getASKClient();

  await smapiClient.updateSkillManifestV1(skillId, 'development', {
    manifest: manifest()
  });

  await validateSkill(skillId, smapiClient);
}
