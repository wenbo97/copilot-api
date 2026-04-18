import { copilotFetch } from "./copilot-fetch"

export const createEmbeddings = async (payload: EmbeddingRequest) => {
  const response = await copilotFetch("/embeddings", {
    method: "POST",
    body: JSON.stringify(payload),
  })

  return (await response.json()) as EmbeddingResponse
}

export interface EmbeddingRequest {
  input: string | Array<string>
  model: string
}

export interface Embedding {
  object: string
  embedding: Array<number>
  index: number
}

export interface EmbeddingResponse {
  object: string
  data: Array<Embedding>
  model: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}
