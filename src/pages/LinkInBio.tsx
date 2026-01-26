import { useMemo, useState } from "react"

const learnLinks = [
  {
    label: "AI Builder's Circle - Free Newsletter",
    href: "https://example.com/newsletter",
  },
  {
    label: "10x Your AI Coding Prompts",
    href: "https://example.com/prompts",
  },
  {
    label: "Work Directly With Me",
    href: "https://example.com/coaching",
  },
]

const socialLinks = [
  { label: "YouTube", href: "https://example.com/youtube" },
  { label: "Twitter (X)", href: "https://example.com/twitter" },
  { label: "Instagram", href: "https://example.com/instagram" },
]

export function LinkInBioPage() {
  const [isDark, setIsDark] = useState(false)
  const themeLabel = useMemo(() => (isDark ? "Switch to Light" : "Switch to Dark"), [isDark])

  return (
    <div className={isDark ? "dark" : ""}>
      <div className="min-h-screen bg-white px-4 py-10 text-slate-900 transition-colors dark:bg-[#121212] dark:text-slate-100">
        <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-2xl flex-col items-center justify-center">
          <div className="w-full rounded-3xl border border-slate-200 bg-white/90 p-6 text-center shadow-lg shadow-slate-200/40 backdrop-blur dark:border-slate-800 dark:bg-[#1b1b1b]/90 dark:shadow-none sm:p-10">
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => setIsDark((prev) => !prev)}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-[#2563eb] hover:text-[#2563eb] dark:border-slate-700 dark:text-slate-200"
              >
                {themeLabel}
              </button>
            </div>

            <img
              src="https://placehold.co/150x150"
              alt="Channel profile"
              className="mx-auto mt-6 h-[150px] w-[150px] rounded-full border-4 border-[#2563eb] object-cover"
            />

            <h1 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">
              Learn AI Coding
            </h1>
            <p className="mx-auto mt-3 max-w-md text-base text-slate-600 dark:text-slate-300">
              Building practical AI apps, sharing tutorials, and exploring the future of coding together.
            </p>

            <div className="mt-8 text-left">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Learn AI Coding
              </h2>
              <div className="mt-4 flex flex-col gap-3">
                {learnLinks.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    className="fade-in inline-flex w-full items-center justify-center rounded-full bg-[#2563eb] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </div>

            <div className="mt-10 text-left">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Find Me Here
              </h2>
              <div className="mt-4 flex flex-col gap-3">
                {socialLinks.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    className="fade-in inline-flex w-full items-center justify-center rounded-full border border-[#2563eb] px-4 py-3 text-sm font-semibold text-[#2563eb] transition hover:bg-[#2563eb] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
