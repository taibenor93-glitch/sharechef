// Micheli Star — gamification tiers based on saved-recipe count.
export interface StarTier {
  index: number
  name: string
  min: number
  blurb: string
}

export const STAR_TIERS: StarTier[] = [
  { index: 0, name: 'Commis', min: 0, blurb: 'Just getting started in the kitchen.' },
  { index: 1, name: 'Cook', min: 3, blurb: 'Finding your rhythm.' },
  { index: 2, name: 'Chef de Partie', min: 7, blurb: 'Owning your station.' },
  { index: 3, name: 'Sous Chef', min: 15, blurb: 'Running the pass.' },
  { index: 4, name: 'Micheli Chef', min: 30, blurb: 'A star is earned.' },
]

export interface StarProgress {
  tier: StarTier
  next: StarTier | null
  count: number
  toNext: number
  progress: number // 0..1 toward the next tier
}

export function getStarProgress(count: number): StarProgress {
  const c = Math.max(0, Math.floor(count || 0))
  let tier = STAR_TIERS[0]
  for (const t of STAR_TIERS) if (c >= t.min) tier = t
  const next = STAR_TIERS[tier.index + 1] ?? null
  const toNext = next ? Math.max(0, next.min - c) : 0
  const progress = next ? Math.min(1, (c - tier.min) / (next.min - tier.min)) : 1
  return { tier, next, count: c, toNext, progress }
}
