import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { Recipe } from '../types/recipe'
import { recordShare } from '../lib/shares'
import type { ShareChannel } from '../lib/shares'

export function SavedDetailPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shareMsg, setShareMsg] = useState<string | null>(null)

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

  const onDelete = async () => {
    if (!id) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('recipes').delete().eq('id', id)
    setBusy(false)
    if (error) return setError(error.message)
    nav('/saved', { replace: true })
  }

  const APP_LINK = 'https://apps.apple.com/app/sharechef-ai/id6787142176'
  const shareText = recipe
    ? `${recipe.title} — a dish I made with Micheli on ShareChef AI 🍳👨‍🍳`
    : 'Cook with Micheli on ShareChef AI 🍳'
  const enc = encodeURIComponent
  const waHref = `https://wa.me/?text=${enc(`${shareText} ${APP_LINK}`)}`
  const xHref = `https://twitter.com/intent/tweet?text=${enc(shareText)}&url=${enc(APP_LINK)}`
  const fbHref = `https://www.facebook.com/sharer/sharer.php?u=${enc(APP_LINK)}`
  const liHref = `https://www.linkedin.com/sharing/share-offsite/?url=${enc(APP_LINK)}`

  const copyAndOpen = async (channel: ShareChannel, appUrl: string) => {
    setShareMsg(null)
    try {
      await navigator.clipboard.writeText(`${shareText} ${APP_LINK}`)
    } catch { /* clipboard blocked — still open the app */ }
    window.open(appUrl, '_blank', 'noopener,noreferrer')
    const earned = await recordShare(channel, id ?? null)
    setShareMsg(
      earned
        ? '⭐ +1 Micheli Star — caption copied, paste it in your post!'
        : 'Caption copied — paste it in your post! Sign in to earn Micheli Stars.'
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
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: recipe?.title ?? 'ShareChef AI', text: shareText, url: APP_LINK })
        await trackShare('native')
        return
      }
    } catch {
      return // user dismissed the share sheet
    }
    try {
      await navigator.clipboard.writeText(`${shareText} ${APP_LINK}`)
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

          <div className="share-block stack" style={{ borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 12 }}>
            <div className="section-title">Share this creation</div>
            <div className="muted" style={{ marginTop: -4, marginBottom: 6 }}>Post to Instagram, TikTok, and more 🍳</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={onShare}>📤 Share</button>
              <a className="btn btn-ghost" href={waHref} target="_blank" rel="noopener noreferrer" onClick={() => trackShare('whatsapp')}>WhatsApp</a>
              <a className="btn btn-ghost" href={xHref} target="_blank" rel="noopener noreferrer" onClick={() => trackShare('x')}>X</a>
              <a className="btn btn-ghost" href={fbHref} target="_blank" rel="noopener noreferrer" onClick={() => trackShare('facebook')}>Facebook</a>
              <a className="btn btn-ghost" href={liHref} target="_blank" rel="noopener noreferrer" onClick={() => trackShare('linkedin')}>LinkedIn</a>
              <button type="button" className="btn btn-ghost" onClick={() => copyAndOpen('instagram', 'https://www.instagram.com/')}>Instagram</button>
              <button type="button" className="btn btn-ghost" onClick={() => copyAndOpen('tiktok', 'https://www.tiktok.com/')}>TikTok</button>
            </div>
            {shareMsg && <div className="muted" style={{ marginTop: 4 }}>{shareMsg}</div>}
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
