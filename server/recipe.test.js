import { describe, it, expect } from 'vitest'
import { normalizeRecipe, toInt } from './recipe.js'

describe('toInt', () => {
  it('parses integer-like values', () => {
    expect(toInt(25)).toBe(25)
    expect(toInt('30')).toBe(30)
    expect(toInt('45 minutes')).toBe(45)
    expect(toInt(12.9)).toBe(12)
  })

  it('returns null for non-numeric values', () => {
    expect(toInt('soon')).toBeNull()
    expect(toInt(undefined)).toBeNull()
    expect(toInt(null)).toBeNull()
    expect(toInt(NaN)).toBeNull()
    expect(toInt({})).toBeNull()
  })
})

describe('normalizeRecipe', () => {
  it('passes through a well-formed recipe', () => {
    const out = normalizeRecipe({
      title: 'Tomato Pasta',
      description: 'A cozy weeknight bowl.',
      ingredients: ['200g pasta', '3 tomatoes'],
      steps: ['Boil the pasta.', 'Make the sauce.'],
      cook_time_minutes: 25,
      servings: 2,
      tags: ['italian', 'quick'],
      tip: 'Salt the water well.',
    })
    expect(out).toEqual({
      title: 'Tomato Pasta',
      description: 'A cozy weeknight bowl.',
      ingredients: ['200g pasta', '3 tomatoes'],
      steps: ['Boil the pasta.', 'Make the sauce.'],
      cook_time_minutes: 25,
      servings: 2,
      tags: ['italian', 'quick'],
      tip: 'Salt the water well.',
    })
  })

  it('fills safe defaults for an empty object', () => {
    expect(normalizeRecipe({})).toEqual({
      title: 'A simple dish',
      description: '',
      ingredients: [],
      steps: [],
      cook_time_minutes: null,
      servings: null,
      tags: [],
      tip: '',
    })
  })

  it('tolerates null / non-object input', () => {
    expect(normalizeRecipe(null).title).toBe('A simple dish')
    expect(normalizeRecipe(undefined).ingredients).toEqual([])
    expect(normalizeRecipe('not an object').steps).toEqual([])
  })

  it('coerces non-string array items to strings', () => {
    const out = normalizeRecipe({ ingredients: [1, 2], steps: [true, null] })
    expect(out.ingredients).toEqual(['1', '2'])
    expect(out.steps).toEqual(['true', 'null'])
  })

  it('drops non-array ingredients/steps/tags to empty arrays', () => {
    const out = normalizeRecipe({ ingredients: 'eggs', steps: 42, tags: {} })
    expect(out.ingredients).toEqual([])
    expect(out.steps).toEqual([])
    expect(out.tags).toEqual([])
  })

  it('caps tags at five', () => {
    const out = normalizeRecipe({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })
    expect(out.tags).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('turns non-finite cook time / servings into null', () => {
    const out = normalizeRecipe({ cook_time_minutes: 'a while', servings: 'a few' })
    expect(out.cook_time_minutes).toBeNull()
    expect(out.servings).toBeNull()
  })
})
