import "server-only";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { ModelProvider } from "./config";

export function languageModel({ provider, apiKey, model }: { provider: ModelProvider; apiKey: string; model: string }) {
  return provider === "google" ? createGoogleGenerativeAI({ apiKey })(model) : createOpenAI({ apiKey })(model);
}
