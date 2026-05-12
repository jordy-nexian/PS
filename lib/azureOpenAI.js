const { AzureOpenAI } = require('openai');

const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_API_KEY;
const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21';
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';

let client = null;
function getClient() {
  if (!endpoint || !apiKey) {
    throw new Error('AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY must be set');
  }
  if (!client) {
    client = new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment });
  }
  return client;
}

const SYSTEM_PROMPT = `You are a copilot for a managed-service-provider (MSP) support engineer who is currently on a live phone call with a customer.
You receive the running transcript of the call (Customer / Engineer lines, possibly partial).
When the engineer asks a question, answer concisely and practically — they are mid-call and need an answer they can speak aloud or act on in seconds.
Prefer bullet points, exact commands, or short steps over prose. Cite specific symptoms from the transcript when relevant.
If the transcript is too short to be useful, say so and answer from general MSP knowledge.`;

async function ask({ transcript, question }) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `--- LIVE CALL TRANSCRIPT SO FAR ---\n${transcript || '(no transcript yet)'}\n--- END TRANSCRIPT ---\n\nEngineer's question: ${question}`,
    },
  ];

  const response = await getClient().chat.completions.create({
    model: deployment,
    messages,
    temperature: 0.3,
    max_tokens: 600,
  });

  return response.choices[0]?.message?.content || '';
}

module.exports = { ask };
