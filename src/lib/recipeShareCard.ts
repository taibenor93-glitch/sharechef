// Drawing for the share video: the recipe panel, the ShareChef end frame, and
// the logo and QR code both use. Threads, Instagram and Facebook drop the text
// from a share, so whatever is not drawn into the video never arrives there.
import QRCode from 'qrcode'
import type { Recipe } from '../types/recipe'
import { APP_STORE_LINK } from './recipeShareText'

export type ShareableRecipe = Pick<Recipe, 'title' | 'description' | 'ingredients' | 'steps' | 'nutrition'>

const W = 1080
const PAD = 72
const MAX_H = 9000 // iOS caps canvas area (~16.7M px); 1080 x 9000 stays well inside
export const PLUM = '#2D0826'
const INK = '#f6efe4'
const SOFT = '#d6c5d0'
const GOLD = '#d8ab5c'
const SERIF = "Fraunces, Georgia, 'Times New Roman', serif"
const SANS = "-apple-system, 'Helvetica Neue', Inter, Arial, sans-serif"
// The App Store link as people read it, without the https:// part.
const APP_STORE_LABEL = APP_STORE_LINK.replace(/^https?:\/\//, '')

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`could not load ${src}`))
    img.src = src
  })
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (ctx.measureText(next).width <= maxWidth || !line) line = next
      else { out.push(line); line = word }
    }
    out.push(line)
  }
  return out
}

// Logo and QR code to the App Store page.
export type BrandAssets = { logo: HTMLImageElement | null; qr: HTMLImageElement }

export async function loadBrandAssets(): Promise<BrandAssets> {
  const [logo, qr] = await Promise.all([
    loadImage('/sharechef-logo.png').catch(() => null), // the video still works without the logo
    QRCode.toDataURL(APP_STORE_LINK, { margin: 0, width: 400, color: { dark: PLUM, light: '#ffffff' } }).then(loadImage),
  ])
  return { logo, qr }
}

// Lays the recipe out top to bottom. With draw=false it only measures, so the
// canvas can be sized to fit before the real pass. Returns the total height.
function layout(ctx: CanvasRenderingContext2D, r: ShareableRecipe, k: number, draw: boolean): number {
  const textW = W - PAD * 2
  let y = PAD

  const block = (text: string, font: string, color: string, size: number, gapAfter: number, indent = 0, prefix = '') => {
    ctx.font = font
    const lh = Math.round(size * 1.32)
    const lines = wrap(ctx, text, textW - indent)
    lines.forEach((line, i) => {
      if (draw) {
        ctx.fillStyle = color
        if (prefix && i === 0) { ctx.fillStyle = GOLD; ctx.fillText(prefix, PAD, y + size); ctx.fillStyle = color }
        ctx.fillText(line, PAD + indent, y + size)
      }
      y += lh
    })
    y += gapAfter
  }
  const heading = (text: string) => {
    const size = Math.round(40 * k)
    block(text, `600 ${size}px ${SERIF}`, GOLD, size, Math.round(14 * k))
  }

  const titleSize = Math.round(68 * k)
  block(r.title, `600 ${titleSize}px ${SERIF}`, INK, titleSize, Math.round(12 * k))
  if (r.description) {
    const s = Math.round(34 * k)
    block(r.description, `italic ${s}px ${SERIF}`, SOFT, s, Math.round(10 * k))
  }
  const by = Math.round(28 * k)
  block('From my cook with Micheli', `500 ${by}px ${SANS}`, GOLD, by, Math.round(44 * k))

  const body = Math.round(34 * k)
  const ingredients = Array.isArray(r.ingredients) ? r.ingredients : []
  const steps = Array.isArray(r.steps) ? r.steps : []
  if (ingredients.length) {
    heading('Ingredients')
    ingredients.forEach((i) => block(i, `${body}px ${SANS}`, INK, body, Math.round(8 * k), Math.round(40 * k), '•'))
    y += Math.round(36 * k)
  }
  if (steps.length) {
    heading('Steps')
    steps.forEach((s, i) => block(s, `${body}px ${SANS}`, INK, body, Math.round(14 * k), Math.round(56 * k), `${i + 1}.`))
    y += Math.round(22 * k)
  }
  if (r.nutrition) {
    const s = Math.round(30 * k)
    block(`🥗 Nutrition (per serving, estimate): ${r.nutrition}`, `${s}px ${SANS}`, SOFT, s, Math.round(20 * k))
  }
  return y + Math.round(24 * k)
}

// The full recipe on its own canvas, for the video's recipe frame. Long
// recipes shrink the type instead of getting cut off.
export async function renderRecipePanel(recipe: ShareableRecipe): Promise<HTMLCanvasElement | null> {
  if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  let k = 1
  let h = layout(ctx, recipe, k, false)
  for (let i = 0; i < 4 && h > MAX_H; i++) {
    k *= 0.85
    h = layout(ctx, recipe, k, false)
  }
  canvas.width = W
  canvas.height = Math.min(h, MAX_H)
  ctx.fillStyle = PLUM
  ctx.fillRect(0, 0, W, canvas.height)
  ctx.textBaseline = 'alphabetic'
  layout(ctx, recipe, k, true)
  return canvas
}

// Full-frame ShareChef ending: logo, name, App Store link and a big QR code.
export function drawBrandFrame(ctx: CanvasRenderingContext2D, w: number, h: number, brand: BrandAssets): void {
  const u = w / 1080
  ctx.fillStyle = PLUM
  ctx.fillRect(0, 0, w, h)
  ctx.textAlign = 'center'
  let y = h * 0.16
  if (brand.logo) {
    const s = 260 * u
    ctx.save()
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') ctx.roundRect(w / 2 - s / 2, y, s, s, 56 * u)
    else ctx.rect(w / 2 - s / 2, y, s, s)
    ctx.clip()
    ctx.drawImage(brand.logo, w / 2 - s / 2, y, s, s)
    ctx.restore()
    y += s + 90 * u
  }
  ctx.fillStyle = INK
  ctx.font = `600 ${84 * u}px ${SERIF}`
  ctx.fillText('ShareChef AI', w / 2, y)
  y += 70 * u
  ctx.fillStyle = SOFT
  ctx.font = `${40 * u}px ${SANS}`
  ctx.fillText('Cook this hands-free with Micheli', w / 2, y)
  y += 56 * u
  ctx.fillText('Free on the App Store', w / 2, y)
  y += 60 * u
  const q = Math.min(440 * u, h - y - 200 * u)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(w / 2 - q / 2 - 18 * u, y, q + 36 * u, q + 36 * u)
  ctx.drawImage(brand.qr, w / 2 - q / 2, y + 18 * u, q, q)
  y += q + 36 * u + 70 * u
  ctx.fillStyle = GOLD
  ctx.font = `${30 * u}px ${SANS}`
  ctx.fillText(APP_STORE_LABEL, w / 2, y, w - 80 * u)
  ctx.textAlign = 'left'
}
