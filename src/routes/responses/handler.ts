import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { applyModelMapping, getModelMappings } from "~/lib/model-mapping"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { StreamTracer, traceRequest, traceResponse } from "~/lib/trace"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"

import type { ResponsesPayload, ResponseStreamState } from "./responses-types"

import {
  translateToOpenAI,
  translateToResponses,
} from "./non-stream-translation"
import { translateChunkToResponseEvents } from "./stream-translation"

export async function handleResponses(c: Context) {
  await checkRateLimit(state)

  let payload = await c.req.json<ResponsesPayload>()
  consola.debug(
    "Responses API request payload:",
    JSON.stringify(payload).slice(-400),
  )

  // Apply model mapping if configured
  const originalModel = payload.model
  const mappings = getModelMappings()
  if (mappings.size > 0) {
    const { model, mapped } = applyModelMapping(
      payload.model,
      mappings,
      state.verbose,
    )
    if (mapped) {
      consola.info(
        `[Responses] Model mapping: "${originalModel}" -> "${model}"`,
      )
      payload = { ...payload, model }
    }
  }
  consola.info(`[Responses] Using model: "${payload.model}"`)
  const traceTimestamp = await traceRequest({
    type: "responses",
    original: payload,
  })

  const openAIPayload = translateToOpenAI(payload)
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  if (state.manualApprove) await awaitApproval()

  const response = await createChatCompletions(openAIPayload)

  if (isNonStreaming(response)) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response).slice(-400),
    )
    const responsesResponse = translateToResponses(response)
    await traceResponse(
      { type: "responses", openai: response, translated: responsesResponse },
      traceTimestamp,
    )
    return c.json(responsesResponse)
  }

  // Streaming — Responses API uses plain SSE with `type` field in data, not `event:` field
  consola.debug("Streaming response from Copilot")
  return streamSSE(c, async (stream) => {
    const streamState: ResponseStreamState = {
      responseId: "",
      model: payload.model,
      outputItemIndex: 0,
      contentPartIndex: 0,
      messageStarted: false,
      toolCalls: {},
    }

    const streamTracer = new StreamTracer(traceTimestamp)

    for await (const rawEvent of response) {
      consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
      if (rawEvent.data === "[DONE]") break
      if (!rawEvent.data) continue

      const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
      const events = translateChunkToResponseEvents(chunk, streamState)

      for (const event of events) {
        consola.debug("Translated Responses event:", JSON.stringify(event))
        streamTracer.addChunk({ openai: chunk, responses: event })
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        })
      }
    }

    await streamTracer.finish()
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
