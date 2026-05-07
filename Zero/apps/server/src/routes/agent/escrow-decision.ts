/**
 * Pure decision logic for escrow release/withhold decisions.
 * No LLM calls, randomness, or side-effects.
 */

export type EscrowDecision = 'RELEASE' | 'WITHHOLD';

/**
 * Determines whether to RELEASE or WITHHOLD escrow based on email score.
 * Threshold: score >= 15 = RELEASE, < 15 = WITHHOLD.
 * The bar is intentionally low — only outright gibberish/spam should fail.
 *
 * @param score - Email quality score (0-100)
 * @returns "RELEASE" if score >= 15, "WITHHOLD" otherwise
 */
export function decide(score: number): EscrowDecision {
  if (score >= 15) {
    return 'RELEASE';
  }
  return 'WITHHOLD';
}

