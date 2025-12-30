type HonestResult =
  | { ok: true }
  | { ok: false; message: string }

export function validateIngredients(list: string[]): HonestResult {
  if (list.length < 2) {
    return { ok: false, message: "Honest Optimization: add at least 2 ingredients." }
  }

  if (list.length > 3) {
    return { ok: false, message: "Honest Optimization: max 3 ingredients." }
  }

  return { ok: true }
}
