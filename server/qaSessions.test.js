import { describe, it, expect } from 'vitest'
import { QaSessionStore } from './qaSessions.js'

describe('QaSessionStore — daily quota', () => {
  it('allows messages up to the limit, then blocks', () => {
    const qa = new QaSessionStore({ dailyLimit: 3, today: () => '2026-07-19' })
    expect(qa.consumeDailyQuota()).toBe(true)
    expect(qa.consumeDailyQuota()).toBe(true)
    expect(qa.consumeDailyQuota()).toBe(true)
    expect(qa.consumeDailyQuota()).toBe(false)
    expect(qa.consumeDailyQuota()).toBe(false)
  })

  it('resets the counter when the day rolls over', () => {
    let day = '2026-07-19'
    const qa = new QaSessionStore({ dailyLimit: 1, today: () => day })
    expect(qa.consumeDailyQuota()).toBe(true)
    expect(qa.consumeDailyQuota()).toBe(false)
    day = '2026-07-20'
    expect(qa.consumeDailyQuota()).toBe(true) // fresh day, fresh quota
  })

  it('defaults to a 400/day limit', () => {
    const qa = new QaSessionStore({ today: () => 'd' })
    for (let i = 0; i < 400; i++) expect(qa.consumeDailyQuota()).toBe(true)
    expect(qa.consumeDailyQuota()).toBe(false)
  })
})

describe('QaSessionStore — sessions', () => {
  it('creates a session on first use and reuses it after', () => {
    const qa = new QaSessionStore({ now: () => 1 })
    const a = qa.getOrCreate('s1')
    const b = qa.getOrCreate('s1')
    expect(a).toBe(b)
    expect(qa.sessions.size).toBe(1)
  })

  it('evicts the least-recently-used session at capacity', () => {
    let clock = 0
    const qa = new QaSessionStore({ maxSessions: 2, now: () => ++clock })
    qa.getOrCreate('old') // last = 1
    qa.getOrCreate('mid') // last = 2
    qa.getOrCreate('old') // touch -> last = 3, now 'mid' is the LRU
    qa.getOrCreate('new') // capacity hit -> evict 'mid'
    expect(qa.sessions.has('mid')).toBe(false)
    expect(qa.sessions.has('old')).toBe(true)
    expect(qa.sessions.has('new')).toBe(true)
    expect(qa.sessions.size).toBe(2)
  })

  it('updates last-used timestamp on every access', () => {
    let clock = 10
    const qa = new QaSessionStore({ now: () => clock })
    qa.getOrCreate('s1')
    clock = 99
    const sess = qa.getOrCreate('s1')
    expect(sess.last).toBe(99)
  })
})

describe('QaSessionStore — history', () => {
  it('trims and length-caps user messages', () => {
    const qa = new QaSessionStore({ maxMessageChars: 5, now: () => 1 })
    const sess = qa.getOrCreate('s1')
    qa.pushUser(sess, '  hello world  ')
    expect(sess.messages[0]).toEqual({ role: 'user', content: 'hello' })
  })

  it('keeps only the most recent messages up to the history limit', () => {
    const qa = new QaSessionStore({ historyLimit: 4, now: () => 1 })
    const sess = qa.getOrCreate('s1')
    for (let i = 0; i < 10; i++) qa.pushUser(sess, `m${i}`)
    expect(sess.messages).toHaveLength(4)
    expect(sess.messages.map((m) => m.content)).toEqual(['m6', 'm7', 'm8', 'm9'])
  })

  it('appends assistant replies without trimming them away immediately', () => {
    const qa = new QaSessionStore({ now: () => 1 })
    const sess = qa.getOrCreate('s1')
    qa.pushUser(sess, 'hi')
    qa.pushAssistant(sess, 'hello there')
    expect(sess.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello there' },
    ])
  })
})
