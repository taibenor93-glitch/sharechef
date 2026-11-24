import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { Recipe } from '../types/recipe'
import { recordShare } from '../lib/shares'
import type { ShareChannel } from '../lib/shares'
import { dishPhotoFile, dishPhotoUrl, removeDishPhoto } from '../lib/dishPhoto'
import { DishPhotoPrompt } from '../components/DishPhotoPrompt'
import { recipeShareText, APP_STORE_LINK } from '../lib/recipeShareText'

export function SavedDetailPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shareMsg, setShareMsg] = useState<string | null>(null)
  // After a photo share: some apps keep only the photo, so offer the recipe on a fresh tap.
  const [offerCopy, setOfferCopy] = useState(false)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  // Loaded ahead of time: iOS only opens the share sheet straight from a tap,
  // so there is no time to download the photo after the button is pressed.
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoVersion, setPhotoVersion] = useState(0) // bumps when a photo is replaced at the same path

  useEffect(() => {
    const run = async () => {
      if (!id) { setLoading(false); return }
      setLoading(true)
      setError(null)
      const { data, error } = await supabase.from('recipes').select('*').eq('id', id).maybeSingle()
      setLoading(false)
      if (error) return setError(error.message)
      setRecipe((data ?? null) as Recipe | null)
    }
    run()
  }, [id])

  const photoPath = recipe?.photo_path ?? null
  const recipeTitle = recipe?.title ?? ''
  useEffect(() => {
    setPhotoUrl(null)
    setPhotoFile(null)
    if (!photoPath) return
    let live = true
    dishPhotoUrl(photoPath).then((u) => { if (live) setPhotoUrl(u) })
    dishPhotoFile(photoPath, recipeTitle).then((f) => { if (live) setPhotoFile(f) })
    return () => { live = false }
  }, [photoPath, recipeTitle, photoVersion])

  // Only when the device can put a photo in the share sheet.
  const canSharePhoto = (file: File | null): file is File =>
    !!file && typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files: [file] })

  const onDelete = async () => {
    if (!id) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('recipes').delete().eq('id', id)
    setBusy(false)
    if (error) return setError(error.message)
    if (recipe?.photo_path) await removeDishPhoto(recipe.photo_path).catch(() => {})
    nav('/saved', { replace: true })
  }

  const APP_LINK = APP_STORE_LINK
  const shareText = recipe
    ? `${recipe.title} — a dish I made with Micheli on ShareChef AI 🍳👨‍🍳`
    : 'Cook with Micheli on ShareChef AI 🍳'
  // Share the actual recipe, not just a link — sharing creations is what ShareChef means.
  const fullRecipeText = recipe
    ? recipeShareText(recipe)
    : `Cook with Micheli on ShareChef AI 🍳 ${APP_LINK}`
  const enc = encodeURIComponent
  const waHref = `https://wa.me/?text=${enc(fullRecipeText)}`
  const xHref = `https://twitter.com/intent/tweet?text=${enc(shareText)}&url=${enc(APP_LINK)}`
  const fbHref = `https://www.facebook.com/sharer/sharer.php?u=${enc(APP_LINK)}`
  const liHref = `https://www.linkedin.com/sharing/share-offsite/?url=${enc(APP_LINK)}`

  // Photo + full recipe through the share sheet. Web links (wa.me, X, Facebook)
  // can't carry a photo, so with a photo every button goes this way. Instagram
  // and Facebook drop text from the share sheet, so the recipe is also copied
  // for pasting as the caption.
  const sharePhoto = async (channel: ShareChannel, file: File, label?: string) => {
    setShareMsg(null)
    setOfferCopy(false)
    navigator.clipboard?.writeText(fullRecipeText).catch(() => {}) // not awaited: keep the tap fresh for share()
    try {
      await navigator.share({ files: [file], title: recipe?.title ?? 'ShareChef AI', text: fullRecipeText })
    } catch {
      return // user dismissed the share sheet
    }
    const earned = await recordShare(channel, id ?? null)
    const pick = label ? `Pick ${label} in the share sheet. ` : ''
    setShareMsg(
      `${earned ? '⭐ +1 Micheli Star! ' : ''}${pick}If the recipe didn't come through with the photo, tap Copy recipe and paste it.${earned ? '' : ' Sign in to earn Micheli Stars.'}`
    )
    setOfferCopy(true)
  }

  // A fresh tap, so the copy works even where the automatic one was blocked.
  const copyRecipe = async () => {
    try {
      await navigator.clipboard.writeText(fullRecipeText)
      setShareMsg('Recipe and App Store link copied. Paste it with your photo.')
    } catch {
      setShareMsg('Copy was blocked on this device. Select the recipe text on this page to copy it.')
    }
    setOfferCopy(false)
  }

  // Channel buttons: with a photo, open the share sheet; without, the old link.
  const onChannel = (channel: ShareChannel, label: string, fallback: () => void) => (e: React.MouseEvent) => {
    if (canSharePhoto(photoFile)) {
      e.preventDefault()
      void sharePhoto(channel, photoFile, label)
      return
    }
    fallback()
  }

  const copyAndOpen = async (channel: ShareChannel, appUrl: string) => {
    setShareMsg(null)
    try {
      await navigator.clipboard.writeText(fullRecipeText)
    } catch { /* clipboard blocked — still open the app */ }
    window.open(appUrl, '_blank', 'noopener,noreferrer')
    const earned = await recordShare(channel, id ?? null)
    setShareMsg(
      earned
        ? '⭐ +1 Micheli Star — full recipe copied, paste it in your post!'
        : 'Full recipe copied — paste it in your post! Sign in to earn Micheli Stars.'
    )
  }

  const trackShare = async (channel: ShareChannel) => {
    const earned = await recordShare(channel, id ?? null)
    setShareMsg(
      earned
        ? '⭐ +1 Micheli Star — thanks for sharing!'
        : 'Shared! Sign in to earn Micheli Stars when you share.'
    )
  }

  const onShare = async () => {
    setShareMsg(null)
    setOfferCopy(false)
    if (canSharePhoto(photoFile)) return sharePhoto('native', photoFile)
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: recipe?.title ?? 'ShareChef AI', text: fullRecipeText })
        await trackShare('native')
        return
      }
    } catch {
      return // user dismissed the share sheet
    }
    try {
      await navigator.clipboard.writeText(fullRecipeText)
      await trackShare('copy')
    } catch {
      setShareMsg(`${shareText} ${APP_LINK}`)
    }
  }

  return (
    <div className="container stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Link to="/saved" className="btn btn-ghost">← My recipes</Link>
      </div>

      {loading ? (
        <div className="card">Loading…</div>
      ) : !id || !recipe ? (
        <div className="card empty">
          <div className="empty-mark">🤔</div>
          <div className="section-title">Recipe not found</div>
          <div className="muted" style={{ marginTop: 6 }}>It may have been deleted, or the link is wrong.</div>
        </div>
      ) : (
        <div className="card recipe-card stack">
          <div>
            <h1 className="recipe-title">{recipe.title}</h1>
            {recipe.description && <p className="recipe-desc">{recipe.description}</p>}
            <div className="recipe-meta">
              {recipe.cook_time_minutes != null && <span className="badge">⏱ {recipe.cook_time_minutes} min</span>}
              {recipe.servings != null && <span className="badge">🍽 serves {recipe.servings}</span>}
              {(recipe.tags ?? []).map((t) => <span key={t} className="badge">#{t}</span>)}
            </div>
          </div>

          {photoUrl && <img className="dish-photo" src={photoUrl} alt={`My ${recipe.title}`} />}
          <DishPhotoPrompt
            userId={recipe.user_id}
            recipeId={recipe.id}
            replace={!!recipe.photo_path}
            onSaved={(path) => {
              setRecipe({ ...recipe, photo_path: path })
              setPhotoVersion((v) => v + 1)
            }}
          />

          <div className="recipe-cols">
            <div>
              <h4>Ingredients</h4>
              <ul>{(recipe.ingredients ?? []).map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
            <div>
              <h4>Steps</h4>
              <ol>{(recipe.steps ?? []).map((s, i) => <li key={i}>{s}</li>)}</ol>
            </div>
          </div>

          {recipe.nutrition && <div className="muted">🥗 Nutrition (per serving, estimate): {recipe.nutrition}</div>}

          <div className="share-block stack" style={{ borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 12 }}>
            <div className="section-title">Share this creation</div>
            <div className="muted" style={{ marginTop: -4, marginBottom: 6 }}>
              {photoUrl ? 'Your photo and the full recipe go out together 🍳' : 'Post to Instagram, TikTok, and more 🍳'}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={onShare}>📤 Share</button>
              <a className="btn btn-ghost" href={waHref} target="_blank" rel="noopener noreferrer" onClick={onChannel('whatsapp', 'WhatsApp', () => trackShare('whatsapp'))}>WhatsApp</a>
              <a className="btn btn-ghost" href={xHref} target="_blank" rel="noopener noreferrer" onClick={onChannel('x', 'X', () => trackShare('x'))}>X</a>
              <a className="btn btn-ghost" href={fbHref} target="_blank" rel="noopener noreferrer" onClick={onChannel('facebook', 'Facebook', () => trackShare('facebook'))}>Facebook</a>
              <a className="btn btn-ghost" href={liHref} target="_blank" rel="noopener noreferrer" onClick={onChannel('linkedin', 'LinkedIn', () => trackShare('linkedin'))}>LinkedIn</a>
              <button type="button" className="btn btn-ghost" onClick={onChannel('instagram', 'Instagram', () => copyAndOpen('instagram', 'https://www.instagram.com/'))}>Instagram</button>
              <button type="button" className="btn btn-ghost" onClick={onChannel('tiktok', 'TikTok', () => copyAndOpen('tiktok', 'https://www.tiktok.com/'))}>TikTok</button>
              <button type="button" className="btn btn-ghost" onClick={onChannel('youtube', 'YouTube', () => copyAndOpen('youtube', 'https://www.youtube.com/'))}>YouTube</button>
            </div>
            {shareMsg && <div className="muted" style={{ marginTop: 4 }}>{shareMsg}</div>}
            {offerCopy && (
              <button type="button" className="btn btn-ghost" onClick={copyRecipe}>📋 Copy recipe</button>
            )}
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-danger" onClick={onDelete} disabled={busy}>
              {busy ? 'Removing…' : 'Delete recipe'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
