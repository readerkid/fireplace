const AWS = require('aws-sdk');
const Alexa = require('ask-smapi-sdk');
const cfnCR = require('cfn-custom-resource');

exports.handler = async event => {
  // Log the event argument for debugging and for use in local development.
  console.log(JSON.stringify(event, undefined, 2));

  try {
    switch (event.RequestType) {
      case 'Create':
        const id = await createSkill();
        return cfnCR.sendSuccess(id, { Name: process.env.ALEXA_SKILL_NAME }, event);

      case 'Update':
        await updateSkill(event.PhysicalResourceId);
        return cfnCR.sendSuccess(event.PhysicalResourceId, { Name: process.env.ALEXA_SKILL_NAME }, event);

      case 'Delete':
        await deleteSkill(event.PhysicalResourceId);
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
      // Will be updated in CreateAlexaSkillEndpoint after the Lambda Permission is added
      smartHome: {}
    },
    permissions: [
      {
        name: 'alexa::async_event:write'
      }
    ],
    privacyAndCompliance: {
      allowsPurchases: false,
      containsAds: false,
      isChildDirected: false,
      isExportCompliant: true,
      locales: {
        'en-US': {
          privacyPolicyUrl: 'https://example.com/privacy'
        }
      },
      usesPersonalInfo: false
    },
    publishingInformation: {
      automaticDistribution: {
        isActive: false,
      },
      category: 'SMART_HOME',
      distributionCountries: [],
      isAvailableWorldwide: true,
      locales: {
        'en-US': {
          description: 'Control the fireplace with Alexa',
          examplePhrases: [
            'Turn the fireplace on'
          ],
          keywords: [
            'fireplace'
          ],
          name: 'Fireplace',
          summary: 'Control the fireplace with Alexa'
        },
      },
      testingInstructions: 'N/A'
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
        throw new Error(`Error creating/updating skill '${skillId}': ${manifest.lastUpdateRequest.errors[0].message}`);

      default:
        throw new Error(`Error creating/updating skill '${skillId}': Invalid skill status ${manifest.lastUpdateRequest.status}`);
    }
  }
}

async function createSkill() {
  const smapiClient = await getASKClient();

  const { skillId } = await smapiClient.createSkillForVendorV1({
    vendorId: process.env.ASK_VENDOR_ID,
    manifest: manifest()
  });

  await validateSkill(skillId, smapiClient);

  return skillId;
}

async function updateSkill(skillId) {
  const smapiClient = await getASKClient();

  await smapiClient.updateSkillManifestV1(skillId, 'development', {
    manifest: manifest()
  });

  await validateSkill(skillId, smapiClient);
}

async function deleteSkill(skillId) {
  const smapiClient = await getASKClient();

  try {
    await smapiClient.deleteSkillV1(skillId);
  } catch (err) {
    if (err.statusCode !== 404) {
      throw err;
    }
  }
}
