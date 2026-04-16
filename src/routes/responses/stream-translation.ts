import type { ChatCompletionChunk } from "~/services/copilot/create-chat-completions"

import type {
  ResponseObject,
  ResponseOutputFunctionCall,
  ResponseOutputMessage,
  ResponseStreamEvent,
  ResponseStreamState,
} from "./responses-types"

export function translateChunkToResponseEvents(
  chunk: ChatCompletionChunk,
  state: ResponseStreamState,
): Array<ResponseStreamEvent> {
  const events: Array<ResponseStreamEvent> = []
  if (chunk.choices.length === 0) return events

  const choice = chunk.choices[0]
  const { delta } = choice

  emitResponseStart(chunk, state, events)
  emitTextDelta(delta, state, events)
  emitToolCallDeltas(delta, state, events)
  emitFinish({ choice, chunk, state }, events)

  return events
}

function emitResponseStart(
  chunk: ChatCompletionChunk,
  state: ResponseStreamState,
  events: Array<ResponseStreamEvent>,
): void {
  if (state.messageStarted) return

  state.responseId = chunk.id
  state.model = chunk.model

  const skeleton = makeResponseSkeleton(state, chunk)
  events.push(
    { type: "response.created", response: skeleton },
    {
      type: "response.in_progress",
      response: { ...skeleton, status: "in_progress" },
    },
  )
  state.messageStarted = true
}

function emitTextDelta(
  delta: { content?: string | null },
  state: ResponseStreamState,
  events: Array<ResponseStreamEvent>,
): void {
  if (!delta.content) return

  if (state.outputItemIndex === 0 && !hasOutputItem(state)) {
    const msgItem: ResponseOutputMessage = {
      type: "message",
      id: `msg_${state.responseId}`,
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "", annotations: [] }],
    }
    events.push(
      {
        type: "response.output_item.added",
        output_index: state.outputItemIndex,
        item: msgItem,
      },
      {
        type: "response.content_part.added",
        output_index: state.outputItemIndex,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      },
    )
    markOutputItem(state)
  }

  events.push({
    type: "response.output_text.delta",
    output_index: state.outputItemIndex,
    content_index: 0,
    delta: delta.content,
  })
}

interface ToolCallDelta {
  index: number
  id?: string
  function?: { name?: string; arguments?: string }
}

function emitToolCallDeltas(
  delta: { tool_calls?: Array<ToolCallDelta> },
  state: ResponseStreamState,
  events: Array<ResponseStreamEvent>,
): void {
  if (!delta.tool_calls) return

  for (const tc of delta.tool_calls) {
    if (tc.id && tc.function?.name) {
      if (hasOutputItem(state)) {
        state.outputItemIndex++
      }

      const callId = tc.id
      state.toolCalls[tc.index] = {
        id: `fc_${callId}`,
        callId,
        name: tc.function.name,
        outputItemIndex: state.outputItemIndex,
      }

      const fcItem: ResponseOutputFunctionCall = {
        type: "function_call",
        id: `fc_${callId}`,
        call_id: callId,
        name: tc.function.name,
        arguments: "",
        status: "completed",
      }
      events.push({
        type: "response.output_item.added",
        output_index: state.outputItemIndex,
        item: fcItem,
      })
      markOutputItem(state)
    }

    if (tc.function?.arguments) {
      const info = state.toolCalls[tc.index]
      // info is guaranteed to exist when arguments are present
      events.push({
        type: "response.function_call_arguments.delta",
        output_index: info.outputItemIndex,
        delta: tc.function.arguments,
      })
    }
  }
}

function emitFinish(
  ctx: {
    choice: { finish_reason: string | null }
    chunk: ChatCompletionChunk
    state: ResponseStreamState
  },
  events: Array<ResponseStreamEvent>,
): void {
  const { choice, chunk, state } = ctx
  if (!choice.finish_reason) return

  // Close any open text content
  if (state.outputItemIndex >= 0 && Object.keys(state.toolCalls).length === 0) {
    events.push(
      {
        type: "response.output_text.done",
        output_index: 0,
        content_index: 0,
        text: "", // full text not tracked in streaming
      },
      {
        type: "response.content_part.done",
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      },
    )
  }

  // Close function call arguments if any
  for (const info of Object.values(state.toolCalls)) {
    events.push({
      type: "response.function_call_arguments.done",
      output_index: info.outputItemIndex,
      arguments: "",
    })
  }

  // Done items + completed
  const completed = makeResponseSkeleton(state, chunk)
  completed.status = "completed"
  completed.usage = {
    input_tokens: chunk.usage?.prompt_tokens ?? 0,
    output_tokens: chunk.usage?.completion_tokens ?? 0,
    total_tokens:
      (chunk.usage?.prompt_tokens ?? 0) + (chunk.usage?.completion_tokens ?? 0),
  }
  events.push({ type: "response.completed", response: completed })
}

// Track whether we've emitted the first output item
const outputItemStarted = new WeakSet<ResponseStreamState>()

function hasOutputItem(state: ResponseStreamState): boolean {
  return outputItemStarted.has(state)
}
function markOutputItem(state: ResponseStreamState): void {
  outputItemStarted.add(state)
}

function makeResponseSkeleton(
  state: ResponseStreamState,
  chunk: ChatCompletionChunk,
): ResponseObject {
  return {
    id: state.responseId || chunk.id,
    object: "response",
    created_at: chunk.created,
    model: state.model || chunk.model,
    status: "completed",
    output: [],
    usage: {
      input_tokens: chunk.usage?.prompt_tokens ?? 0,
      output_tokens: chunk.usage?.completion_tokens ?? 0,
      total_tokens:
        (chunk.usage?.prompt_tokens ?? 0)
        + (chunk.usage?.completion_tokens ?? 0),
    },
    error: null,
  }
}
