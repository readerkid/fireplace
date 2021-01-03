const AWS = require('aws-sdk');
const { v4: uuid } = require('uuid');

const ENDPOINT_ID = 'fireplace';
const INSTANCE = 'Fireplace.Power'
const MAX_LEVEL = 6;

const documentClient = new AWS.DynamoDB.DocumentClient();

exports.handler = async event => {
  // Log the event argument for debugging and for use in local development.
  console.log(JSON.stringify(event, undefined, 2));

  const response = await handleDirective(event.directive);

  console.log('Response:');
  console.log(JSON.stringify(response, null, 2));

  return response;
};

const handleDirective = directive => {
  switch (directive.header.namespace) {
    case 'Alexa.Authorization': {
      return handleAuthorizationNamespace(directive);
    }

    case 'Alexa.Discovery': {
      return handleDiscoveryNamespace(directive);
    }

    case 'Alexa': {
      return handleAlexaNamespace(directive);
    }

    case 'Alexa.RangeController': {
      return handleRangeControllerNamespace(directive);
    }

    case 'Alexa.PowerController': {
      return handlePowerControllerNamespace(directive);
    }

    default: {
      return error('INVALID_DIRECTIVE', `Invalid directive namespace ${directive.header.namespace}`);
    }
  }
};

const handleAuthorizationNamespace = directive => {
  switch (directive.header.name) {
    case 'AcceptGrant': {
      return handleAcceptGrant();
    }

    default: {
      return error('INVALID_DIRECTIVE', `Invalid directive ${directive.header.namespace}:${directive.header.name}`);
    }
  }
}

const handleAcceptGrant = () => ({
  event: {
    header: {
      namespace: 'Alexa.Authorization',
      name: 'AcceptGrant.Response',
      messageId: uuid(),
      payloadVersion: '3'
    },
    payload: {}
  }
});

const handleDiscoveryNamespace = directive => {
  switch (directive.header.name) {
    case 'Discover': {
      return handleDiscover();
    }

    default: {
      return error('INVALID_DIRECTIVE', `Invalid directive ${directive.header.namespace}:${directive.header.name}`);
    }
  }
}

const handleDiscover = () => ({
  event: {
    header: {
      namespace: 'Alexa.Discovery',
      name: 'Discover.Response',
      payloadVersion: '3',
      messageId: uuid()
    },
    payload: {
      endpoints: [
        {
          endpointId: ENDPOINT_ID,
          manufacturerName: 'Kozy Heat',
          description: 'Chaska fireplace by Kozy Heat',
          friendlyName: 'Fireplace',
          displayCategories: [
            'OTHER'
          ],
          additionalAttributes: {
            manufacturer: 'Kozy Heat',
            model: 'Chaska'
          },
          capabilities: [
            {
              type: 'AlexaInterface',
              interface: 'Alexa.RangeController',
              instance: INSTANCE,
              version: '3',
              properties: {
                supported: [
                  {
                    name: 'rangeValue'
                  }
                ],
                proactivelyReported: true,
                retrievable: true
              },
              capabilityResources: {
                friendlyNames: [
                  {
                    '@type': 'text',
                    value: {
                      text: 'Flame',
                      locale: 'en-US'
                    }
                  },
                  {
                    '@type': 'text',
                    value: {
                      text: 'Power',
                      locale: 'en-US'
                    }
                  }
                ]
              },
              configuration: {
                supportedRange: {
                  minimumValue: 1,
                  maximumValue: MAX_LEVEL,
                  precision: 1
                },
                presets: [
                  {
                    rangeValue: 1,
                    presetResources: {
                      friendlyNames: [
                        {
                          '@type': 'asset',
                          value: {
                            assetId: 'Alexa.Value.Minimum'
                          }
                        },
                        {
                          '@type': 'asset',
                          value: {
                            assetId: 'Alexa.Value.Low'
                          }
                        }
                      ]
                    }
                  },
                  {
                    rangeValue: Math.floor((MAX_LEVEL - 1) / 2 + 1),
                    presetResources: {
                      friendlyNames: [
                        {
                          '@type': 'asset',
                          value: {
                            assetId: 'Alexa.Value.Medium'
                          }
                        }
                      ]
                    }
                  },
                  {
                    rangeValue: MAX_LEVEL,
                    presetResources: {
                      friendlyNames: [
                        {
                          '@type': 'asset',
                          value: {
                            assetId: 'Alexa.Value.Maximum'
                          }
                        },
                        {
                          '@type': 'asset',
                          value: {
                            assetId: 'Alexa.Value.High'
                          }
                        }
                      ]
                    }
                  }
                ]
              }
            },
            {
              type: 'AlexaInterface',
              interface: 'Alexa.PowerController',
              version: '3',
              properties: {
                supported: [
                  {
                    name: 'powerState'
                  }
                ],
                proactivelyReported: true,
                retrievable: true
              }
            }
          ]
        }
      ]
    }
  }
});

const handleAlexaNamespace = directive => {
  switch (directive.header.name) {
    case 'ReportState': {
      return handleReportState(directive.header.correlationToken);
    }

    default: {
      return error('INVALID_DIRECTIVE', `Invalid directive ${directive.header.namespace}:${directive.header.name}`);
    }
  }
};

const getCurrentLevel = async () => {
  let items;
  try {
    ({ Items: items } = await documentClient.query({
      TableName: process.env.TABLE_NAME,
      Limit: 1,
      ConsistentRead: true,
      ScanIndexForward: false,
      KeyConditionExpression: 'hashKey = :fireplaceStates',
      ExpressionAttributeValues: {
        ':fireplaceStates': 'fireplaceStates'
      }
    }).promise())
  } catch (err) {
    return error('INTERNAL_ERROR', `Failed to get current fireplace state: ${err.message}`);
  }

  if (items.length === 1) {
    return parseInt(items[0].level);
  } else {
    // No current fireplace state, assume it's off
    console.log('No fireplace state found, assuming current level is 0');
    return 0;
  }
};

const respondWithLevel = (directiveName, level, correlationToken, timestamp = new Date()) => ({
  event: {
    header: {
      namespace: 'Alexa',
      name: directiveName,
      messageId: uuid(),
      correlationToken,
      payloadVersion: '3'
    },
    endpoint: {
      endpointId: ENDPOINT_ID
    },
    payload: {},
  },
  context: {
    properties: [
      {
        namespace: 'Alexa.RangeController',
        instance: INSTANCE,
        name: 'rangeValue',
        value: level,
        timeOfSample: timestamp.toISOString(),
        uncertaintyInMilliseconds: 0
      },
      {
        namespace: 'Alexa.PowerController',
        name: 'powerState',
        value: (level > 0 ? 'ON' : 'OFF'),
        timeOfSample: timestamp.toISOString(),
        uncertaintyInMilliseconds: 0
      }
    ]
  }
});

const handleReportState = async correlationToken => {
  const level = await getCurrentLevel();

  return respondWithLevel('StateReport', level, correlationToken);
};

const handleRangeControllerNamespace = directive => {
  switch (directive.header.name) {
    case 'SetRangeValue': {
      if (directive.header.instance !== INSTANCE) {
        return error('INVALID_DIRECTIVE', `Invalid instance ${directive.header.instance}`);
      }

      return handleSetRangeValue(directive.payload.rangeValue, directive.header.correlationToken);
    }

    case 'AdjustRangeValue': {
      if (directive.header.instance !== INSTANCE) {
        return error('INVALID_DIRECTIVE', `Invalid instance ${directive.header.instance}`);
      }

      return handleAdjustRangeValue(directive.payload.rangeValueDelta, directive.header.correlationToken)
    }

    default: {
      return error('INVALID_DIRECTIVE', `Invalid directive ${directive.header.namespace}:${directive.header.name}`);
    }
  }
}

const handleSetRangeValue = async (level, correlationToken) => {
  const timestamp = new Date;

  try {
    await documentClient.put({
      TableName: process.env.TABLE_NAME,
      Item: {
        hashKey: 'fireplaceStates',
        sortKey: timestamp.getTime().toString(),
        level: level.toString(),
        clientId: `alexa-${correlationToken}`,
        expiration: timestamp.getTime() / 1000 + 30 * 24 * 60 * 60
      }
    }).promise();
  } catch (err) {
    return error('INTERNAL_ERROR', `Failed to add set fireplace state: ${err.message}`);
  }

  return respondWithLevel('Response', level, correlationToken, timestamp);
}

const handleAdjustRangeValue = async (delta, correlationToken) => {
  let level = await getCurrentLevel() + delta;
  
  if (level < 0) {
    level = 0;
  } else if (level > MAX_LEVEL) {
    level = MAX_LEVEL;
  }

  return handleSetRangeValue(level, correlationToken);
}

const handlePowerControllerNamespace = directive => {
  switch (directive.header.name) {
    case 'TurnOn': {
      return handleTurnOn(directive.header.correlationToken);
    }

    case 'TurnOff': {
      return handleTurnOff(directive.header.correlationToken);
    }

    default: {
      return error('INVALID_DIRECTIVE', `Invalid directive ${directive.header.namespace}:${directive.header.name}`);
    }
  }
}

const handleTurnOn = async correlationToken => {
  let level = await getCurrentLevel();
  
  if (level === 0) {
    return handleSetRangeValue(1, correlationToken);
  }

  return respondWithLevel('Response', level, correlationToken);
}

const handleTurnOff = async correlationToken => {
  let level = await getCurrentLevel();
  
  if (level > 0) {
    return handleSetRangeValue(0, correlationToken);
  }

  return respondWithLevel('Response', 0, correlationToken);
}

const error = (type, message) => ({
  event: {
    header: {
      namespace: 'Alexa',
      name: 'ErrorResponse',
      messageId: uuid(),
      payloadVersion: '3'
    },
    endpoint: {
      endpointId: ENDPOINT_ID
    },
    payload: {
      type,
      message
    }
  }
});