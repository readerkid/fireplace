const AWS = require('aws-sdk');
const documentClient = new AWS.DynamoDB.DocumentClient();
const apigatewaymanagementapi = new AWS.ApiGatewayManagementApi({ endpoint: process.env.API_CONNECTIONS_ENDPOINT });

exports.handler = async event => {
  // Log the event argument for debugging and for use in local development.
  console.log(JSON.stringify(event, undefined, 2));

  for (const record of event.Records) {
    await processRecord(record);
  }

  return {};
};

async function processRecord(record) {
  const type = record.dynamodb.Keys.hashKey.S;

  switch (type) {
    case 'clients': {
      const clientId = record.dynamodb.Keys.sortKey.S;

      await sendStateToNewClient(clientId);
      break;
    }

    case 'fireplaceStates': {
      const timestamp = record.dynamodb.Keys.sortKey.S;
      const level = record.dynamodb.NewImage.level.S;
      const clientId = record.dynamodb.NewImage.clientId.S;

      await broadcastNewFireplaceState(timestamp, level, clientId);
      break;
    }
  }
}

async function sendStateToNewClient(clientId) {
  console.log(`Client '${clientId}' connected`);

  const { Items: items } = await documentClient.query({
    TableName: process.env.TABLE_NAME,
    Limit: 1,
    ConsistentRead: true,
    ScanIndexForward: false,
    KeyConditionExpression: 'hashKey = :fireplaceStates',
    ExpressionAttributeValues: {
      ':fireplaceStates': 'fireplaceStates'
    }
  }).promise();

  if (items.length === 0) {
    // No current fireplace state, don't send anything to the client
    console.log('No fireplace state to send');
    return;
  }

  const [ { level, sortKey: timestamp } ] = items;

  console.log(`Sending fireplace level ${level} with timestamp ${timestamp}`);

  try {
    await apigatewaymanagementapi.postToConnection({
      ConnectionId: clientId,
      Data: JSON.stringify({
        action: 'currentState',
        level,
        timestamp: Number(timestamp)
      }, null, 2)
    }).promise();
  } catch (err) {
    if (err.code === 'GoneException') {
      console.log(`Client ${clientId} already disconnected`);
    } else {
      throw err;
    }
  }
}

async function broadcastNewFireplaceState(timestamp, level, clientId) {
  const otherClientIds = await getOtherClientIds(clientId);

  console.log(`Broadcasting new level ${level} with timestamp ${timestamp} to client(s) '${otherClientIds.join("', '")}'`);

  await Promise.all(
    otherClientIds.map(
      clientId => {
        try {
          return apigatewaymanagementapi.postToConnection({
            ConnectionId: clientId,
            Data: JSON.stringify({
              action: 'currentState',
              level,
              timestamp
            }, null, 2)
          }).promise();
        } catch (err) {
          if (err.code === 'GoneException') {
            console.log(`Client ${clientId} already disconnected`);
          } else {
            console.log(`Error sending state to client ${clientId}: ${err.message} (${err.code})`);
          }
        }
      }
    )
  );
}

async function getOtherClientIds(clientId) {
  const otherClientIds = [];
  let LastEvaluatedKey;

  do {
    let items;

    ({ Items: items, LastEvaluatedKey } = await documentClient.query({
      TableName: process.env.TABLE_NAME,
      ConsistentRead: true,
      KeyConditionExpression: 'hashKey = :clients',
      ExpressionAttributeValues: {
        ':clients': 'clients'
      },
      ExclusiveStartKey: LastEvaluatedKey
    }).promise());

    const clientIds = items.map(item => item.sortKey).filter(otherClientId => otherClientId !== clientId);

    Array.prototype.push.apply(otherClientIds, clientIds);
  } while (LastEvaluatedKey);

  return otherClientIds;
}
