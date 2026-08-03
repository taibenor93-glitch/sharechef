// Language for Micheli's voice and typed recipes. One list, one source of truth.
export const LANGUAGES = [
  'English', 'Spanish', 'French', 'Italian', 'German',
  'Portuguese', 'Hebrew', 'Hindi', 'Mandarin', 'Arabic', 'Japanese',
]

const KEY = 'sharechef_language'

const CODE_MAP: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', it: 'Italian', de: 'German',
  pt: 'Portuguese', he: 'Hebrew', iw: 'Hebrew', hi: 'Hindi', zh: 'Mandarin',
  ar: 'Arabic', ja: 'Japanese',
}

/** The device's own language, mapped to a supported name. */
export function deviceLanguage(): string {
  const code = (navigator.language || 'en').toLowerCase().split('-')[0]
  return CODE_MAP[code] ?? 'English'
}

/** The user's explicit pick on this device, or null if they never picked. */
export function savedLanguage(): string | null {
  try {
    const v = localStorage.getItem(KEY)
    return v && LANGUAGES.includes(v) ? v : null
  } catch {
    return null
  }
}

export function saveLanguage(lang: string): void {
  try {
    localStorage.setItem(KEY, lang)
  } catch {
    /* ignore storage errors */
  }
}

/** What the dropdown shows on load: the pick if one exists, else the device language. */
export function initialLanguage(): string {
  return savedLanguage() ?? deviceLanguage()
}
