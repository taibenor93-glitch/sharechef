type HonestResult =
  | { ok: true; pantryAddOn?: string }
  | { ok: false; message: string }

export function validateIngredients(list: string[]): HonestResult {
  if (list.length < 2) {
    return { ok: false, message: "Need at least 2 ingredients." }
  }

  if (list.length > 4) {
    return {
      ok: false,
      message: "Max 3 ingredients plus 1 pantry add-on.",
    }
  }

  if (list.length === 4) {
    return { ok: true, pantryAddOn: list[3] }
  }

  return { ok: true, pantryAddOn: undefined }
}
