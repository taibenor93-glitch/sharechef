import { describe, it, expect } from 'vitest'
import { getStarProgress, STAR_TIERS } from './stars'

describe('getStarProgress', () => {
  it('starts at Commis for a brand-new cook', () => {
    const p = getStarProgress(0)
    expect(p.tier.name).toBe('Commis')
    expect(p.next?.name).toBe('Cook')
    expect(p.count).toBe(0)
    expect(p.toNext).toBe(3)
    expect(p.progress).toBe(0)
  })

  // Each tier edge: one below stays in the lower tier, exactly-at promotes.
  it.each([
    [2, 'Commis'],
    [3, 'Cook'],
    [6, 'Cook'],
    [7, 'Chef de Partie'],
    [14, 'Chef de Partie'],
    [15, 'Sous Chef'],
    [29, 'Sous Chef'],
    [30, 'Micheli Chef'],
  ])('count %i is in tier %s', (count, name) => {
    expect(getStarProgress(count).tier.name).toBe(name)
  })

  it('reports the correct distance to the next tier', () => {
    expect(getStarProgress(5).toNext).toBe(2) // 7 - 5
    expect(getStarProgress(10).toNext).toBe(5) // 15 - 10
  })

  it('keeps progress within 0..1 mid-tier', () => {
    for (let c = 0; c <= 40; c++) {
      const { progress } = getStarProgress(c)
      expect(progress).toBeGreaterThanOrEqual(0)
      expect(progress).toBeLessThanOrEqual(1)
    }
  })

  it('caps out at the top tier with no next', () => {
    const p = getStarProgress(500)
    expect(p.tier.name).toBe('Micheli Chef')
    expect(p.next).toBeNull()
    expect(p.toNext).toBe(0)
    expect(p.progress).toBe(1)
  })

  it('clamps negative, fractional, and invalid counts', () => {
    expect(getStarProgress(-5).tier.name).toBe('Commis')
    expect(getStarProgress(-5).count).toBe(0)
    expect(getStarProgress(3.9).tier.name).toBe('Cook') // floored to 3
    expect(getStarProgress(NaN).tier.name).toBe('Commis')
    // @ts-expect-error exercising the runtime guard against bad input
    expect(getStarProgress(undefined).tier.name).toBe('Commis')
  })

  it('exposes five ascending tiers', () => {
    expect(STAR_TIERS).toHaveLength(5)
    for (let i = 1; i < STAR_TIERS.length; i++) {
      expect(STAR_TIERS[i].min).toBeGreaterThan(STAR_TIERS[i - 1].min)
    }
  })
})
