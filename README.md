# ai-retry-wrapper

Production-grade retry logic for LLM API calls. Exponential backoff, jitter, circuit breaker and automatic fallback model — zero external dependencies.

## Features

- Exponential backoff with configurable multiplier
- Random jitter — prevents thundering herd problem
- Smart retry detection — only retries 429, 5xx and network errors
- Circuit breaker — stops hammering a failing API
- Fallback model — switches to backup client when primary fails
- `onRetry` callback for logging and monitoring

## How It Works
```
API Call
   ↓
Fails with retryable error?
   ↓ yes
Wait (exponential backoff + jitter)
   ↓
Retry (up to maxRetries)
   ↓
Still failing?
   ↓
Circuit breaker opens → Fallback model
```

## Usage
```javascript
const { withRetry } = require("./src/retry");

const result = await withRetry(
  async () => {
    const response = await openai.chat.completions.create({ ... });
    return response.choices[0].message.content;
  },
  {
    maxRetries: 3,
    initialDelayMs: 1000,
    backoffMultiplier: 2,
    maxDelayMs: 30000,
    jitter: true,
    onRetry: (err, attempt) => console.log(`Retry ${attempt}: ${err.message}`),
  }
);
```

## Test
```bash
npm install
npm test
```

## Project Structure
```
ai-retry-wrapper/
├── src/
│   ├── retry.js          # withRetry, CircuitBreaker, RetryError
│   └── llm-client.js     # ResilientLLMClient with fallback support
├── tests/
│   └── retry.test.js
├── package.json
└── README.md
```

## Author

**Szymon Wypler** 
