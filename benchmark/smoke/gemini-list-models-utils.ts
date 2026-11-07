/**
 * Pure utility functions for the Gemini model availability diagnostic.
 * Exported separately so tests can import them without triggering the
 * script's top-level side effects (loadEnvLocal, API calls, process.exit).
 */
import { ApiError } from '@google/genai'

export function classifyApiError(err: ApiError): { code: string; httpStatus: number; explanation: string } {
  const status = err.status ?? 0
  if (status === 401 || status === 403) {
    return {
      code: 'LLM_AUTH_ERROR',
      httpStatus: status,
      explanation: 'API key is invalid, expired, or lacks permission to list models.',
    }
  }
  if (status === 429) {
    return {
      code: 'LLM_QUOTA_EXCEEDED',
      httpStatus: status,
      explanation: 'Rate limit or quota exceeded. Wait a moment and retry.',
    }
  }
  if (status === 404) {
    return {
      code: 'LLM_MODEL_UNAVAILABLE',
      httpStatus: status,
      explanation: 'Models endpoint not found. Verify SDK version or API availability.',
    }
  }
  if (status >= 500) {
    return {
      code: 'LLM_PROVIDER_UNAVAILABLE',
      httpStatus: status,
      explanation: 'Gemini service error. Check status.cloud.google.com and retry.',
    }
  }
  return {
    code: 'LLM_PROVIDER_UNAVAILABLE',
    httpStatus: status,
    explanation: 'Unexpected API error. See error code for details.',
  }
}

// Extract the short model identifier from a resource name.
// "models/gemini-2.0-flash" → "gemini-2.0-flash"
export function getShortModelId(name: string | undefined): string {
  if (!name) return ''
  return name.startsWith('models/') ? name.slice('models/'.length) : name
}

// Returns true when a model's supportedActions includes any generate* action.
export function supportsGenerateContent(actions: string[] | undefined): boolean {
  return (actions ?? []).some((a) => a.toLowerCase().includes('generate'))
}
