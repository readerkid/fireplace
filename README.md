# fireplace
Turning on the fire

## Service Stack Deployment
1. Create an Alexa developer account
1. [Create an Alexa security profile](https://developer.amazon.com/en-US/docs/alexa/smapi/get-access-token-smapi.html#both-resource-owner-and-client)
1. Create a Stackery env in us-east-1 (it must be us-east-1 due to Alexa Smart Home Skills requirements)
1. Add a secret named `fireplace/ask-credentials` in the environment with the following JSON content:
    ```json
    {
      "clientId": "<Client ID from Alexa security profile>",
      "clientSecret": "<Client secret from Alexa security profile>",
      "refreshToken": "<Refresh token from Alexa security profile>"
    }
    ```
1. Import this stack
1. Set the stack's template path to service/template.yaml
1. Deploy this stack