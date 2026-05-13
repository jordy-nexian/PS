const OpenAI = require('openai');
const { DefaultAzureCredential } = require('@azure/identity');

const baseURL = process.env.FOUNDRY_AGENT_BASE_URL;
const apiVersion = process.env.FOUNDRY_API_VERSION || '2025-11-15-preview';
const tokenScope = process.env.FOUNDRY_TOKEN_SCOPE || 'https://cognitiveservices.azure.com/.default';

const credential = new DefaultAzureCredential();

async function getClient() {
  if (!baseURL) throw new Error('FOUNDRY_AGENT_BASE_URL must be set');
  const token = await credential.getToken(tokenScope);
  return new OpenAI({
    baseURL,
    apiKey: token.token,
    defaultQuery: { 'api-version': apiVersion },
  });
}

async function ask({ transcript, question, previousResponseId }) {
  const input =
    `--- LIVE CALL TRANSCRIPT ---\n${transcript || '(no transcript yet)'}\n--- END ---\n\n` +
    `Engineer's question: ${question}`;

  const client = await getClient();
  const response = await client.responses.create({
    input,
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
  });

  return {
    text: response.output_text || '',
    responseId: response.id,
  };
}

module.exports = { ask };
