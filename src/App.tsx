const learningLinks = [
  {
    label: "Al Builder's Circle - Free Newsletter",
    href: "https://example.com/newsletter",
  },
  {
    label: "10x Your Al Coding Prompts",
    href: "https://example.com/prompts",
  },
  {
    label: "Work Directly With Me",
    href: "https://example.com/work-with-me",
  },
]

const socialLinks = [
  { label: "YouTube", href: "https://example.com/youtube" },
  { label: "Twitter (X)", href: "https://example.com/twitter" },
  { label: "Instagram", href: "https://example.com/instagram" },
]

export default function App(): JSX.Element {
  return (
    <main className="min-h-screen bg-[#ffffff] px-6 py-12 text-slate-900 dark:bg-[#121212] dark:text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-xl flex-col items-center justify-center text-center">
        <img
          src="https://placehold.co/150x150/png"
          alt="Channel profile"
          className="h-[150px] w-[150px] rounded-full border-4 border-[#2563eb]/40 object-cover shadow-lg"
        />
        <h1 className="mt-6 text-3xl font-bold text-[#2563eb]">
          Al Coding with ShareChef
        </h1>
        <p className="mt-2 max-w-md text-base text-slate-600 dark:text-slate-300">
          Daily prompts, build sessions, and behind-the-scenes experiments to help you ship
          smarter AI-powered projects.
        </p>

        <div className="mt-8 w-full space-y-6">
          <section className="rounded-2xl border border-[#2563eb]/20 bg-white/80 p-6 text-left shadow-sm dark:border-white/10 dark:bg-white/5">
            <h2 className="text-lg font-bold">Learn Al Coding</h2>
            <div className="mt-4 space-y-3">
              {learningLinks.map((link, index) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="animate-fade-in block w-full rounded-xl border border-[#2563eb]/40 bg-[#2563eb] px-4 py-3 text-sm font-semibold text-white shadow transition hover:-translate-y-0.5 hover:bg-[#1d4ed8]"
                  style={{ animationDelay: `${index * 80}ms` }}
                >
                  {link.label}
                </a>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-[#2563eb]/20 bg-white/80 p-6 text-left shadow-sm dark:border-white/10 dark:bg-white/5">
            <h2 className="text-lg font-bold">Find Me Here</h2>
            <div className="mt-4 space-y-3">
              {socialLinks.map((link, index) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="animate-fade-in block w-full rounded-xl border border-[#2563eb]/30 bg-transparent px-4 py-3 text-sm font-semibold text-[#2563eb] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#2563eb]/10"
                  style={{ animationDelay: `${(index + learningLinks.length) * 80}ms` }}
                >
                  {link.label}
                </a>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
