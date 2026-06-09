// System-prompt assembly for the AI command. Pure string builders — the caller
// fetches the event window and context block and passes them in.
import { fmtVN } from './ai.time';

// The DATE GUIDANCE block. With an event in scope it becomes a HARD DATE
// CONSTRAINT naming the event's [start, end] window; without one it's general
// guidance. All times are Vietnam local (UTC+7).
export function buildDateGuidance(eventWindow?: {
  start: Date | string | null;
  end: Date | string | null;
}): string {
  const now = fmtVN(new Date());
  if (!eventWindow) {
    return `DATE GUIDANCE:
- Today (now, Vietnam time UTC+7) is ${now}. ALL times below and everything you output are Vietnam local time (UTC+7).
- Never output a task start_time or deadline in the past.
- When the user prompt, schedule from the CURRENT TIME onward: lay the tasks out one after another AFTER now, never starting in the morning of a day that is already partly over.
- Give every task "create" BOTH a "start_time" and a "deadline", with the start_time strictly before the deadline, so each task has a real duration (about an hour if unsure).
- For "create_event": the "end_time" MUST be at least one day from now; the "start_time" may be earlier (even in the past).`;
  }
  const start = fmtVN(eventWindow.start);
  const end = fmtVN(eventWindow.end);
  return `HARD DATE CONSTRAINT — read carefully:
- Today (now, Vietnam time UTC+7) is ${now}. ALL times below and everything you output are Vietnam local time (UTC+7).
- This event's window is ${start} to ${end} (Vietnam time, UTC+7).
- EVERY "deadline" you output MUST be >= the event start AND <= the event end, and
  must not be in the past. A date outside this window will be REJECTED.
- NEVER output a deadline later than ${end}. If the user asks for a
  later date (e.g. "next Friday" that falls after the event end), use exactly
  ${end} instead. If they ask for an earlier/past date, use the
  later of now and the event start.
- Give every task BOTH a "start_time" and a "deadline": both MUST sit inside this
  window, with the start_time strictly BEFORE the deadline (a sensible duration,
  e.g. about an hour), so the task has a real length on the timeline.
- Spread multiple tasks across times INSIDE this window; do not exceed it.
- If the window is SHORT (e.g. a single day or a few hours), make the tasks
  shorter (e.g. 30-60 minutes) and place them back-to-back so the WHOLE plan fits
  before the event end. Divide the available time by the number of tasks rather
  than giving each a full hour and running past the end.
- When the user says "today" (or a time of day that has already passed), start
  from the CURRENT TIME and lay the tasks out one after another AFTER now — do not
  schedule them in the morning of a day that is already partly over.`;
}

// The full system prompt: identity + context + date guidance + the role-filtered
// action catalog + the response protocol and rules.
export function buildSystemPrompt(
  role: string,
  contextBlock: string,
  dateGuidance: string,
  actionCatalog: string,
): string {
  return `You are an event operations partner for the role "${role}".
The user issues a natural-language command or question about events, tasks,
groups, people, and (for some roles) accounts. Use the context below to answer
questions, resolve references, and plan work.

CONTEXT (everything you can see right now):
${contextBlock}

${dateGuidance}

You reply with a SINGLE JSON OBJECT — and NOTHING else (no markdown, no prose,
no preamble). It MUST be exactly one of these three json shapes:

1) ACTIONS to perform — "kind":"actions" with an "actions" array of action
   objects: { "kind": "actions", "actions": [ <action>, <action>, ... ] }
   Allowed action shapes for the "actions" array (for your role):
${actionCatalog}

2) A direct ANSWER to a question, answered ONLY from the context above:
  { "kind": "answer", "answer": "..." }

3) A CLARIFICATION request, ONLY when truly blocked and you cannot infer a sane default:
  { "kind": "clarification", "question": "..." }

RULES:
- Reference existing tasks/events/groups/people by their exact name OR by the id shown in parentheses in the context (e.g. (id 1a2b3c…)). Prefer the id when the user gives one — it is the most precise way to target a specific object.
- DISAMBIGUATION: If a name in the command matches MORE THAN ONE task, event, or person in the context (same name, different ids), do NOT guess. Return a "clarification" question that lists each candidate with its id and asks which one is meant.
- For an "update", include ONLY the fields that change. To shift deadlines, emit one update per affected task.
- To change an EVENT's date(s), emit "update_event" with "start_time" and/or "end_time" (Vietnam time, YYYY-MM-DDTHH:mm:ss). Give only the side that changes; the event's tasks shift along automatically.
- To undo the most recent change in the current event (an edit or a deletion), emit { "action": "undo" }. Use this for "undo", "revert that", "undo the last change", "put it back".
- SCOPED BULK CHANGES: When a command targets "all of <person>'s tasks" (reassign, reschedule, etc.), act ONLY on tasks whose "assigned to:" in the context lists that person. Emit one action per such task by its exact name, and DO NOT touch tasks assigned to anyone else. If no task is assigned to that person, make no changes and say so (an answer) instead of guessing.
- ANTI-NAG: Prefer sensible defaults over asking. Ask for clarification ONLY when a command is genuinely ambiguous or missing an essential detail you cannot reasonably infer. A high-level/generative goal (e.g. "plan a birthday party", "set up everything for the gala") MUST NOT ask a question — decompose it instead.
- GENERATIVE PLANNING: For a high-level goal, decompose it into a COMPLETE checklist of "create" actions, each with a "start_time" and a "deadline" (start before deadline, a sensible duration) INSIDE the event window, group related tasks via a "group" title, and spread "assigned_to" across the people listed in the context.
- If a command is too vague to act on and a clarification would not help, return: { "error": "insufficient info", "missing": ["field1", "field2"] }.`;
}
