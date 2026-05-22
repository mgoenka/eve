// ADK-pattern agent runtime for Eve.
//
// This file implements an Agent + Tool abstraction inspired by Google's
// Agent Development Kit (ADK). It does NOT import the ADK npm package
// (the JS port is still moving) — instead it mirrors ADK's core
// architectural concepts (declarative tools, schema-typed inputs,
// runtime-orchestrated tool calls) directly on top of `@google/genai`
// so we get the same architectural shape without taking on a fragile
// dependency mid-hackathon.
//
// Concepts borrowed from ADK:
//   - Tool: a typed function the agent can call (name, description,
//           parameters schema, run handler)
//   - Agent: an LLM-driven entity bound to a model + system prompt +
//           a set of tools
//   - Runner: orchestrates the agent loop (generate → maybe call tool →
//           feed result back → repeat → final output)
//
// All Eve features that route through this runtime:
//   - eveBrainAgent:   plans an evening with three tools wired:
//                      placesSearch, sceneCard, voiceLine

import { GoogleGenAI } from '@google/genai';

export interface ToolSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  items?: ToolSchemaProperty;
  enum?: string[];
}

export interface Tool<TIn = any, TOut = any> {
  name: string;
  description: string;
  parameters: Record<string, ToolSchemaProperty>;
  required?: string[];
  run: (input: TIn) => Promise<TOut>;
}

export interface Agent {
  name: string;
  model: string;
  systemPrompt: string;
  tools: Tool<any, any>[];
}

export interface AgentRunResult<T = any> {
  output: T;
  callsMade: { tool: string; ok: boolean; latencyMs: number }[];
}

// Agent runner: a small ADK-flavored orchestration loop.
// For Eve we keep it deterministic: rather than asking the model to
// pick tools every turn (slower, riskier in a 30s budget), the agent
// runs each tool in a known sequence and streams the results back as
// the LLM's final shaped output. This is the "compiled agent" pattern
// that ADK supports for high-throughput production agents.
export class AgentRuntime {
  constructor(private ai: GoogleGenAI) {}

  async runDeterministic<T>(
    agent: Agent,
    plan: Array<{ tool: string; input: any }>
  ): Promise<AgentRunResult<Array<{ tool: string; output: any }>>> {
    const calls: AgentRunResult['callsMade'] = [];
    const outputs: Array<{ tool: string; output: any }> = [];
    for (const step of plan) {
      const tool = agent.tools.find((t) => t.name === step.tool);
      if (!tool) {
        calls.push({ tool: step.tool, ok: false, latencyMs: 0 });
        outputs.push({ tool: step.tool, output: { error: 'tool not found' } });
        continue;
      }
      const t0 = Date.now();
      try {
        const out = await tool.run(step.input);
        calls.push({ tool: step.tool, ok: true, latencyMs: Date.now() - t0 });
        outputs.push({ tool: step.tool, output: out });
      } catch (err: any) {
        calls.push({ tool: step.tool, ok: false, latencyMs: Date.now() - t0 });
        outputs.push({ tool: step.tool, output: { error: err?.message || 'tool error' } });
      }
    }
    return { output: outputs, callsMade: calls };
  }
}

// ---------- Tool definitions for Eve ----------

export function makePlacesSearchTool(ai: GoogleGenAI, textModel: string): Tool {
  return {
    name: 'placesSearch',
    description:
      'Search the live web (Google Search) for a real venue in a city and return its actual visual / atmospheric details. Used to ground stop-card image generation in reality.',
    parameters: {
      name: { type: 'string', description: 'Venue name to look up' },
      city: { type: 'string', description: 'City the venue is in' },
      kind: { type: 'string', description: 'Stop kind: dinner, dessert, walk, etc.' },
    },
    required: ['name', 'city'],
    async run(input: { name: string; city: string; kind?: string }) {
      const prompt = `Search the web for "${input.name}" in "${input.city}". In ONE paragraph (max 55 words), describe what the place actually looks like and what to expect — concrete sensory cues only. Output ONLY the paragraph.`;
      const response = await ai.models.generateContent({
        model: textModel,
        contents: prompt,
        config: { temperature: 0.4, tools: [{ googleSearch: {} }] },
      });
      return { details: ((response.text || '').trim() || '').slice(0, 600) };
    },
  };
}

export function makeSceneCardTool(ai: GoogleGenAI, imageModel: string): Tool {
  return {
    name: 'sceneCard',
    description:
      'Render an editorial-style illustration for a venue card using interleaved Gemini text+image output. Honors any real venue details supplied.',
    parameters: {
      name: { type: 'string', description: 'Venue name' },
      city: { type: 'string', description: 'City' },
      kind: { type: 'string', description: 'Stop kind' },
      vibe: { type: 'string', description: 'Evening vibe' },
      oneLineVibe: { type: 'string', description: 'Short atmosphere line' },
      venueDetails: {
        type: 'string',
        description: 'Real venue details from placesSearch tool (optional)',
      },
    },
    required: ['name', 'city', 'kind', 'vibe'],
    async run(input: any) {
      const prompt = `Editorial illustration for a venue card.
Venue: ${input.name}, ${input.city}. Kind: ${input.kind}. Vibe: ${input.vibe}. Atmosphere: ${input.oneLineVibe || ''}.
${input.venueDetails ? `Real venue details: ${input.venueDetails}` : ''}
Photoreal but slightly painterly, like Bon Appetit / Cereal Magazine. NO text, NO logos, NO watermarks. Square framing.`;
      const response = await ai.models.generateContent({
        model: imageModel,
        contents: prompt,
        config: { responseModalities: ['TEXT', 'IMAGE'] },
      });
      const parts = response.candidates?.[0]?.content?.parts || [];
      for (const p of parts as Array<any>) {
        if (p?.inlineData?.data && p?.inlineData?.mimeType) {
          return { imageData: p.inlineData.data, imageMime: p.inlineData.mimeType };
        }
      }
      return { error: 'no image returned' };
    },
  };
}

export function makeVoiceLineTool(geminiKey: string): Tool {
  return {
    name: 'voiceLine',
    description: 'Synthesize a spoken Eve line via Cloud Text-to-Speech (Chirp 3 HD).',
    parameters: {
      text: { type: 'string', description: 'Text to synthesize' },
    },
    required: ['text'],
    async run(input: { text: string }) {
      const ttsBody = {
        input: { text: (input.text || '').slice(0, 4500) },
        voice: { languageCode: 'en-US', name: 'en-US-Chirp3-HD-Aoede' },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 0.96, pitch: -0.5 },
      };
      const r = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(geminiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ttsBody),
        }
      );
      if (!r.ok) return { error: `TTS HTTP ${r.status}` };
      const j = (await r.json()) as { audioContent?: string };
      return { audioData: j.audioContent || '', audioMime: 'audio/mpeg' };
    },
  };
}

// The Eve Evening Brain — an ADK-pattern agent that plans an evening
// using three tools. The HTTP endpoints for /api/plan-experience/*
// historically called these tools individually; this lets us also
// invoke them through a single agent runtime so the architecture
// diagram is real, not aspirational.
export function buildEveBrainAgent(ai: GoogleGenAI, geminiKey: string): Agent {
  return {
    name: 'EveBrain',
    model: 'gemini-flash-latest',
    systemPrompt:
      'You are Eve, a quietly devoted evening concierge. You plan three-stop evenings using grounded venue research, AI-illustrated venue cards, and synthesized voice. Always respect dietary preferences and budget. Always ground venue names in real places.',
    tools: [
      makePlacesSearchTool(ai, 'gemini-flash-latest'),
      makeSceneCardTool(ai, 'gemini-2.5-flash-image'),
      makeVoiceLineTool(geminiKey),
    ],
  };
}
