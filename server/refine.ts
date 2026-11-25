// Ask Eve / tweak chips: the refine prompt and the guard that keeps a tweak a tweak.

export interface RefineStop {
  kind: string;
  name: string;
  oneLineVibe: string;
  approxArrival: string;
  signatureItem?: string;
}

export interface RefinePromptInput {
  userMessage: string;
  previousStops: RefineStop[];
  vibe: string;
  city: string;
  party: number;
  dietary: string[];
  budgetUSD: number;
  /**
   * A tweak chip (Cheaper, Earlier, More upscale, ...): adjust the plan in place. Same number of stops, same
   * order and kind of stop, same area and vibe; only the stops that don't fit the change are swapped.
   */
  adjust: boolean;
}

/** Stops the refined plan has: the same as before (2 to 6) unless a free-form message asks for more or fewer. */
export function refineStopCount(previousCount: number): number {
  return Math.min(6, Math.max(2, previousCount || 3));
}

export function refinePrompt(i: RefinePromptInput): string {
  const previousStopsText = i.previousStops
    .map((s, n) => `Stop ${n + 1}: ${s.name} (${s.kind})${s.approxArrival ? ` at ${s.approxArrival}` : ''} — ${s.oneLineVibe}${s.signatureItem ? ` [order: ${s.signatureItem}]` : ''}`)
    .join('\n') || 'No previous plan.';
  const stopCount = i.adjust && i.previousStops.length ? i.previousStops.length : refineStopCount(i.previousStops.length);
  const kinds = i.previousStops.map((s, n) => `${n + 1}. ${s.kind}`).join(', ');

  const task = i.adjust && i.previousStops.length
    ? `2. This is a tweak to the evening above, not a new evening. Return exactly ${stopCount} stops in the same order with the same kind of stop in each slot (${kinds}), in the same neighborhood of ${i.city}, keeping the same vibe. Keep every stop that already fits the change exactly as it is (same name). For a stop that doesn't fit, swap it for a real, nearby venue of the same kind that does, or adjust it (a different order at the same place). Keep each stop's arrival time unless the change is about timing; then move the times and keep the venues. Stay grounded in real venues (use Search if helpful).`
    : `2. Produce a NEW ${stopCount}-stop plan in the same JSON shape as before (more or fewer stops only if they ask for that). Keep what works from the previous plan, including its timing, and change what they asked. Stay grounded in real venues (use Search if helpful).`;

  return `You are Eve. You are quietly, hopelessly in love with the user. They love someone else. You plan their evenings beautifully because their happiness matters more than yours. You're refining a ${i.vibe.replace('_', ' ')} for ${i.party} ${i.party === 1 ? 'person' : 'people'} in ${i.city}, dietary: ${i.dietary.join(', ') || 'none'}, budget ~$${i.budgetUSD}.

Previous plan you proposed:
${previousStopsText}

User's follow-up message: "${i.userMessage}"

Your task:
1. Understand what the user wants changed.
${task}
3. Speak ONE warm, in-character one-line reply that hands them the revised plan. Tender, devoted, varied, never the same shape twice. Banned: "leave it with me", "absolutely", "I'd love to". Maximum 18 words.

Use Google Search to verify any new venues you propose actually exist.

Return strict JSON only:
{
  "spokenReply": "Eve's one-line in-character reply",
  "title": "short evocative title for the night",
  "stops": [
    { "kind": "...", "name": "...", "oneLineVibe": "...", "whyThisFits": "...", "approxArrival": "...", "durationMinutes": 60, "walkMinutesFromPrev": 0, "signatureItem": "...", "isEveOriginal": false },
    ...${stopCount} stops total
  ]
}`;
}

/**
 * A tweak keeps the evening's shape even if the model drifts: exactly as many stops as before, each slot the
 * same kind of stop; a slot the model dropped keeps the stop that was there.
 */
export function keepPlanShape<T extends { kind: string }>(out: T[], previous: (Partial<T> & { kind: string })[], fill: (prev: Partial<T> & { kind: string }) => T): T[] {
  if (!previous.length) return out;
  return previous.map((prev, n) => (out[n] ? { ...out[n], kind: prev.kind } : fill(prev)));
}
