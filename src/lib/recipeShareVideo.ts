// Turns a cooking video the user picked into a ShareChef share video:
// their clip with a small ShareChef logo badge in the corner, then the full
// recipe (one or more pages), then a ShareChef end frame with the logo, App
// Store link and QR code. Threads and Instagram drop the text from a share,
// so the recipe and the link have to be in the video itself.
//
// Done in the web view: the clip plays into a canvas that MediaRecorder
// records, with the clip's sound routed through Web Audio. It runs in real
// time, so the source is capped at MAX_CLIP_SECONDS.
import { PLUM, drawBrandFrame, loadBrandAssets, releaseCanvas, renderRecipePages } from './recipeShareCard'
import type { BrandAssets, ShareableRecipe } from './recipeShareCard'

export const MAX_CLIP_SECONDS = 60
const OUT_W = 1080
const OUT_H = 1920 // 9:16, what Threads, Reels and TikTok show full screen
const BADGE_ZONE = 200 // bottom strip kept clear of recipe text for the badge
const RECIPE_PAGE_SECONDS = 6
const BRAND_SECONDS = 4
const FPS = 30
const LOAD_TIMEOUT_MS = 15_000 // the clip must open within this
const STALL_TIMEOUT_MS = 10_000 // the clip must keep moving within this
const PROGRESS_EVERY_MS = 200 // progress updates re-render the page, so not every frame
const MAX_FRAME_GAP_MS = 100 // a longer gap means the screen was away; count it as one frame

const OPEN_ERROR = 'Could not open that video. Try another one.'
const STALL_ERROR = 'The video stopped playing before it was finished. Keep this screen open and try again.'
const BLOCKED_ERROR = 'Your phone did not let the video play. Tap "Make my share video" again.'
const SETUP_ERROR = 'Could not make the video on this phone. Try again, or share a photo instead.'

// Thrown when the caller cancels (for example by leaving the page).
export class ShareVideoCancelled extends Error {
  constructor() { super('Share video cancelled') }
}

// MP4 only: it is what Instagram, Threads and TikTok accept. A phone that can
// only record WebM is told it can't make share videos, instead of getting a
// file those apps reject.
export function pickVideoType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  const types = ['video/mp4;codecs=avc1', 'video/mp4']
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? null
}

export function canMakeShareVideo(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    typeof AudioContext !== 'undefined' &&
    pickVideoType() !== null
  )
}

// Waits for `p`, but gives up with `message` after `ms`, or at once on cancel.
function guard<T>(p: Promise<T>, signal: AbortSignal | undefined, ms?: number, message?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) { reject(new ShareVideoCancelled()); return }
    const t = ms === undefined ? undefined : setTimeout(() => finish(() => reject(new Error(message ?? OPEN_ERROR))), ms)
    const onAbort = () => finish(() => reject(new ShareVideoCancelled()))
    const finish = (fn: () => void) => {
      if (t !== undefined) clearTimeout(t)
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    signal?.addEventListener('abort', onAbort)
    p.then((v) => finish(() => resolve(v)), (e) => finish(() => reject(e)))
  })
}

function errorName(err: unknown): string {
  return err instanceof DOMException || err instanceof Error ? err.name : ''
}

// Plain words for the errors play() can give.
function playError(err: unknown): Error {
  if (err instanceof ShareVideoCancelled) return err
  const name = errorName(err)
  if (name === 'NotAllowedError') return new Error(BLOCKED_ERROR)
  if (name === 'NotSupportedError') return new Error("This video's format can't be used. Try another video.")
  return new Error(OPEN_ERROR)
}

// Resolves on the event or after `ms`, whichever comes first.
function waitForEvent(target: HTMLVideoElement, event: string, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = () => { clearTimeout(t); target.removeEventListener(event, done); resolve() }
    const t = setTimeout(done, ms)
    target.addEventListener(event, done)
  })
}

function drawContain(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number) {
  const s = Math.min(OUT_W / sw, OUT_H / sh)
  const w = sw * s, h = sh * s
  ctx.drawImage(src, (OUT_W - w) / 2, (OUT_H - h) / 2, w, h)
}

// The small ShareChef logo badge in the lower corner of the clip and recipe.
function drawBadge(ctx: CanvasRenderingContext2D, brand: BrandAssets) {
  const x = 40, y = OUT_H - 150, h = 104
  ctx.fillStyle = 'rgba(45,8,38,0.82)'
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, 560, h, 26)
  else ctx.rect(x, y, 560, h)
  ctx.fill()
  if (brand.logo) {
    ctx.save()
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x + 14, y + 14, 76, 76, 18)
    else ctx.rect(x + 14, y + 14, 76, 76)
    ctx.clip()
    ctx.drawImage(brand.logo, x + 14, y + 14, 76, 76)
    ctx.restore()
  }
  ctx.fillStyle = '#f6efe4'
  ctx.font = "600 34px Fraunces, Georgia, serif"
  ctx.fillText('ShareChef AI', x + 108, y + 46)
  ctx.fillStyle = '#d8ab5c'
  ctx.font = "24px -apple-system, 'Helvetica Neue', Arial, sans-serif"
  ctx.fillText('Hands-free AI chef · App Store', x + 108, y + 82)
}

// fraction is null while the clip's length is unknown.
export type VideoProgress = { phase: 'clip' | 'recipe' | 'ending'; fraction: number | null }

// Must be called straight from a tap: the part before the first await starts
// the clip playing inside that tap, which is what lets iOS (Safari too) play
// it again later with sound.
export async function makeRecipeShareVideo(
  source: File,
  recipe: ShareableRecipe,
  baseName: string,
  onProgress: (p: VideoProgress) => void,
  signal?: AbortSignal
): Promise<File> {
  const type = pickVideoType()
  if (!type || !canMakeShareVideo()) throw new Error('This phone cannot make share videos yet.')
  if (signal?.aborted) throw new ShareVideoCancelled()

  // ── inside the tap ──
  const audioCtx = new AudioContext()
  const videoUrl = URL.createObjectURL(source)
  const v = document.createElement('video')
  v.playsInline = true
  v.preload = 'auto'
  v.src = videoUrl
  // Sound goes to the recording only, never out loud.
  let audioDest: MediaStreamAudioDestinationNode | null = null
  try {
    const src = audioCtx.createMediaElementSource(v)
    audioDest = audioCtx.createMediaStreamDestination()
    src.connect(audioDest)
  } catch {
    audioDest = null
    v.muted = true // no usable sound route: picture only, and stay silent
  }
  const audioReady = audioCtx.resume().catch(() => undefined)
  const primed = v.play()
  primed.catch(() => undefined) // handled below; avoid an unhandled rejection meanwhile

  let stream: MediaStream | null = null
  let onVisibility: (() => void) | null = null
  let canvas: HTMLCanvasElement | null = null
  let pages: HTMLCanvasElement[] = []
  const checkCancel = () => { if (signal?.aborted) throw new ShareVideoCancelled() }
  // The sound part is ready when there is no sound route, or when it is running.
  // After a phone call iOS leaves it 'interrupted' or 'suspended'.
  const audioOk = () => !audioDest || audioCtx.state === 'running'

  try {
    // The clip has to start (and so load) within the time limit.
    try {
      await guard(primed, signal, LOAD_TIMEOUT_MS, OPEN_ERROR)
    } catch (err) {
      throw playError(err)
    }
    v.pause()
    checkCancel()
    if (v.currentTime > 0) {
      v.currentTime = 0
      await guard(waitForEvent(v, 'seeked', 3000), signal)
    }

    // ── setup: drawing and recorder ──
    let ctx: CanvasRenderingContext2D
    let brand: BrandAssets
    let recorder: MediaRecorder
    const chunks: Blob[] = []
    try {
      brand = await guard(loadBrandAssets(), signal)
      pages = await guard(renderRecipePages(recipe, OUT_W, OUT_H - BADGE_ZONE), signal)
      canvas = document.createElement('canvas')
      canvas.width = OUT_W
      canvas.height = OUT_H
      const c = canvas.getContext('2d')
      if (!c) throw new Error(SETUP_ERROR)
      ctx = c
      // Picture from the canvas, sound from the clip.
      const s = canvas.captureStream(FPS)
      stream = s
      audioDest?.stream.getAudioTracks().forEach((t) => s.addTrack(t))
      recorder = new MediaRecorder(s, { mimeType: type, videoBitsPerSecond: 6_000_000 })
    } catch (err) {
      if (err instanceof ShareVideoCancelled) throw err
      throw new Error(SETUP_ERROR)
    }
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    const stopped = new Promise<void>((res) => { recorder.onstop = () => res() })

    // Record only while the screen is showing, so time away is not in the video.
    let phase: VideoProgress['phase'] = 'clip'
    let hidden = document.visibilityState === 'hidden'
    const canPause = typeof recorder.pause === 'function' && typeof recorder.resume === 'function'
    const setRecording = (on: boolean) => {
      if (!canPause) return
      if (on && recorder.state === 'paused') recorder.resume()
      else if (!on && recorder.state === 'recording') recorder.pause()
    }
    onVisibility = () => {
      hidden = document.visibilityState === 'hidden'
      if (!hidden) return
      setRecording(false)
      // Stop the clip too, or it plays on unseen and that part is lost.
      if (phase === 'clip') v.pause()
    }
    document.addEventListener('visibilitychange', onVisibility)

    let lastEmit = -Infinity
    let lastPhase = ''
    const emit = (p: VideoProgress['phase'], fraction: number | null) => {
      const now = performance.now()
      if (p === lastPhase && now - lastEmit < PROGRESS_EVERY_MS) return
      lastPhase = p
      lastEmit = now
      onProgress({ phase: p, fraction: fraction === null ? null : Math.min(1, Math.max(0, fraction)) })
    }
    const frame = (fn: () => void) => new Promise<number>((res) => requestAnimationFrame((t) => { fn(); res(t) }))
    // Shows a still frame for `seconds` of recorded time, not wall-clock time.
    const hold = async (seconds: number, draw: () => void, onTick: (shown: number) => void) => {
      let shown = 0
      let prev: number | null = null
      while (shown < seconds) {
        checkCancel()
        const t = await frame(draw)
        setRecording(!hidden)
        if (prev !== null && !hidden) shown += Math.min(t - prev, MAX_FRAME_GAP_MS) / 1000
        prev = t
        onTick(shown)
      }
    }

    await audioReady
    try {
      await guard(v.play(), signal)
    } catch (err) {
      throw playError(err)
    }
    try {
      recorder.start(1000)
    } catch {
      throw new Error(SETUP_ERROR)
    }
    try {
      // 1) The user's clip, with the ShareChef badge.
      // Read each frame: some clips only learn their length while playing.
      const knownLength = () => (Number.isFinite(v.duration) && v.duration > 0 ? Math.min(v.duration, MAX_CLIP_SECONDS) : null)
      const drawClip = () => {
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, OUT_W, OUT_H)
        drawContain(ctx, v, v.videoWidth, v.videoHeight)
        drawBadge(ctx, brand)
      }
      let lastTime = v.currentTime
      let lastMove = performance.now()
      let lastFrame = lastMove
      let lastRetry = 0
      let retryError: unknown = null
      while (!v.ended && v.currentTime < (knownLength() ?? MAX_CLIP_SECONDS)) {
        checkCancel()
        if (v.error) throw new Error(STALL_ERROR)
        await frame(drawClip)
        const now = performance.now()
        if (now - lastFrame > 1000) lastMove = now // the screen was away: that is not a stall
        lastFrame = now
        const ready = !v.paused && audioOk()
        if (ready && v.currentTime !== lastTime) {
          lastTime = v.currentTime
          lastMove = now
          retryError = null
        } else if (now - lastMove > STALL_TIMEOUT_MS) {
          // If the phone kept refusing to restart it, say so plainly.
          const name = errorName(retryError)
          throw name === 'NotAllowedError' || name === 'NotSupportedError' ? playError(retryError) : new Error(STALL_ERROR)
        }
        // Paused by the system (a call, an audio interruption, leaving the app):
        // stop recording until both the clip and its sound run again, and try
        // to restart them once a second.
        if (!ready) {
          setRecording(false)
          if (!hidden && now - lastRetry > 1000) {
            lastRetry = now
            if (!audioOk()) void audioCtx.resume().catch((e) => { retryError = e })
            if (v.paused && !v.ended) void v.play().catch((e) => { retryError = e })
          }
        } else {
          setRecording(!hidden)
        }
        const len = knownLength()
        emit('clip', len === null ? null : v.currentTime / len)
      }
      v.pause()

      // 2) The full recipe, page by page.
      phase = 'recipe'
      for (const [i, page] of pages.entries()) {
        await hold(RECIPE_PAGE_SECONDS, () => {
          ctx.fillStyle = PLUM
          ctx.fillRect(0, 0, OUT_W, OUT_H)
          ctx.drawImage(page, 0, 0)
          drawBadge(ctx, brand)
        }, (shown) => emit('recipe', (i + shown / RECIPE_PAGE_SECONDS) / pages.length))
      }

      // 3) ShareChef ending: logo, App Store link, QR code.
      phase = 'ending'
      await hold(BRAND_SECONDS, () => drawBrandFrame(ctx, OUT_W, OUT_H, brand), (shown) => emit('ending', shown / BRAND_SECONDS))
    } finally {
      if (recorder.state !== 'inactive') recorder.stop()
      await stopped
    }
    checkCancel()

    const blob = new Blob(chunks, { type: 'video/mp4' })
    if (!blob.size) throw new Error('The video came out empty. Try again.')
    return new File([blob], `${baseName}.mp4`, { type: blob.type })
  } finally {
    if (onVisibility) document.removeEventListener('visibilitychange', onVisibility)
    v.pause()
    v.removeAttribute('src')
    v.load() // releases the decoder
    stream?.getTracks().forEach((t) => t.stop())
    // iOS frees canvas memory slowly and caps the total, so give it back now.
    pages.forEach(releaseCanvas)
    if (canvas) releaseCanvas(canvas)
    URL.revokeObjectURL(videoUrl)
    void audioCtx.close().catch(() => undefined)
  }
}
