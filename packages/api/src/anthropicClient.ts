import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.js";

let client: Anthropic | null = null;

// Lazily constructed so a missing ANTHROPIC_API_KEY only breaks the folder
// sync feature at the moment it's actually used, not at server startup.
export function getAnthropicClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured — folder sync is unavailable.");
  }
  if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export function isFolderSyncConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY && env.FOLDER_SYNC_DIR);
}
