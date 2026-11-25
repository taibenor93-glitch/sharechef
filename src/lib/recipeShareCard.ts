// Drawing for the share video: the recipe pages, the ShareChef end frame, and
// the logo and QR code both use. Threads, Instagram and Facebook drop the text
// from a share, so whatever is not drawn into the video never arrives there.
import QRCode from 'qrcode'
import type { Recipe } from '../types/recipe'
import { APP_STORE_LINK } from './recipeShareText'

export type ShareableRecipe = Pick<Recipe, 'title' | 'description' | 'ingredients' | 'steps' | 'nutrition'>

const PAD = 72
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

// A word wider than the line (a URL, a long unbroken string) is cut into
// pieces that fit, so nothing runs off the edge.
function breakWord(ctx: CanvasRenderingContext2D, word: string, maxWidth: number): string[] {
  if (ctx.measureText(word).width <= maxWidth) return [word]
  const parts: string[] = []
  let cur = ''
  for (const ch of Array.from(word)) {
    if (cur && ctx.measureText(cur + ch).width > maxWidth) { parts.push(cur); cur = ch }
    else cur += ch
  }
  if (cur) parts.push(cur)
  return parts
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      breakWord(ctx, word, maxWidth).forEach((part, i) => {
        if (i > 0) { out.push(line); line = part; return } // the piece before filled its line
        const next = line ? `${line} ${part}` : part
        if (!line || ctx.measureText(next).width <= maxWidth) line = next
        else { out.push(line); line = part }
      })
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

// One wrapped line of text, drawn with its top at `top`.
type Line = { h: number; draw: (ctx: CanvasRenderingContext2D, top: number) => void }
// One item (a title, an ingredient, a step) whose lines stay on one page when they fit.
type Group = { lines: Line[]; gapAfter: number; keepWithNext: boolean }

const groupHeight = (g: Group) => g.lines.reduce((sum, l) => sum + l.h, 0)

function buildGroups(ctx: CanvasRenderingContext2D, r: ShareableRecipe, width: number): Group[] {
  const textW = width - PAD * 2
  const groups: Group[] = []

  const block = (text: string, font: string, color: string, size: number, gapAfter: number, indent = 0, prefix = '', keepWithNext = false): Group => {
    ctx.font = font
    const lh = Math.round(size * 1.32)
    const lines: Line[] = wrap(ctx, text, textW - indent).map((line, i) => ({
      h: lh,
      draw: (c, top) => {
        c.font = font
        if (prefix && i === 0) { c.fillStyle = GOLD; c.fillText(prefix, PAD, top + size) }
        c.fillStyle = color
        c.fillText(line, PAD + indent, top + size)
      },
    }))
    const g = { lines, gapAfter, keepWithNext }
    groups.push(g)
    return g
  }
  // A heading never sits alone at the bottom of a page.
  const heading = (text: string) => block(text, `600 40px ${SERIF}`, GOLD, 40, 14, 0, '', true)

  block(r.title, `600 68px ${SERIF}`, INK, 68, 12)
  if (r.description) block(r.description, `italic 34px ${SERIF}`, SOFT, 34, 10)
  block('From my cook with Micheli', `500 28px ${SANS}`, GOLD, 28, 44)

  const ingredients = Array.isArray(r.ingredients) ? r.ingredients : []
  const steps = Array.isArray(r.steps) ? r.steps : []
  if (ingredients.length) {
    heading('Ingredients')
    let last: Group | null = null
    for (const i of ingredients) last = block(i, `34px ${SANS}`, INK, 34, 8, 40, '•')
    if (last) last.gapAfter += 36
  }
  if (steps.length) {
    heading('Steps')
    let last: Group | null = null
    for (const [i, s] of steps.entries()) last = block(s, `34px ${SANS}`, INK, 34, 14, 56, `${i + 1}.`)
    if (last) last.gapAfter += 22
  }
  if (r.nutrition) block(`🥗 Nutrition (per serving, estimate): ${r.nutrition}`, `30px ${SANS}`, SOFT, 30, 20)
  return groups
}

function paginate(groups: Group[], contentH: number): Group[][] {
  // An item taller than a whole page is split line by line.
  const gs = groups.flatMap((g) =>
    groupHeight(g) <= contentH
      ? [g]
      : g.lines.map((l, i) => ({ lines: [l], gapAfter: i === g.lines.length - 1 ? g.gapAfter : 0, keepWithNext: false }))
  )
  const pages: Group[][] = [[]]
  let used = 0
  gs.forEach((g, i) => {
    const page = pages[pages.length - 1]
    const gap = page.length ? page[page.length - 1].gapAfter : 0
    let need = gap + groupHeight(g)
    const next = gs[i + 1]
    if (g.keepWithNext && next) need += g.gapAfter + groupHeight(next)
    if (page.length && used + need > contentH) {
      pages.push([g])
      used = groupHeight(g)
    } else {
      page.push(g)
      used += gap + groupHeight(g)
    }
  })
  return pages
}

// The full recipe as pages of width x height, at a size people can read on a
// phone. Long recipes get more pages instead of smaller type, and nothing is cut.
export async function renderRecipePages(recipe: ShareableRecipe, width: number, height: number): Promise<HTMLCanvasElement[]> {
  if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined)
  const measureCanvas = document.createElement('canvas')
  measureCanvas.width = 1
  measureCanvas.height = 1
  const measure = measureCanvas.getContext('2d')
  if (!measure) throw new Error('Could not draw the recipe.')
  const pages = paginate(buildGroups(measure, recipe, width), height - PAD - PAD / 2)
  releaseCanvas(measureCanvas)
  const made: HTMLCanvasElement[] = []

  return pages.map((page, index) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    // Out of canvas memory: free what was made and fail, rather than
    // silently leaving recipe pages out of the video.
    if (!ctx) {
      made.forEach(releaseCanvas)
      releaseCanvas(canvas)
      throw new Error('Could not draw the recipe.')
    }
    made.push(canvas)
    ctx.fillStyle = PLUM
    ctx.fillRect(0, 0, width, height)
    ctx.textBaseline = 'alphabetic'
    if (pages.length > 1) {
      ctx.fillStyle = GOLD
      ctx.font = `24px ${SANS}`
      ctx.textAlign = 'right'
      ctx.fillText(`${index + 1} / ${pages.length}`, width - PAD, 44)
      ctx.textAlign = 'left'
    }
    let y = PAD
    page.forEach((g, gi) => {
      for (const line of g.lines) { line.draw(ctx, y); y += line.h }
      if (gi < page.length - 1) y += g.gapAfter
    })
    return canvas
  })
}

// Gives a canvas's memory back straight away. iOS frees it slowly on its own
// and caps the total, so repeated video making could otherwise run out.
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
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
