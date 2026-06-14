import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { generateRecipe } from "../api/recipe"
import { validateIngredients } from "../lib/honestRules"
import { RealtimeVoice, type VoiceStatus } from "../voice/realtimeVoice"

export type HomePageHandle = {
  setIngredientsFromVoice: (items: string[]) => void
  optimizeWithList: (items: string[]) => Promise<void>
}

type ChatMessage = {
  role: "user" | "assistant"
  text: string
}

type SharePlatform = "facebook" | "instagram" | "tiktok" | "youtube"
const supportedLanguages = ["en", "es", "fr", "it", "pt"] as const
type SupportedLanguage = (typeof supportedLanguages)[number] | string | string

const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle:        'Tap to talk to Micheli',
  connecting:  'Connecting…',
  ready:       'Tap to speak',
  listening:   '● Listening…',
  processing:  '◌ Thinking…',
  speaking:    '♪ Micheli is speaking',
}

const ORB_COLOR: Record<VoiceStatus, string> = {
  idle:        '#2C1A0E',
  connecting:  '#2C1A0E',
  ready:       '#2C1A0E',
  listening:   '#C4593A',
  processing:  '#2C1A0E',
  speaking:    '#2A2010',
}

export const HomePage = forwardRef<HomePageHandle>(function HomePage(_props, ref) {
  const [ingredients, setIngredients] = useState({ one: "", two: "", three: "" })
  const [result, setResult] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState("")
  const [lastIngredients, setLastIngredients] = useState<string[]>([])
  const [micheliStarLevel, setMicheliStarLevel] = useState(0)
  const [userLanguage, setUserLanguage] = useState<string>("en")
  const [customLanguage, setCustomLanguage] = useState("")

  // ── Realtime voice ────────────────────────────────────────────────────────
  const voiceRef    = useRef<RealtimeVoice | null>(null)
  const firstTap    = useRef(true)
  const [voiceStatus,    setVoiceStatus]    = useState<VoiceStatus>('idle')
  const [voiceLines,     setVoiceLines]     = useState<Array<{ role: 'user' | 'chef'; text: string }>>([])
  const [voiceError,     setVoiceError]     = useState('')
  const [voiceActive,    setVoiceActive]    = useState(false)

  const maxIngredients = 4

  function buildSharePayload(
    recipeText: string,
    ingredientList: string[]
  ): { title: string; text: string } {
    const title =
      recipeText
        .split("\n")
        .map((s) => s.trim())
        .find(Boolean) || "ShareChef Recipe"
    const ingredientsSummary = ingredientList.slice(0, 3).join(", ")
    const text = `${title}\nIngredients: ${ingredientsSummary}\nMade with ShareChef / Micheli`
    return { title, text }
  }

  async function shareRecipe(
    platform: SharePlatform,
    recipeText: string,
    lastList: string[],
    fallbackList: string[]
  ) {
    incrementMetric("recipe_share_count")

    const nav: any = typeof navigator !== "undefined" ? navigator : undefined
    const ingredientsForShare = lastList.length ? lastList : fallbackList
    const sharePayload = buildSharePayload(recipeText, ingredientsForShare)

    if (nav?.share) {
      try {
        await nav.share({ title: sharePayload.title, text: sharePayload.text })
        return
      } catch (err) {
        console.warn("Native share failed, falling back.", err)
      }
    }

    const encoded = encodeURIComponent(sharePayload.text)
    if (platform === "facebook") {
      window.open(`https://www.facebook.com/sharer/sharer.php?quote=${encoded}`, "_blank")
    } else if (platform === "youtube") {
      window.open("https://www.youtube.com/upload", "_blank")
    } else {
      try {
        await nav?.clipboard?.writeText?.(sharePayload.text)
        console.log(`Copied share text for ${platform}`)
      } catch {
        console.log(`Share text for ${platform}: ${sharePayload.text}`)
      }
    }
  }

  function incrementCookedCount(): { level: number; leveledUp: boolean } {
    try {
      const storage = typeof window !== "undefined" ? window.localStorage : undefined
      const current = Number.parseInt(storage?.getItem?.("recipe_cooked_count") ?? "0", 10)
      const currentLevel = Number.parseInt(storage?.getItem?.("micheli_star_level") ?? "0", 10)
      const next = Number.isFinite(current) ? current + 1 : 1
      storage?.setItem?.("recipe_cooked_count", String(next))
      const level = next >= 100 ? 3 : next >= 50 ? 2 : next >= 20 ? 1 : 0
      if (level > 0) {
        storage?.setItem?.("micheli_star_unlocked", "true")
      }
      storage?.setItem?.("micheli_star_level", String(level))
      const leveledUp = Number.isFinite(currentLevel) ? level > currentLevel : level > 0
      setMicheliStarLevel(level)
      return { level, leveledUp }
    } catch (err) {
      console.warn("Could not persist recipe_cooked_count", err)
    }
    return { level: 0, leveledUp: false }
  }

  function normalizeList(items: string[]): string[] {
    return items
      .flatMap((s) => s.split(/[,\n]+/))
      .map((s) => s.trim())
      .filter(Boolean)
  }

  const list = useMemo(() => {
    return normalizeList([ingredients.one, ingredients.two, ingredients.three])
  }, [ingredients])

  const localeNameMap: Record<string, string> = {
    hebrew: "he",
    עברית: "he",
    arabic: "ar",
    ar: "ar",
    hindi: "hi",
    japanese: "ja",
    chinese: "zh-CN",
    中文: "zh-CN",
    mandarin: "zh-CN",
    spanish: "es",
    español: "es",
    french: "fr",
    français: "fr",
    italian: "it",
    italiano: "it",
    portuguese: "pt",
    português: "pt",
    german: "de",
    deutsch: "de",
    korean: "ko",
    russian: "ru",
    turkish: "tr",
    dutch: "nl",
    swedish: "sv",
    norwegian: "no",
    finnish: "fi",
    danish: "da",
  }

  function baseLang(language?: string): string {
    return (language ?? "en").split(/[-_]/)[0].toLowerCase()
  }

  const micheliStarLabel =
    micheliStarLevel <= 0
      ? "Micheli Star: Locked"
      : `Micheli Star: ${"⭐".repeat(Math.min(micheliStarLevel, 3))}`

  const copyByLang: Record<
    string,
    { greeting: string; ack: string; celebration: string }
  > = {
    en: {
      greeting: "Tell me what you've got and I'll cook up a recipe.",
      ack: "Got it.",
      celebration: "Nice work — you earned a Micheli Star.",
    },
    es: {
      greeting: "Cuéntame qué tienes y preparo una receta.",
      ack: "Entendido.",
      celebration: "Buen trabajo: ganaste una Micheli Star.",
    },
    fr: {
      greeting: "Dis-moi ce que tu as et je prépare une recette.",
      ack: "C'est noté.",
      celebration: "Bravo — tu as gagné une Micheli Star.",
    },
    it: {
      greeting: "Dimmi cosa hai e preparo una ricetta.",
      ack: "Ricevuto.",
      celebration: "Ottimo lavoro: hai guadagnato una Micheli Star.",
    },
    pt: {
      greeting: "Me conta o que você tem e eu preparo uma receita.",
      ack: "Entendi.",
      celebration: "Bom trabalho — você ganhou uma Micheli Star.",
    },
    he: {
      greeting: "תגיד לי מה יש לך ואני אכין לך מתכון.",
      ack: "קיבלתי.",
      celebration: "עבודה יפה — הרווחת Micheli Star.",
    },
  }

  function getCopy(language: string) {
    const key = baseLang(language)
    return copyByLang[key] ?? copyByLang.en
  }

  function translateValidation(text: string, language: string): string {
    const key = baseLang(language)
    if (key === "he") {
      if (text.startsWith("Need at least 2 ingredients")) {
        return "צריך לפחות שני מרכיבים למתכון."
      }
      if (text.startsWith("Max 3 ingredients plus 1 pantry add-on")) {
        return "אפשר עד שלושה מרכיבים ועוד אחד מהמזווה."
      }
    }
    return text
  }

  function translatePantryNote(addOn: string | undefined, language: string): string {
    if (!addOn) return ""
    const key = baseLang(language)
    if (key === "he") {
      return `תוספת מהמזווה: ${addOn}.`
    }
    return `Adding pantry add-on: ${addOn}.`
  }

  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("user_language", userLanguage)
      }
    } catch {
      /* ignore */
    }
  }, [userLanguage])

  function incrementMetric(key: string) {
    try {
      const storage = typeof window !== "undefined" ? window.localStorage : undefined
      const current = Number.parseInt(storage?.getItem?.(key) ?? "0", 10)
      const next = Number.isFinite(current) ? current + 1 : 1
      storage?.setItem?.(key, String(next))
    } catch (err) {
      console.warn(`Could not persist metric ${key}`, err)
    }
  }

  function updateIngredient(
    key: "one" | "two" | "three",
    value: string
  ) {
    const nextIngredients = { ...ingredients, [key]: value }
    const nextList = normalizeList([nextIngredients.one, nextIngredients.two, nextIngredients.three])

    if (nextList.length > maxIngredients) {
      const msg = "Max 3 ingredients plus 1 pantry add-on."
      setResult(translateValidation(msg, userLanguage))
      return
    }

    setIngredients(nextIngredients)
  }

  function addMessage(role: ChatMessage["role"], text: string) {
    setMessages((prev) => [...prev, { role, text }])
  }

  useEffect(() => {
    try {
      const storedLevel =
        typeof window !== "undefined"
          ? Number.parseInt(window.localStorage.getItem("micheli_star_level") ?? "0", 10)
          : 0
      if (Number.isFinite(storedLevel)) {
        setMicheliStarLevel(storedLevel)
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    try {
      const storedLanguage =
        typeof window !== "undefined" ? window.localStorage.getItem("user_language") : null
      const normalized = storedLanguage || "en"
      setUserLanguage(normalized)
      if (normalized && !(supportedLanguages as readonly string[]).includes(normalized)) {
        setCustomLanguage(normalized)
      }
    } catch {
      setUserLanguage("en")
    }
  }, [])

  async function runAssistant(listOverride?: string[], rawUserText?: string) {
    const runList = normalizeList(listOverride ?? list)
    const userText = rawUserText ?? runList.join(", ")
    if (userText) {
      addMessage("user", userText)
    }

    const validation = validateIngredients(runList)
    if (!validation.ok) {
      const translated = translateValidation(validation.message, userLanguage)
      setResult(translated)
      addMessage("assistant", translated)
      return
    }

    const recipe = await generateRecipe(runList, userLanguage)
    const pantryNote = translatePantryNote(validation.pantryAddOn, userLanguage)
    const reply = pantryNote ? `${pantryNote}\n\n${recipe}` : recipe

    setResult(reply)
    addMessage("assistant", reply)
    setLastIngredients(runList)
    const progress = incrementCookedCount()
    incrementMetric("recipe_view_count")

    if (progress.leveledUp) {
      const celebration = getCopy(userLanguage).celebration
      addMessage("assistant", celebration)
    }
  }

  function handleSendChat() {
    const parsedList = normalizeList([chatInput])
    if (!parsedList.length) return

    void runAssistant(parsedList, chatInput)
    setChatInput("")
  }

  useImperativeHandle(
    ref,
    () => ({
      setIngredientsFromVoice: (items: string[]) => {
        const [one = "", two = "", three = ""] = items
        setIngredients({ one, two, three })
      },
      optimizeWithList: (items: string[]) => runAssistant(items, items.join(", ")),
    }),
    [runAssistant]
  )

  // ── Voice orb handler ────────────────────────────────────────────────────
  async function handleOrbClick() {
    setVoiceError('')

    if (!voiceRef.current) {
      voiceRef.current = new RealtimeVoice({
        onStatus: (s) => setVoiceStatus(s),
        onTranscript: (text, role) =>
          setVoiceLines((prev) => [...prev.slice(-19), { role, text }]),
        onError: (msg) => setVoiceError(msg),
      })
    }

    const voice = voiceRef.current

    // iOS: AudioContext must be created + resumed inside a user gesture
    await voice.unlockAudio()

    if (!voiceActive) {
      setVoiceActive(true)
      voice.connect()
      // Greeting is triggered by the server on WS open; wait for ready then listen
      return
    }

    if (voiceStatus === 'speaking')   { voice.stopAudio(); return }
    if (voiceStatus === 'listening')  { voice.stopListening(); return }
    if (voiceStatus === 'processing' || voiceStatus === 'connecting') return

    if (voiceStatus === 'ready') {
      if (firstTap.current) {
        firstTap.current = false
        voice.triggerGreeting()
      } else {
        void voice.startListening()
      }
    }
  }

  function handleOrbDisconnect() {
    voiceRef.current?.disconnect()
    voiceRef.current = null
    setVoiceActive(false)
    setVoiceStatus('idle')
    setVoiceLines([])
    firstTap.current = true
  }

  return (
    <main style={{ padding: 40, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0 }}>ShareChef</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 12, color: "#5c677d" }}>{micheliStarLabel}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5c677d" }}>
            <span>Language</span>
            <select
              value={(supportedLanguages as readonly string[]).includes(userLanguage) ? userLanguage : "__custom"}
              onChange={(e) => {
                const next = e.target.value as SupportedLanguage | "__custom"
                if (next === "__custom") {
                  setUserLanguage("__custom")
                  return
                }
                setUserLanguage(next)
                setCustomLanguage("")
                try {
                  window.localStorage.setItem("user_language", next)
                } catch {
                  /* ignore */
                }
              }}
              style={{ fontSize: 12, padding: "4px 6px" }}
            >
              <option value="en">English (EN)</option>
              <option value="es">Español (ES)</option>
              <option value="fr">Français (FR)</option>
              <option value="it">Italiano (IT)</option>
              <option value="pt">Português (PT)</option>
              <option value="__custom">More languages…</option>
            </select>
            {(!(supportedLanguages as readonly string[]).includes(userLanguage) || userLanguage === "__custom") && (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  placeholder="e.g., hi-IN or zh-CN"
                  value={customLanguage}
                  onChange={(e) => setCustomLanguage(e.target.value)}
                  style={{ fontSize: 12, padding: "4px 6px", width: 140 }}
                />
                <button
                  onClick={() => {
                    const raw = customLanguage.trim()
                    if (!raw) return
                    const lower = raw.toLowerCase()
                    const mapped = localeNameMap[lower] ?? raw
                    const normalized = mapped.trim()
                    const isValid = /^[a-z]{2,3}(-[a-zA-Z]{2})?$/.test(normalized)
                    if (!isValid) return
                    setUserLanguage(normalized)
                    try {
                      window.localStorage.setItem("user_language", normalized)
                    } catch {
                      /* ignore */
                    }
                  }}
                  style={{ fontSize: 12, padding: "4px 8px" }}
                >
                  Set
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Micheli voice orb ─────────────────────────────────────────────── */}
      <section style={{ margin: '32px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* ripple rings */}
          {(voiceStatus === 'listening' || voiceStatus === 'speaking') && (
            <>
              <div style={{ position: 'absolute', borderRadius: '50%', border: `1.5px solid ${voiceStatus === 'speaking' ? '#E8B84B' : '#C4593A'}`, width: 140, height: 140, animation: 'ripple 2s 0s ease-out infinite', opacity: 0 }} />
              <div style={{ position: 'absolute', borderRadius: '50%', border: `1.5px solid ${voiceStatus === 'speaking' ? '#E8B84B' : '#C4593A'}`, width: 180, height: 180, animation: 'ripple 2s 0.5s ease-out infinite', opacity: 0 }} />
            </>
          )}
          <button
            onClick={handleOrbClick}
            aria-label={STATUS_LABEL[voiceStatus]}
            style={{
              width: 100, height: 100, borderRadius: '50%',
              background: ORB_COLOR[voiceStatus],
              border: `1.5px solid ${voiceStatus === 'speaking' ? '#E8B84B' : voiceStatus === 'listening' ? '#C4593A' : 'rgba(196,89,58,0.4)'}`,
              cursor: voiceStatus === 'processing' || voiceStatus === 'connecting' ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: voiceStatus === 'listening'
                ? '0 0 40px rgba(196,89,58,0.4), 0 16px 40px rgba(0,0,0,0.3)'
                : voiceStatus === 'speaking'
                ? '0 0 40px rgba(232,184,75,0.3), 0 16px 40px rgba(0,0,0,0.3)'
                : '0 16px 40px rgba(0,0,0,0.2)',
              transition: 'all 0.3s ease',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {voiceStatus === 'speaking' ? (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                {[2,5,9,13,17,20,23].map((x, i) => (
                  <rect key={i} x={x} y="4" width="2" height="16" rx="1" fill="#E8B84B"
                    style={{ animation: `wavebar 0.8s ${i * 0.1}s ease-in-out infinite`, transformOrigin: 'center' }} />
                ))}
              </svg>
            ) : (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={voiceStatus === 'listening' ? 'white' : '#C4593A'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8"  y1="23" x2="16" y2="23"/>
              </svg>
            )}
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: voiceStatus === 'listening' ? '#C4593A' : voiceStatus === 'speaking' ? '#E8B84B' : '#888', fontFamily: 'monospace' }}>
          {STATUS_LABEL[voiceStatus]}
        </p>

        {voiceError && (
          <p style={{ margin: 0, fontSize: 12, color: '#C4593A', textAlign: 'center', maxWidth: 320 }}>{voiceError}</p>
        )}

        {voiceLines.length > 0 && (
          <div style={{ width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
            {voiceLines.map((line, i) => (
              <div key={i} style={{
                fontSize: 13, lineHeight: 1.5, padding: '4px 0 4px 10px',
                borderLeft: `2px solid ${line.role === 'chef' ? '#E8B84B' : '#C4593A'}`,
                color: line.role === 'chef' ? 'rgba(30,20,8,0.75)' : 'rgba(30,20,8,0.5)',
                fontStyle: line.role === 'chef' ? 'italic' : 'normal',
              }}>
                {line.role === 'chef' ? `Micheli: ${line.text}` : `You: ${line.text}`}
              </div>
            ))}
          </div>
        )}

        {voiceActive && (
          <button onClick={handleOrbDisconnect} style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontFamily: 'monospace' }}>
            End session
          </button>
        )}
      </section>

      <style>{`
        @keyframes ripple { 0% { transform: scale(0.9); opacity: 0.6; } 100% { transform: scale(1.2); opacity: 0; } }
        @keyframes wavebar { 0%, 100% { transform: scaleY(0.4); } 50% { transform: scaleY(1); } }
      `}</style>

      <hr style={{ border: 'none', borderTop: '1px solid #e6e8ef', margin: '8px 0 24px' }} />

      <input
        placeholder="Ingredient 1"
        value={ingredients.one}
        onChange={(e) =>
          updateIngredient("one", e.target.value)
        }
      />
      <input
        placeholder="Ingredient 2"
        value={ingredients.two}
        onChange={(e) =>
          updateIngredient("two", e.target.value)
        }
      />
      <input
        placeholder="Ingredient 3"
        value={ingredients.three}
        onChange={(e) =>
          updateIngredient("three", e.target.value)
        }
      />

      <div style={{ marginTop: 16 }}>
        <button
          onClick={() => {
            void runAssistant()
          }}
        >
          Optimize
        </button>
      </div>

      <section style={{ marginTop: 24, padding: 12, border: "1px solid #ddd" }}>
        <h2>Conversation</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {messages.map((msg, idx) => (
            <div key={`${msg.role}-${idx}`}>
              <strong>{msg.role === "user" ? "You" : "Assistant"}:</strong> {msg.text}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            placeholder="Type ingredients, e.g., eggs, rice"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            style={{ flex: 1 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleSendChat()
              }
            }}
          />
          <button onClick={handleSendChat}>Send</button>
        </div>
      </section>

      {result && (
        <div style={{ marginTop: 16 }}>
          <pre>{result}</pre>
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => {
                void shareRecipe("facebook", result, lastIngredients, list)
              }}
            >
              Share to Facebook
            </button>
            <button
              onClick={() => {
                void shareRecipe("instagram", result, lastIngredients, list)
              }}
            >
              Share to Instagram
            </button>
            <button
              onClick={() => {
                void shareRecipe("tiktok", result, lastIngredients, list)
              }}
            >
              Share to TikTok
            </button>
            <button
              onClick={() => {
                void shareRecipe("youtube", result, lastIngredients, list)
              }}
            >
              Share to YouTube
            </button>
          </div>
        </div>
      )}
    </main>
  )
})
