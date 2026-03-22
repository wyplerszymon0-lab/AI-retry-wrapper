const { withRetry, CircuitBreaker } = require("./retry");

class ResilientLLMClient {
  constructor(primaryClient, options = {}) {
    this.primary = primaryClient;
    this.fallback = options.fallback ?? null;
    this.breaker = new CircuitBreaker(options.circuitBreaker ?? {});
    this.retryOptions = options.retry ?? {};
    this.stats = { success: 0, retried: 0, fallback: 0, failed: 0 };
  }

  async complete(model, messages, options = {}) {
    if (this.breaker.isOpen()) {
      if (this.fallback) {
        this.stats.fallback++;
        return this._callFallback(messages, options);
      }
      throw new Error("Circuit breaker is open and no fallback configured");
    }

    try {
      let retried = false;

      const result = await withRetry(
        async () => {
          const response = await this.primary.chat.completions.create({
            model,
            messages,
            ...options,
          });
          return response.choices[0]?.message?.content ?? "";
        },
        {
          ...this.retryOptions,
          onRetry: (err, attempt) => {
            retried = true;
            this.stats.retried++;
            if (this.retryOptions.onRetry) this.retryOptions.onRetry(err, attempt);
          },
        },
      );

      this.breaker.recordSuccess();
      this.stats.success++;
      return { content: result, retried, fromFallback: false };

    } catch (err) {
      this.breaker.recordFailure();

      if (this.fallback) {
        this.stats.fallback++;
        return this._callFallback(messages, options);
      }

      this.stats.failed++;
      throw err;
    }
  }

  async _callFallback(messages, options) {
    const response = await this.fallback.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      ...options,
    });
    return {
      content: response.choices[0]?.message?.content ?? "",
      retried: false,
      fromFallback: true,
    };
  }

  getStats() {
    return { ...this.stats, circuitState: this.breaker.getState() };
  }

  resetBreaker() {
    this.breaker.reset();
  }
}

module.exports = { ResilientLLMClient };
