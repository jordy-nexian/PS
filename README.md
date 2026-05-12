# MSP Call Copilot

Live call transcription and AI copilot for managed-service-provider engineers.

When a customer calls a Twilio number, the call is bridged to the engineer's phone while a live audio stream is forwarded to Azure AI Speech for transcription. The engineer opens a web dashboard that shows both sides of the conversation in real time and exposes a chat sidebar where they can ask Azure OpenAI (`gpt-4o`) questions with the running transcript as context.

## Architecture

```
Customer ──► Twilio number ──► /voice (TwiML: <Start><Stream> + <Dial>)
                                          │
                                          ├──► <Dial> engineer's phone
                                          │
                                          └──► wss://app/stream (Twilio Media Streams,
                                                                 both tracks, μ-law 8kHz)
                                                       │
                                                       ▼
                                            Node WS server (this app)
                                                       │
                                                       ├──► Azure AI Speech (two recognizers,
                                                       │     one per call leg, language en-GB)
                                                       │           │
                                                       │           └──► transcript deltas
                                                       │
                                                       └──► Dashboard (SSE) + /api/ask (Azure OpenAI)
```

## Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `PUBLIC_HOST` | Public hostname Twilio reaches, e.g. `myapp.azurecontainerapps.io`. Used to build the `wss://` Stream URL. |
| `ENGINEER_PHONE_NUMBER` | E.164 number to bridge calls to (e.g. `+447700900123`) |
| `AZURE_SPEECH_KEY` | Azure AI Speech resource key |
| `AZURE_SPEECH_REGION` | Azure AI Speech region (e.g. `uksouth`) |
| `AZURE_SPEECH_LANGUAGE` | BCP-47 locale (default `en-GB`) |
| `AZURE_OPENAI_ENDPOINT` | e.g. `https://my-foundry.openai.azure.com/` |
| `AZURE_OPENAI_API_KEY` | API key for the Foundry resource |
| `AZURE_OPENAI_API_VERSION` | Optional, defaults to `2024-10-21` |
| `AZURE_OPENAI_DEPLOYMENT` | Deployment name of `gpt-4o` (or `gpt-4.1`) in your Foundry project |

Put these in `.env` locally.

## Run locally

```bash
npm install
npm start
```

To expose the local server to Twilio, run a tunnel and set `PUBLIC_HOST` to the tunnel hostname (without scheme):

```bash
# Example with cloudflared
cloudflared tunnel --url http://localhost:3000
# PUBLIC_HOST=<your-tunnel>.trycloudflare.com
```

## Provisioning Azure resources

You need three things in your Azure subscription (all surfaced in Foundry):

1. **Azure AI Speech** resource — gives you `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION`.
2. **Azure OpenAI** resource with a `gpt-4o` (or `gpt-4.1`) deployment — gives you `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_API_KEY` / `AZURE_OPENAI_DEPLOYMENT`.
3. **Azure Container Apps** environment to host this server.

## Deploy to Azure Container Apps

```bash
# Variables to set first
RG=msp-copilot-rg
LOCATION=uksouth
APP=msp-copilot

# Build & push via ACR + deploy in one go (source build)
az group create -n $RG -l $LOCATION
az containerapp up \
  --name $APP \
  --resource-group $RG \
  --location $LOCATION \
  --source . \
  --ingress external \
  --target-port 3000 \
  --env-vars \
    PUBLIC_HOST=$APP.<your-env-domain>.azurecontainerapps.io \
    ENGINEER_PHONE_NUMBER=+447700900123 \
    AZURE_SPEECH_KEY=<...> \
    AZURE_SPEECH_REGION=uksouth \
    AZURE_OPENAI_ENDPOINT=https://<your-foundry>.openai.azure.com/ \
    AZURE_OPENAI_API_KEY=<...> \
    AZURE_OPENAI_DEPLOYMENT=gpt-4o
```

After the first deploy, the actual FQDN is printed; re-set `PUBLIC_HOST` to that exact value and redeploy so the Twilio Stream URL matches.

Container Apps supports WebSockets natively — no extra configuration needed.

## Twilio configuration

1. Phone Numbers → Active Numbers → your number → Voice Configuration:
   - **A call comes in** → `Webhook`, `https://<PUBLIC_HOST>/voice`, `POST`
   - **Call status changes** (optional) → `https://<PUBLIC_HOST>/call-status`, `POST`
2. Save.

## Using it

1. Engineer opens `https://<PUBLIC_HOST>/` in a browser.
2. Customer dials the Twilio number.
3. The engineer's phone rings; they answer normally.
4. The dashboard shows live transcript (Customer in blue, Engineer in green).
5. Engineer types questions in the right sidebar (e.g. "what's the runbook for that error?"); answers stream back with the live transcript as context.

## Limits in v1

- **No auth** on the dashboard — anyone with the URL can see active calls. Add Entra ID / Container Apps auth before going to production.
- **No persistent storage** — transcripts live in memory and are lost on restart. Add Postgres/Cosmos DB next.
- **Single active call** at a time in the dashboard view (server tracks the most recent active call SID).
