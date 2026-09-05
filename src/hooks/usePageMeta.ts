import { useEffect } from 'react'

const DEFAULT_TITLE = 'ShareChef — cook with Micheli'

export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    const previousTitle = document.title
    document.title = title

    let tag = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    let created = false
    if (!tag) {
      tag = document.createElement('meta')
      tag.name = 'description'
      document.head.appendChild(tag)
      created = true
    }
    const previousDescription = tag.content
    tag.content = description

    return () => {
      document.title = previousTitle || DEFAULT_TITLE
      if (created) tag?.remove()
      else if (tag) tag.content = previousDescription
    }
  }, [title, description])
}
