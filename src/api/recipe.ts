type CopyMap = Record<string, (items: string[], locale: string) => string>

function baseLang(language?: string): string {
  return (language ?? "en").split(/[-_]/)[0].toLowerCase()
}

function formatIngredients(items: string[], locale: string): string {
  const list = items.filter(Boolean)
  if (!list.length) return ""

  try {
    const formatter = new Intl.ListFormat(locale, { style: "long", type: "conjunction" })
    return formatter.format(list)
  } catch {
    const key = baseLang(locale)
    const conjMap: Record<string, string> = {
      en: "and",
      es: "y",
      fr: "et",
      it: "e",
      pt: "e",
      he: "ו",
    }
    const conj = conjMap[key] ?? "and"
    if (list.length === 1) return list[0]
    if (list.length === 2) return `${list[0]} ${conj} ${list[1]}`
    const head = list.slice(0, -1).join(", ")
    const tail = list[list.length - 1]
    return `${head} ${conj} ${tail}`
  }
}

const recipeCopies: CopyMap = {
  en: (items, locale) => {
    const formatted = formatIngredients(items, locale)
    return `Got it — ${formatted}. I'll start your recipe now.`
  },
  es: (items, locale) => {
    const formatted = formatIngredients(items, locale)
    return `Entendido: ${formatted}. Voy a preparar tu receta ahora.`
  },
  fr: (items, locale) => {
    const formatted = formatIngredients(items, locale)
    return `C'est noté : ${formatted}. Je commence ta recette.`
  },
  it: (items, locale) => {
    const formatted = formatIngredients(items, locale)
    return `Ricevuto: ${formatted}. Inizio la tua ricetta ora.`
  },
  pt: (items, locale) => {
    const formatted = formatIngredients(items, locale)
    return `Entendi: ${formatted}. Vou começar sua receita agora.`
  },
  he: (items, locale) => {
    const formatted = formatIngredients(items, locale)
    return `קיבלתי — ${formatted}. אני מתחיל להכין את המתכון עכשיו.`
  },
}

export async function generateRecipe(ingredients: string[], language = "en") {
  const lang = baseLang(language)
  const render = recipeCopies[lang] ?? recipeCopies.en
  return render(ingredients, language)
}
