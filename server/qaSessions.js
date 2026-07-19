// In-memory session store + rate limiter for the QA text-chat endpoint
// (POST /api/test/chat). Extracted from server.js so the stateful quota,
// LRU eviction, and history-trim logic can be unit-tested with an injected
// clock instead of the real wall clock.

export class QaSessionStore {
  constructor(opts = {}) {
    this.maxSessions = opts.maxSessions ?? 60
    this.dailyLimit = opts.dailyLimit ?? 400
    this.historyLimit = opts.historyLimit ?? 40
    this.maxMessageChars = opts.maxMessageChars ?? 2000
    // Injectable clocks keep day-rollover and eviction deterministic in tests.
    this._now = opts.now ?? (() => Date.now())
    this._today = opts.today ?? (() => new Date().toISOString().slice(0, 10))

    this.sessions = new Map()
    this.messagesToday = 0
    this.countDay = ''
  }

  /**
   * Consume one unit of the daily quota. Resets the counter when the calendar
   * day changes. Returns false when the daily limit is already reached (the
   * caller should respond 429), true otherwise.
   */
  consumeDailyQuota() {
    const day = this._today()
    if (day !== this.countDay) {
      this.countDay = day
      this.messagesToday = 0
    }
    if (this.messagesToday >= this.dailyLimit) return false
    this.messagesToday++
    return true
  }

  /**
   * Fetch a session, creating it if needed. When at capacity, the
   * least-recently-used session is evicted first. Marks the session as just
   * used and returns it.
   */
  getOrCreate(sessionId) {
    if (!this.sessions.has(sessionId)) {
      if (this.sessions.size >= this.maxSessions) {
        const oldest = [...this.sessions.entries()].sort((a, b) => a[1].last - b[1].last)[0]
        if (oldest) this.sessions.delete(oldest[0])
      }
      this.sessions.set(sessionId, { messages: [], last: this._now() })
    }
    const sess = this.sessions.get(sessionId)
    sess.last = this._now()
    return sess
  }

  /** Append a user turn (trimmed + length-capped) and trim history to the cap. */
  pushUser(sess, message) {
    sess.messages.push({ role: 'user', content: message.trim().slice(0, this.maxMessageChars) })
    if (sess.messages.length > this.historyLimit) {
      sess.messages.splice(0, sess.messages.length - this.historyLimit)
    }
  }

  /** Append an assistant turn. */
  pushAssistant(sess, reply) {
    sess.messages.push({ role: 'assistant', content: reply })
  }
}
