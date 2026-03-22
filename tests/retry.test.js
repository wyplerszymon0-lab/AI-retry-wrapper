const { withRetry, CircuitBreaker, RetryError, isRetryable, computeDelay } = require("../src/retry");

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

test("succeeds on first attempt", async () => {
  const result = await withRetry(async () => "ok", { maxRetries: 3, initialDelayMs: 1 });
  expect(result).toBe("ok");
});

test("retries and succeeds on second attempt", async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    if (calls < 2) {
      const err = new Error("rate limit");
      throw err;
    }
    return "success";
  }, { maxRetries: 3, initialDelayMs: 1, jitter: false });
  expect(result).toBe("success");
  expect(calls).toBe(2);
});

test("throws RetryError after max retries", async () => {
  await expect(
    withRetry(async () => { throw new Error("rate limit"); }, { maxRetries: 2, initialDelayMs: 1 })
  ).rejects.toThrow(RetryError);
});

test("RetryError contains attempt count", async () => {
  try {
    await withRetry(async () => { throw new Error("timeout"); }, { maxRetries: 2, initialDelayMs: 1 });
  } catch (err) {
    expect(err.attempts).toBe(3);
  }
});

test("does not retry non-retryable errors", async () => {
  let calls = 0;
  await expect(
    withRetry(async () => {
      calls++;
      const err = new Error("Invalid API key");
      err.status = 401;
      throw err;
    }, { maxRetries: 3, initialDelayMs: 1 })
  ).rejects.toThrow();
  expect(calls).toBe(1);
});

test("retries on 429 status", async () => {
  let calls = 0;
  await expect(
    withRetry(async () => {
      calls++;
      const err = new Error("rate limited");
      err.status = 429;
      throw err;
    }, { maxRetries: 2, initialDelayMs: 1 })
  ).rejects.toThrow();
  expect(calls).toBe(3);
});

test("calls onRetry callback with error and attempt", async () => {
  const retryLog = [];
  await expect(
    withRetry(async () => { throw new Error("timeout"); }, {
      maxRetries: 2,
      initialDelayMs: 1,
      onRetry: (err, attempt) => retryLog.push({ msg: err.message, attempt }),
    })
  ).rejects.toThrow();
  expect(retryLog.length).toBe(2);
  expect(retryLog[0].attempt).toBe(1);
  expect(retryLog[1].attempt).toBe(2);
});

test("isRetryable returns true for rate limit message", () => {
  const err = new Error("rate limit exceeded");
  expect(isRetryable(err, [429])).toBe(true);
});

test("isRetryable returns true for retryable status codes", () => {
  const err = new Error("server error");
  err.status = 503;
  expect(isRetryable(err, [429, 500, 502, 503, 504])).toBe(true);
});

test("isRetryable returns false for 401", () => {
  const err = new Error("unauthorized");
  err.status = 401;
  expect(isRetryable(err, [429, 500, 503])).toBe(false);
});

test("computeDelay increases with attempt", () => {
  const opts = { initialDelayMs: 1000, backoffMultiplier: 2, maxDelayMs: 30000, jitter: false };
  expect(computeDelay(0, opts)).toBe(1000);
  expect(computeDelay(1, opts)).toBe(2000);
  expect(computeDelay(2, opts)).toBe(4000);
});

test("computeDelay respects maxDelayMs", () => {
  const opts = { initialDelayMs: 1000, backoffMultiplier: 2, maxDelayMs: 3000, jitter: false };
  expect(computeDelay(10, opts)).toBe(3000);
});

test("circuit breaker opens after threshold failures", () => {
  const breaker = new CircuitBreaker({ threshold: 3 });
  breaker.recordFailure();
  breaker.recordFailure();
  expect(breaker.isOpen()).toBe(false);
  breaker.recordFailure();
  expect(breaker.isOpen()).toBe(true);
  expect(breaker.getState()).toBe("open");
});

test("circuit breaker resets after resetMs", async () => {
  const breaker = new CircuitBreaker({ threshold: 1, resetMs: 20 });
  breaker.recordFailure();
  expect(breaker.isOpen()).toBe(true);
  await wait(30);
  expect(breaker.isOpen()).toBe(false);
  expect(breaker.getState()).toBe("half-open");
});

test("circuit breaker closes after success", () => {
  const breaker = new CircuitBreaker({ threshold: 2 });
  breaker.recordFailure();
  breaker.recordFailure();
  expect(breaker.isOpen()).toBe(true);
  breaker.recordSuccess();
  expect(breaker.isOpen()).toBe(false);
  expect(breaker.getState()).toBe("closed");
});

test("circuit breaker reset clears state", () => {
  const breaker = new CircuitBreaker({ threshold: 1 });
  breaker.recordFailure();
  breaker.reset();
  expect(breaker.isOpen()).toBe(false);
  expect(breaker.getState()).toBe("closed");
});
