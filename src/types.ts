export type Role = 'system' | 'user' | 'assistant' | 'tool' | 'function' | 'developer';

export interface ChatMessage {
  role: Role;
  content: string | ContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown;
  [key: string]: unknown;
}

export interface ContentPart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  n?: number;
  seed?: number;
  [key: string]: unknown;
}

export interface MinimiseResult {
  request: ChatCompletionRequest;
  tokensBefore: number;
  tokensAfter: number;
  appliedStrategies: string[];
}

export type Preset = 'off' | 'safe' | 'balanced' | 'aggressive';
