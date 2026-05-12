const sdk = require('microsoft-cognitiveservices-speech-sdk');

const SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const SPEECH_REGION = process.env.AZURE_SPEECH_REGION;
const SPEECH_LANGUAGE = process.env.AZURE_SPEECH_LANGUAGE || 'en-GB';

function buildRecognizer({ speaker, onPartial, onFinal }) {
  const audioFormat = sdk.AudioStreamFormat.getWaveFormat(
    8000,
    8,
    1,
    sdk.AudioFormatTag.MuLaw,
  );
  const pushStream = sdk.AudioInputStream.createPushStream(audioFormat);
  const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

  const speechConfig = sdk.SpeechConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION);
  speechConfig.speechRecognitionLanguage = SPEECH_LANGUAGE;
  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceResponse_PostProcessingOption,
    'TrueText',
  );

  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

  recognizer.recognizing = (_s, e) => {
    if (e.result.text) onPartial({ speaker, text: e.result.text });
  };
  recognizer.recognized = (_s, e) => {
    if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
      onFinal({ speaker, text: e.result.text });
    }
  };
  recognizer.canceled = (_s, e) => {
    if (e.reason === sdk.CancellationReason.Error) {
      console.error(`[speech:${speaker}] canceled:`, e.errorDetails);
    }
  };

  recognizer.startContinuousRecognitionAsync(
    () => {},
    (err) => console.error(`[speech:${speaker}] start failed:`, err),
  );

  return {
    push(audioBuffer) {
      pushStream.write(
        audioBuffer.buffer.slice(
          audioBuffer.byteOffset,
          audioBuffer.byteOffset + audioBuffer.byteLength,
        ),
      );
    },
    close() {
      recognizer.stopContinuousRecognitionAsync(
        () => {
          pushStream.close();
          recognizer.close();
        },
        (err) => console.error(`[speech:${speaker}] stop failed:`, err),
      );
    },
  };
}

function createCallTranscriber({ callSid, onPartial, onFinal }) {
  if (!SPEECH_KEY || !SPEECH_REGION) {
    throw new Error('AZURE_SPEECH_KEY and AZURE_SPEECH_REGION must be set');
  }

  const customer = buildRecognizer({ speaker: 'Customer', onPartial, onFinal });
  const engineer = buildRecognizer({ speaker: 'Engineer', onPartial, onFinal });

  return {
    pushTrack(track, audioBuffer) {
      if (track === 'inbound') customer.push(audioBuffer);
      else if (track === 'outbound') engineer.push(audioBuffer);
    },
    close() {
      customer.close();
      engineer.close();
    },
  };
}

module.exports = { createCallTranscriber };
