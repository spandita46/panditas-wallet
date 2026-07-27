// Shared constants for detecting the "same real transaction, different
// externalId" case (observed: TD via SimpleFIN reissues a new externalId
// once a pending hold posts). Used both by sync.ts's live pending->posted
// merge and by anomalyDetection.ts's backlog scan — kept in one place so the
// two can't drift apart.
export const PENDING_MARKER = /\bpending\b/i;
export const PENDING_MATCH_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;
