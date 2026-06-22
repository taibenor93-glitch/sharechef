openaiWs.on('open', () => {
  console.log('[WS] Connected to OpenAI Realtime')
  openaiWs.send(JSON.stringify({
    type: 'session.update',
    session: {
      type: 'realtime',
      instructions: CHEF_PROMPT,
      audio: {
        output: { voice: 'nova' },
        input: { transcription: { model: 'whisper-1' } },
      },
      turn_detection: null,
      temperature: 0.8,
      max_response_output_tokens: 'inf',
    },
  }))
})
