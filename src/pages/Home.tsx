import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { generateRecipe } from "../api/recipe"
import { validateIngredients } from "../lib/honestRules"
import { speak } from "../voice/tts"

export type HomePageHandle = {
  setIngredientsFromVoice: (items: string[]) => void
  optimizeWithList: (items: string[]) => Promise<void>
}

type ChatMessage = {
  role: "user" | "assistant"
  text: string
}

type SharePlatform = "facebook" | "instagram" | "tiktok"

export const HomePage = forwardRef<HomePageHandle>(function HomePage(_props, ref) {
  const [ingredients, setIngredients] = useState({ one: "", two: "", three: "" })
  const [result, setResult] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState("")
  const hasGreeted = useRef(false)
  const [lastIngredients, setLastIngredients] = useState<string[]>([])

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
    const text = `${title}\nIngredients: ${ingredientsSummary}\nMade with ShareChef / Yummi Guide`
    return { title, text }
  }

  async function shareRecipe(
    platform: SharePlatform,
    recipeText: string,
    lastList: string[],
    fallbackList: string[]
  ) {
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
    } else {
      try {
        await nav?.clipboard?.writeText?.(sharePayload.text)
        console.log(`Copied share text for ${platform}`)
      } catch {
        console.log(`Share text for ${platform}: ${sharePayload.text}`)
      }
    }
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

  function updateIngredient(
    key: "one" | "two" | "three",
    value: string
  ) {
    const nextIngredients = { ...ingredients, [key]: value }
    const nextList = normalizeList([nextIngredients.one, nextIngredients.two, nextIngredients.three])

    if (nextList.length > maxIngredients) {
      setResult("Honest Optimization: max 3 ingredients plus 1 pantry add-on.")
      return
    }

    setIngredients(nextIngredients)
  }

  function addMessage(role: ChatMessage["role"], text: string) {
    setMessages((prev) => [...prev, { role, text }])
  }

  useEffect(() => {
    if (hasGreeted.current) return
    hasGreeted.current = true
    void speak("Hi — what do you have in your kitchen today?")
  }, [])

  async function speakInOrder(reply: string) {
    const synth = (window as any).speechSynthesis
    synth?.cancel?.()
    const ack = "Got it."
    console.log("SPEAKING:", ack)
    await speak(ack)

    console.log("SPEAKING:", reply)
    await speak(reply)
  }

  async function runAssistant(listOverride?: string[], rawUserText?: string) {
    const runList = normalizeList(listOverride ?? list)
    const userText = rawUserText ?? runList.join(", ")
    if (userText) {
      addMessage("user", userText)
    }

    const validation = validateIngredients(runList)
    if (!validation.ok) {
      setResult(validation.message)
      addMessage("assistant", validation.message)
      await speakInOrder(validation.message)
      return
    }

    const recipe = await generateRecipe(runList)
    const pantryNote = validation.pantryAddOn
      ? `Adding pantry add-on: ${validation.pantryAddOn}.`
      : ""
    const reply = pantryNote ? `${pantryNote}\n\n${recipe}` : recipe

    setResult(reply)
    addMessage("assistant", reply)
    setLastIngredients(runList)
    await speakInOrder(reply)
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

  return (
    <main style={{ padding: 40, maxWidth: 900, margin: "0 auto" }}>
      <h1>ShareChef</h1>

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
          </div>
        </div>
      )}
    </main>
  )
})
