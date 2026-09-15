// Official @google/genai SDK client, configured once and reused everywhere
// we need to talk to Gemini (currently just aiProduct.service.ts, but this
// is the one place that would need to change if the API key or model ever
// moved to per-request configuration).
import { GoogleGenAI } from '@google/genai';
import { env } from './env.js';

export const genAI = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

export const GEMINI_MODEL = env.GEMINI_MODEL;
