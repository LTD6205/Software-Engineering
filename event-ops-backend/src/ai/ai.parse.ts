// Parsing helpers for the model's reply. Pure functions — exercised by
// ai.service.spec.ts.
import { Priority } from './ai.types';

// Pull the JSON payload out of a model reply. Models sometimes wrap the JSON in
// a ```json fence or add a sentence of prose despite the "JSON only" instruction;
// strip a surrounding code fence and, failing that, slice from the first opening
// bracket to the last closing one so JSON.parse succeeds.
export function extractJson(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  if (s[0] !== '{' && s[0] !== '[') {
    const starts = [s.indexOf('{'), s.indexOf('[')].filter((i) => i >= 0);
    const start = starts.length ? Math.min(...starts) : -1;
    const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
  }
  return s;
}

export function priorityScore(p: Priority): number {
  return p === 'high' ? 90 : p === 'medium' ? 50 : 10;
}

export function normalisePriority(p: unknown): Priority {
  return p === 'high' || p === 'low' ? p : 'medium';
}
