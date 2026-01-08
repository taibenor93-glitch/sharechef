import { describe, expect, it } from "vitest"
import { validateIngredients } from "./honestRules"

describe("validateIngredients", () => {
  it("rejects lists with fewer than 2 items", () => {
    expect(validateIngredients([])).toEqual({
      ok: false,
      message: "Need at least 2 ingredients.",
    })
    expect(validateIngredients(["salt"]).ok).toBe(false)
  })

  it("accepts lists with 2 to 3 items", () => {
    expect(validateIngredients(["egg", "rice"]).ok).toBe(true)
    expect(validateIngredients(["egg", "rice", "soy"]).pantryAddOn).toBeUndefined()
  })

  it("accepts 4 items with pantry add-on", () => {
    expect(validateIngredients(["egg", "rice", "soy", "oil"])).toEqual({
      ok: true,
      pantryAddOn: "oil",
    })
  })

  it("rejects lists with more than 4 items", () => {
    expect(validateIngredients(["egg", "rice", "soy", "oil", "pepper"])).toEqual({
      ok: false,
      message: "Max 3 ingredients plus 1 pantry add-on.",
    })
  })
})
