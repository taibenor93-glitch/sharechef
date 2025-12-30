import { forwardRef, useImperativeHandle, useMemo, useState } from "react"
import { generateRecipe } from "../api/recipe"
import { validateIngredients } from "../lib/honestRules"
import { speak } from "../voice/tts"

export type HomePageHandle = {
  setIngredientsFromVoice: (items: string[]) => void
  optimizeWithList: (items: string[]) => Promise<void>
}

export const HomePage = forwardRef<HomePageHandle>(function HomePage(_props, ref) {
  const [ingredients, setIngredients] = useState({ one: "", two: "", three: "" })
  const [result, setResult] = useState("")

  const maxIngredients = 3

  const list = useMemo(() => {
    return [ingredients.one, ingredients.two, ingredients.three]
      .flatMap((s) => s.split(/[,\n]+/))
      .map((s) => s.trim())
      .filter(Boolean)
  }, [ingredients])

  function updateIngredient(
    key: "one" | "two" | "three",
    value: string
  ) {
    const nextIngredients = { ...ingredients, [key]: value }
    const nextList = [nextIngredients.one, nextIngredients.two, nextIngredients.three]
      .flatMap((s) => s.split(/[,\n]+/))
      .map((s) => s.trim())
      .filter(Boolean)

    if (nextList.length > maxIngredients) {
      setResult("Honest Optimization: max 3 ingredients.")
      return
    }

    setIngredients(nextIngredients)
  }

  async function optimize(listOverride?: string[]): Promise<string | undefined> {
    const runList = listOverride ?? list
    const v = validateIngredients(runList)
    if (!v.ok) {
      setResult(v.message)
      return v.message
    }

    const recipe = await generateRecipe(runList)
    setResult(recipe)
    return recipe
  }

  async function optimizeAndSpeak(listOverride?: string[]) {
    const resultText = await optimize(listOverride)
    if (!resultText) return

    const synth = (window as any).speechSynthesis
    synth?.cancel?.()
    const text = resultText
    console.log("SPEAKING:", text)
    speak(text)
  }

  useImperativeHandle(
    ref,
    () => ({
      setIngredientsFromVoice: (items: string[]) => {
        const [one = "", two = "", three = ""] = items
        setIngredients({ one, two, three })
      },
      optimizeWithList: (items: string[]) => optimizeAndSpeak(items),
    }),
    [optimizeAndSpeak]
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

      <button
        onClick={() => {
          void optimizeAndSpeak()
        }}
      >
        Optimize
      </button>

      {result && <pre>{result}</pre>}
    </main>
  )
})
