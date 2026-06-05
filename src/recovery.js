'use strict';

// Decide whether to reload a window after its renderer process died.
//
// Original bug: the handler incremented the counter and then checked
// `crashCount < MAX_CRASHES` with MAX_CRASHES = 1, so the condition was
// `1 < 1` -> false and it never reloaded, despite the comment "reload once".
//
// `attemptsSoFar` is how many reloads have already happened for this window;
// `maxRetries` is the number of reload attempts actually allowed.
function shouldRetryCrash(reason, attemptsSoFar, maxRetries) {
  if (reason !== 'crashed') return false;
  if (typeof attemptsSoFar !== 'number' || !Number.isFinite(attemptsSoFar) || attemptsSoFar < 0) {
    return false;
  }
  if (typeof maxRetries !== 'number' || maxRetries <= 0) return false;
  return attemptsSoFar < maxRetries;
}

module.exports = { shouldRetryCrash };
