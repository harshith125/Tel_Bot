export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 sm:p-12 relative overflow-hidden selection:bg-cyan-500 selection:text-white">
      {/* Background Glows */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-cyan-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-3xl w-full z-10 flex flex-col gap-8">
        {/* Header Badge */}
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-xl shadow-lg shadow-cyan-500/20">
              ⚡
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">AI Resume Analyzer</h1>
              <p className="text-xs text-slate-400">Telegram Bot & Serverless Webhook Engine</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-xs font-medium text-emerald-400">Operational</span>
          </div>
        </div>

        {/* Hero Section */}
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-6 sm:p-8 shadow-2xl">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mb-3">
            Intelligent Candidate Screening on Telegram
          </h2>
          <p className="text-slate-300 text-sm sm:text-base leading-relaxed mb-6">
            Compare candidate resumes against job descriptions with AI-powered scoring, candidate ranking, 
            skills gap breakdown, and interactive Q&amp;A.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <div className="text-cyan-400 font-semibold text-sm mb-1">📄 Multi-Format</div>
              <div className="text-xs text-slate-400">Parse PDF, DOCX, and bulk ZIP resume folders instantly.</div>
            </div>
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <div className="text-blue-400 font-semibold text-sm mb-1">🧠 Gemini AI</div>
              <div className="text-xs text-slate-400">Multi-tier scoring and truthful recruiter recommendations.</div>
            </div>
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <div className="text-indigo-400 font-semibold text-sm mb-1">💬 Q&amp;A Agent</div>
              <div className="text-xs text-slate-400">Ask conversational questions about candidates directly in Telegram.</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/api/webhook"
              className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-mono text-slate-200 px-4 py-2 rounded-lg transition-colors"
            >
              <span>GET /api/webhook</span>
              <span className="text-slate-500">→ Health Check</span>
            </a>
          </div>
        </div>

        {/* Bot Commands Reference */}
        <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">Bot Commands</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono text-slate-300">
            <div className="flex items-center gap-2 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/40">
              <span className="text-cyan-400 font-bold">/start</span>
              <span className="text-slate-400">- Welcome &amp; instructions</span>
            </div>
            <div className="flex items-center gap-2 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/40">
              <span className="text-cyan-400 font-bold">/addjd</span>
              <span className="text-slate-400">- Switch mode to upload JDs</span>
            </div>
            <div className="flex items-center gap-2 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/40">
              <span className="text-cyan-400 font-bold">/addresume</span>
              <span className="text-slate-400">- Switch mode to upload Resumes</span>
            </div>
            <div className="flex items-center gap-2 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/40">
              <span className="text-cyan-400 font-bold">/analyze</span>
              <span className="text-slate-400">- Start AI evaluation</span>
            </div>
            <div className="flex items-center gap-2 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/40">
              <span className="text-cyan-400 font-bold">/status</span>
              <span className="text-slate-400">- View currently uploaded items</span>
            </div>
            <div className="flex items-center gap-2 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/40">
              <span className="text-cyan-400 font-bold">/reset</span>
              <span className="text-slate-400">- Clear session documents</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-slate-500 border-t border-slate-800/60 pt-4">
          Hosted on Vercel Serverless &bull; Powered by Next.js &amp; Grammy Webhooks
        </div>
      </div>
    </main>
  );
}
