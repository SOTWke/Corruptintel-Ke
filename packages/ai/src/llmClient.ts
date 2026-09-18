/**
 * A single internal interface every business-logic caller uses, per AI Agent
 * Architecture §10: "no business logic depends on a specific vendor SDK."
 * Every call is schema-constrained (tool-use / forced JSON) — free-text
 * completions are not exposed here on purpose. Sub-agents that need
 * free-text (the Reporting Agent's narrative) still get a strict schema
 * wrapping that narrative with mandatory evidence references.
 */
export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface CompletionRequest {
  /** Fixed, versioned system instructions. Never influenced by retrieved content. */
  system: string;
  /** The actual task input. Untrusted document content must already be
   * wrapped via wrapUntrustedContent() before it lands here — see
   * promptBoundaries.ts. */
  userContent: string;
  schema: JsonSchema;
  schemaName: string;
  maxTokens?: number;
}

export interface CompletionResult<T> {
  data: T;
  modelName: string;
  modelVersion: string;
  rawStopReason: string;
}

export interface LlmClient {
  complete<T>(req: CompletionRequest): Promise<CompletionResult<T>>;
}

// ---------------------------------------------------------------------------
// Anthropic implementation
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";

class AnthropicLlmClient implements LlmClient {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = "claude-sonnet-4-6") {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async complete<T>(req: CompletionRequest): Promise<CompletionResult<T>> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 2000,
      system: req.system,
      messages: [{ role: "user", content: req.userContent }],
      tools: [
        {
          name: req.schemaName,
          description: `Return the extracted data matching the ${req.schemaName} schema. This is the only acceptable output format.`,
          input_schema: req.schema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: req.schemaName },
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    if (!toolUse) {
      throw new Error(
        `Model did not return a ${req.schemaName} tool call (stop_reason=${response.stop_reason}). ` +
          `Schema-constrained calls should always produce a tool_use block.`
      );
    }

    return {
      data: toolUse.input as T,
      modelName: "anthropic",
      modelVersion: this.model,
      rawStopReason: response.stop_reason ?? "unknown",
    };
  }
}

let cachedClient: LlmClient | null = null;

/** Factory reading LLM_PROVIDER from the environment. Anthropic is the only
 * implementation for now; adding an OpenAI-compatible adapter later means
 * adding one more branch here, not touching any of the agent code below. */
export function getLlmClient(): LlmClient {
  if (cachedClient) return cachedClient;

  const provider = process.env.LLM_PROVIDER || "anthropic";
  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set (required when LLM_PROVIDER=anthropic).");
    }
    cachedClient = new AnthropicLlmClient(apiKey);
    return cachedClient;
  }

  throw new Error(
    `Unsupported LLM_PROVIDER='${provider}'. Only 'anthropic' is implemented so far — ` +
      `add a new LlmClient implementation and a branch here to support another provider.`
  );
}
