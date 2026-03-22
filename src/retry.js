const DEFAULTS = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
  retryableStatuses: [429, 500, 502, 503, 504],
};

class RetryError extends Error {
  constructor(message, attempts, lastError) {
    super(message);
    this.name = "RetryError";
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

class CircuitBreaker {
  constructor(options = {}) {
    this.threshold = options.threshold ?? 5;
    this.resetMs = options.resetMs ?? 60000;
    this.failures = 0;
    this.state = "closed";
    this.openedAt = null;
  }

  isOpen() {
    if (this.state === "open") {
      if (Date.now() - this.openedAt >= this.resetMs) {
        this.state = "half-open";
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess() {
    this.failures = 0;
    this.state = "closed";
    this.openedAt = null;
  }

  recordFailure() {
    this.failures++;
    if (this.failures >= this.threshold) {
      this.state = "open";
      this.openedAt = Date.now();
    }
  }

  getState() {
    return this.state;
  }

  reset() {
    this.failures = 0;
    this.state = "closed";
    this.openedAt = null;
  }
}

function computeDelay(attempt, options) {
  const base = options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt);
  const capped = Math.min(base, options.maxDelayMs);
  if (!options.jitter) return capped;
  return capped * (0.5 + Math.random() * 0.5);
}

function isRetryable(error, retryableStatuses) {
  if (error?.status && retryableStatuses.includes(error.status)) return true;
  if (error?.code === "ECONNRESET" || error?.code === "ETIMEDOUT") return true;
  if (error?.message?.toLowerCase().includes("rate limit")) return true;
  if (error?.message?.toLowerCase().includes("timeout")) return true;
  return false;
}

async function withRetry(fn, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  let lastError = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const result = await fn(attempt);
      return result;
    } catch (err) {
      lastError = err;

      if (attempt === opts.maxRetries) break;
      if (!isRetryable(err, opts.retryableStatuses)) break;

      if (opts.onRetry) {
        opts.onRetry(err, attempt + 1);
      }

      const delay = computeDelay(attempt, opts);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw new RetryError(
    `Failed after ${opts.maxRetries + 1} attempts: ${lastError?.message}`,
    opts.maxRetries + 1,
    lastError,
  );
}

module.exports = { withRetry, CircuitBreaker, RetryError, isRetryable, computeDelay };
