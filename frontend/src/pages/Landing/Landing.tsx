import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Sparkles,
  Shield,
  ArrowRight,
  CheckCircle2,
  MessageSquare,
  Check,
  ChevronDown,
  Send,
  Workflow,
  BarChart3,
  Laptop,
  ArrowUpRight,
  Target,
  Sparkle,
  Menu,
  X,
  Calendar,
} from 'lucide-react'

import { useAuth } from '@/auth/AuthContext'

export function Landing() {
  const { isAuthenticated } = useAuth()

  // SEO Title setup
  useEffect(() => {
    document.title = 'AI Agent — Autonomous AI Co-Pilot for Safe LinkedIn Growth'
  }, [])

  // Header scroll detection
  const [isScrolled, setIsScrolled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Demo Modal State
  const [demoModalOpen, setDemoModalOpen] = useState(false)
  const [demoSubmitted, setDemoSubmitted] = useState(false)
  const [demoForm, setDemoForm] = useState({
    name: '',
    email: '',
    company: '',
    teamSize: '1-10',
    notes: '',
  })

  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual')
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  const scrollToTop = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
    }
    setMobileMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    if (window.location.hash) {
      window.history.pushState(null, '', window.location.pathname)
    }
  }

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 selection:bg-blue-600 selection:text-white font-sans antialiased overflow-x-clip">
      {/* Background Glow Mesh */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[20%] w-[600px] h-[600px] rounded-full bg-blue-600/15 blur-[140px]" />
        <div className="absolute top-[30%] right-[-5%] w-[500px] h-[500px] rounded-full bg-indigo-600/10 blur-[160px]" />
        <div className="absolute top-[60%] left-[-10%] w-[550px] h-[550px] rounded-full bg-cyan-600/10 blur-[150px]" />
      </div>

      {/* --------------------------------------------------------------------- */}
      {/* 1. Header & Navigation (Fixed at Top) */}
      {/* --------------------------------------------------------------------- */}
      <header
        className={`fixed top-0 left-0 right-0 w-full z-50 transition-all duration-300 ${
          isScrolled
            ? 'bg-[#070b14]/95 backdrop-blur-xl border-b border-slate-800 shadow-xl shadow-black/50'
            : 'bg-[#070b14]/85 backdrop-blur-md border-b border-slate-800/80 shadow-lg shadow-black/25'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          {/* Logo */}
          <Link
            to="/"
            onClick={scrollToTop}
            className="flex items-center gap-3 group cursor-pointer"
            aria-label="Kestrel - Scroll to top"
          >
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-400 p-[1.5px] shadow-lg shadow-blue-500/20 group-hover:scale-105 transition-transform">
              <div className="h-full w-full bg-[#090d19] rounded-[10px] flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-cyan-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold tracking-tight text-white group-hover:text-cyan-400 transition-colors">
                  Kestrel
                </span>
                <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">
                  AI Co-Pilot
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">Safe LinkedIn Automation</p>
            </div>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-300">
            <a href="#features" className="hover:text-white transition-colors">
              Features
            </a>
            <a href="#how-it-works" className="hover:text-white transition-colors">
              How It Works
            </a>
            <a href="#safety" className="hover:text-white transition-colors flex items-center gap-1.5">
              <Shield className="h-4 w-4 text-emerald-400" />
              Safety Guarantee
            </a>
            <a href="#pricing" className="hover:text-white transition-colors">
              Pricing
            </a>
            <a href="#faq" className="hover:text-white transition-colors">
              FAQ
            </a>
          </nav>

          {/* CTA Actions */}
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <Link
                to="/dashboard"
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium shadow-lg shadow-blue-500/25 rounded-xl px-5 py-2.5 inline-flex items-center gap-2 text-sm transition-all"
              >
                <span>Go to Dashboard</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="hidden sm:inline-flex text-sm font-medium text-slate-300 hover:text-white px-3.5 py-2 rounded-lg transition-colors"
                >
                  Sign In
                </Link>
                <Link
                  to="/login"
                  className="bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-400 text-white font-medium shadow-lg shadow-blue-600/30 rounded-xl px-4 sm:px-5 py-2.5 inline-flex items-center gap-2 text-sm transition-all"
                >
                  <span>Start Free Trial</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </>
            )}

            {/* Mobile Hamburger Button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors border border-slate-700/60"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Menu (Fixed under header) */}
        {mobileMenuOpen && (
          <div className="md:hidden border-b border-slate-800 bg-[#080d1a]/98 backdrop-blur-2xl px-4 py-6 space-y-4 shadow-2xl animate-in slide-in-from-top-3 duration-200">
            <nav className="flex flex-col space-y-3 text-sm font-medium text-slate-300">
              <a
                href="#features"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-slate-800/60 hover:text-white transition-colors"
              >
                Features
              </a>
              <a
                href="#how-it-works"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-slate-800/60 hover:text-white transition-colors"
              >
                How It Works
              </a>
              <a
                href="#safety"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-slate-800/60 hover:text-white transition-colors flex items-center gap-2"
              >
                <Shield className="h-4 w-4 text-emerald-400" />
                Safety Guarantee
              </a>
              <a
                href="#pricing"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-slate-800/60 hover:text-white transition-colors"
              >
                Pricing
              </a>
              <a
                href="#faq"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-slate-800/60 hover:text-white transition-colors"
              >
                FAQ
              </a>
            </nav>
            {!isAuthenticated && (
              <div className="pt-4 border-t border-slate-800/80 flex flex-col gap-2">
                <Link
                  to="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full text-center py-2.5 text-sm font-medium text-slate-300 hover:text-white bg-slate-900 rounded-xl border border-slate-800"
                >
                  Sign In
                </Link>
                <Link
                  to="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full text-center py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-lg shadow-blue-600/30"
                >
                  Start Free Trial
                </Link>
              </div>
            )}
          </div>
        )}
      </header>

      {/* --------------------------------------------------------------------- */}
      {/* 2. Hero Section */}
      {/* --------------------------------------------------------------------- */}
      <section className="relative z-10 pt-28 pb-24 md:pt-36 md:pb-32 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs sm:text-sm font-medium mb-8 backdrop-blur-md shadow-inner">
            <Sparkle className="h-4 w-4 text-cyan-400 animate-pulse" />
            <span>The Autonomous AI Growth Engine Built for Safety First</span>
            <span className="hidden sm:inline text-slate-500">•</span>
            <span className="hidden sm:inline text-slate-300">100% Platform Limit Compliant</span>
          </div>

          {/* Main Headline */}
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white max-w-5xl mx-auto leading-[1.12]">
            Turn LinkedIn into Your{' '}
            <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-indigo-300 bg-clip-text text-transparent">
              Highest-Converting
            </span>{' '}
            Relationship Engine.
          </h1>

          {/* Subtitle */}
          <p className="mt-6 sm:mt-8 text-lg sm:text-xl text-slate-300 max-w-3xl mx-auto leading-relaxed font-normal">
            Discover ideal prospects from plain-English prompts, warm them with bespoke post comments written in your authentic voice, and execute natural connection sequences with 1-click human oversight.
          </p>

          {/* Action CTAs */}
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/login"
              className="w-full sm:w-auto h-13 px-8 text-base bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-400 text-white font-semibold rounded-2xl shadow-xl shadow-blue-600/35 transition-all transform hover:-translate-y-0.5 inline-flex items-center justify-center gap-2"
            >
              <span>Start Free 14-Day Trial</span>
              <ArrowRight className="h-5 w-5" />
            </Link>
            <button
              type="button"
              onClick={() => {
                setDemoSubmitted(false)
                setDemoModalOpen(true)
              }}
              className="w-full sm:w-auto h-13 px-8 inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-700/80 bg-slate-900/60 hover:bg-slate-800/80 text-slate-200 text-base font-medium backdrop-blur-md transition-all hover:border-cyan-500/50 cursor-pointer"
            >
              <Calendar className="h-4 w-4 text-cyan-400" />
              <span>Book a Demo</span>
            </button>
          </div>

          {/* Micro-proof line */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-6 text-xs sm:text-sm text-slate-400">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              No credit card required
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              Zero bot flags or scrapers
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              Full human approval mode
            </span>
          </div>

          {/* ----------------------------------------------------------------- */}
          {/* Hero Live Mockup Card */}
          {/* ----------------------------------------------------------------- */}
          <div className="mt-16 sm:mt-20 relative max-w-5xl mx-auto">
            {/* Glow framing */}
            <div className="absolute -inset-1.5 bg-gradient-to-r from-blue-600 via-cyan-500 to-indigo-600 rounded-3xl blur-xl opacity-30 group-hover:opacity-60 transition duration-1000"></div>

            <div className="relative rounded-2xl sm:rounded-3xl border border-slate-700/80 bg-[#0b1222]/90 backdrop-blur-2xl shadow-2xl overflow-hidden text-left">
              {/* Window Header */}
              <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-red-500/80" />
                  <div className="h-3 w-3 rounded-full bg-yellow-500/80" />
                  <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
                  <span className="ml-3 text-xs font-mono text-slate-400">app.agent.ai/dashboard</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    Agent Status: RUNNING
                  </span>
                  <span className="hidden sm:inline text-xs text-slate-400">
                    Daily Safety Limit: <strong className="text-slate-200">18 / 60 Actions</strong>
                  </span>
                </div>
              </div>

              {/* Window Content */}
              <div className="p-5 sm:p-8 space-y-6">
                {/* Top Metrics Row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60">
                    <span className="text-xs text-slate-400">Audience Discovered</span>
                    <p className="text-2xl font-bold text-white mt-1">428</p>
                    <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1 mt-1">
                      <ArrowUpRight className="h-3 w-3" /> +14 new today
                    </span>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60">
                    <span className="text-xs text-slate-400">Warmed Acceptance Rate</span>
                    <p className="text-2xl font-bold text-cyan-400 mt-1">41.8%</p>
                    <span className="text-[11px] text-slate-400 font-medium mt-1">vs 18.2% cold</span>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60">
                    <span className="text-xs text-slate-400">Meaningful Comments</span>
                    <p className="text-2xl font-bold text-white mt-1">94</p>
                    <span className="text-[11px] text-emerald-400 font-medium mt-1">100% human approved</span>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60">
                    <span className="text-xs text-slate-400">Replies Received</span>
                    <p className="text-2xl font-bold text-indigo-400 mt-1">37</p>
                    <span className="text-[11px] text-slate-400 font-medium mt-1">Auto-sequence paused</span>
                  </div>
                </div>

                {/* Workflow Card Mockup */}
                <div className="rounded-xl border border-slate-700/70 bg-slate-900/70 p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs">
                        1
                      </div>
                      <span className="font-semibold text-white text-sm">
                        Active Campaign: B2B SaaS Founders & CTOs (US/EU)
                      </span>
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      Step 3 of 4: Contextual Comment
                    </span>
                  </div>

                  {/* Multi-step pipeline pill visualization */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-1 text-xs">
                    <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span>1. View Profile</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span>2. Like Relevant Post</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-blue-500/20 border border-blue-500/40 text-blue-200 font-medium flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-blue-400 shrink-0" />
                      <span>3. Bespoke Comment</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/50 text-slate-400 flex items-center gap-2">
                      <Send className="h-4 w-4 text-slate-500 shrink-0" />
                      <span>4. Connect with Note</span>
                    </div>
                  </div>

                  {/* AI Generated Draft Box */}
                  <div className="p-4 rounded-xl bg-slate-950/80 border border-blue-500/30 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-200">Prospect: Sarah Chen</span>
                        <span className="text-slate-500">·</span>
                        <span className="text-slate-400">VP Eng at DataFlow</span>
                      </div>
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-blue-500/20 text-cyan-300">
                        Voice Match: 96%
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 italic border-l-2 border-blue-500 pl-3 leading-relaxed">
                      "Terrific points on streaming architectures Sarah. Moving from batch to sub-second Kafka ingestion solved our schema latency, but tombstone management was our biggest headache. Did you rely on ksqlDB or build custom stateful processors?"
                    </p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-slate-400">
                        Awaiting your confirmation before posting
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400 hover:text-white cursor-pointer px-2 py-1">
                          Edit
                        </span>
                        <span className="text-xs font-semibold px-3 py-1 rounded-lg bg-blue-600 text-white cursor-pointer hover:bg-blue-500 transition-colors">
                          Approve
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* 3. Metrics Banner */}
      {/* --------------------------------------------------------------------- */}
      <section className="relative z-10 border-y border-slate-800 bg-[#090e1c]/80 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <p className="text-3xl sm:text-4xl font-extrabold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                41.8%
              </p>
              <p className="text-xs sm:text-sm text-slate-400 mt-1 font-medium">
                Warmed Connection Acceptance Rate
              </p>
            </div>
            <div>
              <p className="text-3xl sm:text-4xl font-extrabold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                3.4x
              </p>
              <p className="text-xs sm:text-sm text-slate-400 mt-1 font-medium">
                Higher Reply Rate on Follow-ups
              </p>
            </div>
            <div>
              <p className="text-3xl sm:text-4xl font-extrabold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
                0
              </p>
              <p className="text-xs sm:text-sm text-slate-400 mt-1 font-medium">
                Platform Restrictions or Bot Flags
              </p>
            </div>
            <div>
              <p className="text-3xl sm:text-4xl font-extrabold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                15+ hrs
              </p>
              <p className="text-xs sm:text-sm text-slate-400 mt-1 font-medium">
                Saved Per Week per Rep / Founder
              </p>
            </div>
          </div>
        </div>
      </section>


      {/* --------------------------------------------------------------------- */}
      {/* 5. Core Feature Pillars */}
      {/* --------------------------------------------------------------------- */}
      <section id="features" className="relative z-10 py-24 bg-[#090e1c]/60 border-t border-slate-800 px-4 sm:px-6 lg:px-8 scroll-mt-24">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs uppercase tracking-wider font-bold text-blue-400 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20">
              Intelligent Architecture
            </span>
            <h2 className="text-3xl sm:text-5xl font-extrabold text-white mt-4">
              Everything You Need for Scalable, Safe Outreach
            </h2>
            <p className="text-base text-slate-400 mt-3">
              Engineered from the ground up to eliminate repetitive outreach grind while keeping your profile 100% compliant.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="p-8 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-blue-500/50 transition-all hover:-translate-y-1 group">
              <div className="h-12 w-12 rounded-2xl bg-blue-500/20 text-blue-400 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Target className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Prompt-to-Audience Discovery</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Skip complicated boolean search strings. Write what you want in natural language; the AI extracts titles, seniority, geography, and evaluates candidates with 0–100 fit scores.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="p-8 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-cyan-500/50 transition-all hover:-translate-y-1 group">
              <div className="h-12 w-12 rounded-2xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <MessageSquare className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Bespoke Contextual Comments</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                The agent reads the prospect's post, analyzes the discussion thread, and writes peer-level comments that add value before you send a connection request.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-8 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-indigo-500/50 transition-all hover:-translate-y-1 group">
              <div className="h-12 w-12 rounded-2xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Workflow className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Multi-Step Warming Workflows</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Simulate genuine interest: Profile view on Day 1, Post like on Day 2, Insightful comment on Day 3, Connection request with custom note on Day 4.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="p-8 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-emerald-500/50 transition-all hover:-translate-y-1 group">
              <div className="h-12 w-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Human Approval Queue</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Maintain 100% control. Every generated comment or connection note can be reviewed, edited, regenerated, or approved with 1 click in the web app or extension.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="p-8 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-purple-500/50 transition-all hover:-translate-y-1 group">
              <div className="h-12 w-12 rounded-2xl bg-purple-500/20 text-purple-400 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Laptop className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Native Chrome Extension</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Executes actions directly through your active browser session. Injects live fit scores and quick-action side panels onto LinkedIn profile pages.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="p-8 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-amber-500/50 transition-all hover:-translate-y-1 group">
              <div className="h-12 w-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <BarChart3 className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Real-Time Funnel Analytics</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Compare warmed vs. cold acceptance rates in real time, track pipeline conversions from matched to reply, and export full audit logs to CSV.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* 6. How It Works (Step-by-Step) */}
      {/* --------------------------------------------------------------------- */}
      <section id="how-it-works" className="relative z-10 py-24 px-4 sm:px-6 lg:px-8 scroll-mt-24">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs uppercase tracking-wider font-bold text-cyan-400 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20">
              Simple 3-Step Setup
            </span>
            <h2 className="text-3xl sm:text-5xl font-extrabold text-white mt-4">
              From Sign-in to Active Pipeline in 5 Minutes
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <div className="p-8 rounded-3xl bg-[#0c1324] border border-slate-800 relative space-y-4">
              <div className="text-4xl font-extrabold text-blue-500/40">01</div>
              <h3 className="text-xl font-bold text-white">Connect & Calibrate</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Sign in with LinkedIn OAuth and link the lightweight Chrome extension. The agent scans your last 20 posts to build your unique voice profile.
              </p>
            </div>

            <div className="p-8 rounded-3xl bg-[#0c1324] border border-slate-800 relative space-y-4">
              <div className="text-4xl font-extrabold text-indigo-500/40">02</div>
              <h3 className="text-xl font-bold text-white">Describe Your Audience</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Prompt your Ideal Customer Profile. Review the scored candidates and choose your warming sequence (likes, comments, connection note).
              </p>
            </div>

            <div className="p-8 rounded-3xl bg-[#0c1324] border border-slate-800 relative space-y-4">
              <div className="text-4xl font-extrabold text-cyan-500/40">03</div>
              <h3 className="text-xl font-bold text-white">Approve & Watch Growth</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Review drafted comments in 30 seconds every morning. When prospects reply, automation immediately pauses so you can close the deal.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* 7. Safety & Anti-Detection Architecture */}
      {/* --------------------------------------------------------------------- */}
      <section id="safety" className="relative z-10 py-24 bg-gradient-to-b from-[#090e1c] to-[#070b14] border-t border-slate-800 px-4 sm:px-6 lg:px-8 scroll-mt-24">
        <div className="max-w-7xl mx-auto">
          <div className="rounded-3xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/20 via-slate-900 to-slate-900 p-8 sm:p-14 relative overflow-hidden">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold mb-6">
                <Shield className="h-4 w-4" />
                <span>The Anti-Detection Promise</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
                Never Risk Your LinkedIn Reputation.
              </h2>
              <p className="mt-4 text-base text-slate-300 leading-relaxed">
                Unlike cloud scrapers that spoof headless browsers from shared data center IPs, our agent runs within your authentic desktop session with full working hours, random human jitter, account tier limits, and emergency circuit breakers.
              </p>

              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-slate-300">
                <div className="flex items-center gap-2.5">
                  <Check className="h-5 w-5 text-emerald-400 shrink-0" />
                  <span>No headless browsers or datacenter proxies</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Check className="h-5 w-5 text-emerald-400 shrink-0" />
                  <span>Respects Free, Premium, & Sales Nav caps</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Check className="h-5 w-5 text-emerald-400 shrink-0" />
                  <span>Instant freeze on any platform challenge</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Check className="h-5 w-5 text-emerald-400 shrink-0" />
                  <span>End-to-end encrypted session credentials</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* 8. Pricing Section */}
      {/* --------------------------------------------------------------------- */}
      <section id="pricing" className="relative z-10 py-24 px-4 sm:px-6 lg:px-8 scroll-mt-24">
        <div className="max-w-7xl mx-auto text-center">
          <span className="text-xs uppercase tracking-wider font-bold text-blue-400 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20">
            Simple, Transparent Pricing
          </span>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-white mt-4">
            Invest in High-Intent Pipeline
          </h2>
          <p className="text-base text-slate-400 mt-3 max-w-xl mx-auto">
            Choose the plan that fits your growth targets. All plans include 14 days free trial.
          </p>

          {/* Billing Switch */}
          <div className="mt-8 flex items-center justify-center gap-3">
            <span className={`text-sm ${billingCycle === 'monthly' ? 'text-white font-semibold' : 'text-slate-400'}`}>
              Monthly
            </span>
            <button
              type="button"
              onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'annual' : 'monthly')}
              className="w-14 h-7 rounded-full bg-slate-800 p-1 flex items-center transition-colors border border-slate-700"
            >
              <div
                className={`w-5 h-5 rounded-full bg-blue-500 transition-transform ${
                  billingCycle === 'annual' ? 'translate-x-7' : 'translate-x-0'
                }`}
              />
            </button>
            <span className={`text-sm flex items-center gap-1.5 ${billingCycle === 'annual' ? 'text-white font-semibold' : 'text-slate-400'}`}>
              Annual
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                Save 20%
              </span>
            </span>
          </div>

          {/* Pricing Cards */}
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
            {/* Starter Plan */}
            <div className="p-8 rounded-3xl bg-slate-900/50 border border-slate-800 flex flex-col justify-between">
              <div>
                <h3 className="text-xl font-bold text-white">Starter</h3>
                <p className="text-xs text-slate-400 mt-1">For solopreneurs & early founders.</p>
                <div className="mt-6 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold text-white">
                    {billingCycle === 'annual' ? '$39' : '$49'}
                  </span>
                  <span className="text-xs text-slate-400">/ month</span>
                </div>
                <ul className="mt-6 space-y-3 text-xs text-slate-300">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-blue-400" />
                    <span>Up to 2 active campaigns</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-blue-400" />
                    <span>200 AI prospect evaluations / mo</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-blue-400" />
                    <span>Bespoke comments & connection notes</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-blue-400" />
                    <span>Chrome Extension co-pilot</span>
                  </li>
                </ul>
              </div>
              <Link
                to="/login?plan=starter"
                className="mt-8 w-full bg-slate-800 hover:bg-slate-700 text-white rounded-xl py-2.5 text-center text-sm font-semibold transition-colors block"
              >
                Start Free 14-Day Trial
              </Link>
            </div>

            {/* Growth Plan (Featured) */}
            <div className="p-8 rounded-3xl bg-gradient-to-b from-[#111c38] to-[#0c1529] border-2 border-blue-500 shadow-2xl shadow-blue-500/20 relative flex flex-col justify-between">
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3.5 py-0.5 rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 text-white text-[11px] font-bold uppercase tracking-wider shadow-md">
                Most Popular
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Growth</h3>
                <p className="text-xs text-slate-300 mt-1">For scaling B2B founders & sales teams.</p>
                <div className="mt-6 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold text-white">
                    {billingCycle === 'annual' ? '$79' : '$99'}
                  </span>
                  <span className="text-xs text-slate-400">/ month</span>
                </div>
                <ul className="mt-6 space-y-3 text-xs text-slate-200">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-cyan-400" />
                    <span>Unlimited active campaigns</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-cyan-400" />
                    <span>800 AI prospect evaluations / mo</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-cyan-400" />
                    <span>Voice profile cloning from 20 past posts</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-cyan-400" />
                    <span>Automated warm-up ramp & jitter</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-cyan-400" />
                    <span>CSV export & funnel analytics</span>
                  </li>
                </ul>
              </div>
              <Link
                to="/login?plan=growth"
                className="mt-8 w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold rounded-xl shadow-lg shadow-blue-600/30 py-2.5 text-center text-sm transition-all block"
              >
                Start Free 14-Day Trial
              </Link>
            </div>

            {/* Scale / Agency */}
            <div className="p-8 rounded-3xl bg-slate-900/50 border border-slate-800 flex flex-col justify-between">
              <div>
                <h3 className="text-xl font-bold text-white">Scale & Team</h3>
                <p className="text-xs text-slate-400 mt-1">For agencies & multi-seat teams.</p>
                <div className="mt-6 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold text-white">
                    {billingCycle === 'annual' ? '$159' : '$199'}
                  </span>
                  <span className="text-xs text-slate-400">/ month</span>
                </div>
                <ul className="mt-6 space-y-3 text-xs text-slate-300">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-blue-400" />
                    <span>Multiple LinkedIn accounts & workspaces</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-blue-400" />
                    <span>2,500 AI evaluations / mo</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-blue-400" />
                    <span>Team role-based approvals</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-blue-400" />
                    <span>Dedicated account strategist</span>
                  </li>
                </ul>
              </div>
              <Link
                to="/login?plan=scale"
                className="mt-8 w-full bg-slate-800 hover:bg-slate-700 text-white rounded-xl py-2.5 text-center text-sm font-semibold transition-colors block"
              >
                Start Free 14-Day Trial
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* 9. FAQ Section */}
      {/* --------------------------------------------------------------------- */}
      <section id="faq" className="relative z-10 py-24 bg-[#090e1c]/50 border-t border-slate-800 px-4 sm:px-6 lg:px-8 scroll-mt-24">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-xs uppercase tracking-wider font-bold text-cyan-400 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20">
              Got Questions?
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mt-4">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="space-y-4">
            {[
              {
                q: "Will using this agent get my LinkedIn account restricted?",
                a: "No. Unlike legacy scrapers that hammer servers from remote IPs, the agent operates within your active desktop browser session and strictly enforces platform limits (60 likes, 20 comments, 25 invites/day), incorporates natural human jitter delays (45s–180s), and halts immediately upon any platform challenge.",
              },
              {
                q: "Can I approve every comment and message before it is posted?",
                a: "Yes. The system has 3 approval modes: 'Approve Everything', 'Approve Posts Only', and 'Fully Automatic'. In Approve Everything mode, not a single comment or connection note goes out until you click 'Approve'.",
              },
              {
                q: "How does the agent avoid generic AI comments like 'Great post'?",
                a: "The agent reads the full context of the post, extracts key arguments, identifies author sentiment, and consults your custom 'About You' profile and 'Never Say' rules. Every comment adds genuine perspective or asks a thoughtful follow-up question.",
              },
              {
                q: "What happens when a prospect replies to my message?",
                a: "The moment a prospect replies, the agent automatically stops their automated sequence and notifies you so you can engage directly in a 1-on-1 conversation.",
              },
              {
                q: "Do I need LinkedIn Sales Navigator to use the agent?",
                a: "No. The agent supports Free, Premium, and Sales Navigator accounts, and automatically calibrates daily action limits to your account tier.",
              },
            ].map((faq, idx) => (
              <div
                key={idx}
                className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                  className="w-full p-5 text-left flex items-center justify-between text-sm sm:text-base font-semibold text-white hover:text-cyan-400 transition-colors"
                >
                  <span>{faq.q}</span>
                  <ChevronDown
                    className={`h-4 w-4 text-slate-400 transition-transform ${
                      openFaq === idx ? 'rotate-180 text-cyan-400' : ''
                    }`}
                  />
                </button>
                {openFaq === idx && (
                  <div className="px-5 pb-5 text-xs sm:text-sm text-slate-300 leading-relaxed border-t border-slate-800/60 pt-3">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* 10. The Closer CTA Banner */}
      {/* --------------------------------------------------------------------- */}
      <section className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto rounded-3xl bg-gradient-to-r from-blue-700 via-indigo-700 to-cyan-600 p-8 sm:p-14 text-center shadow-2xl shadow-blue-500/20 relative overflow-hidden">
          <div className="relative z-10">
            <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
              Ready to 10x Your LinkedIn Pipeline?
            </h2>
            <p className="mt-4 text-base sm:text-lg text-blue-100 max-w-2xl mx-auto font-medium">
              Join founders and growth leaders building authentic, high-converting relationships on autopilot. 14 days free. Cancel anytime.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/login"
                className="w-full sm:w-auto h-13 px-8 text-base bg-white text-blue-900 hover:bg-slate-100 font-bold rounded-2xl shadow-xl transition-all inline-flex items-center justify-center"
              >
                Start Free 14-Day Trial
              </Link>
              <Link
                to="/login"
                className="text-sm font-semibold text-white/90 hover:text-white px-4 py-2"
              >
                Already have an account? Sign In →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* 11. Footer */}
      {/* --------------------------------------------------------------------- */}
      <footer className="relative z-10 border-t border-slate-800 bg-[#060911] py-12 px-4 sm:px-6 lg:px-8 text-xs text-slate-400">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <button
            type="button"
            onClick={scrollToTop}
            className="flex items-center gap-2 hover:opacity-85 transition-opacity cursor-pointer text-left"
            aria-label="Kestrel - Scroll to top"
          >
            <Sparkles className="h-4 w-4 text-cyan-400" />
            <span className="font-bold text-white text-sm">Kestrel</span>
            <span className="text-slate-600">·</span>
            <span>Autonomous AI Co-Pilot for Safe LinkedIn Growth</span>
          </button>

          <div className="flex items-center gap-6">
            <a href="#features" className="hover:text-white transition-colors">
              Features
            </a>
            <a href="#safety" className="hover:text-white transition-colors">
              Safety
            </a>
            <a href="#pricing" className="hover:text-white transition-colors">
              Pricing
            </a>
            <Link to="/login" className="hover:text-white transition-colors">
              Sign In
            </Link>
          </div>

          <p className="text-slate-500">
            © {new Date().getFullYear()} All rights reserved.
          </p>
        </div>
      </footer>

      {/* --------------------------------------------------------------------- */}
      {/* Book a Demo Modal */}
      {/* --------------------------------------------------------------------- */}
      {demoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-lg rounded-3xl border border-slate-800 bg-[#0c1324] p-6 sm:p-8 shadow-2xl overflow-hidden">
            {/* Modal Glow Accent */}
            <div className="absolute top-0 right-0 w-48 h-48 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />

            {/* Close Button */}
            <button
              type="button"
              onClick={() => setDemoModalOpen(false)}
              className="absolute top-5 right-5 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            {demoSubmitted ? (
              <div className="text-center py-8 space-y-4">
                <div className="h-16 w-16 mx-auto rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <h3 className="text-2xl font-bold text-white">Demo Request Received!</h3>
                <p className="text-sm text-slate-300 max-w-md mx-auto leading-relaxed">
                  Thank you, <strong className="text-white">{demoForm.name || 'there'}</strong>! Our LinkedIn growth specialist will review your request and send calendar invite options to{' '}
                  <strong className="text-cyan-400">{demoForm.email}</strong> within 2 business hours.
                </p>
                <div className="pt-4">
                  <button
                    type="button"
                    onClick={() => setDemoModalOpen(false)}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl text-sm transition-all cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">
                    Live 1-on-1 Walkthrough
                  </span>
                </div>
                <h3 className="text-2xl font-bold text-white">Book a Product Demo</h3>
                <p className="text-xs sm:text-sm text-slate-400 mt-1 mb-6">
                  See how our platform safely automates authentic LinkedIn prospect warming and connection notes for your pipeline.
                </p>

                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    setDemoSubmitted(true)
                  }}
                  className="space-y-4"
                >
                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                      Your Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Alex Morgan"
                      value={demoForm.name}
                      onChange={(e) => setDemoForm({ ...demoForm, name: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700/80 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                      Work Email *
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="alex@company.com"
                      value={demoForm.email}
                      onChange={(e) => setDemoForm({ ...demoForm, email: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700/80 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                        Company Name *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Acme Corp"
                        value={demoForm.company}
                        onChange={(e) => setDemoForm({ ...demoForm, company: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700/80 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                        Team Size
                      </label>
                      <select
                        value={demoForm.teamSize}
                        onChange={(e) => setDemoForm({ ...demoForm, teamSize: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700/80 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
                      >
                        <option value="1-10">1–10 employees</option>
                        <option value="11-50">11–50 employees</option>
                        <option value="51-200">51–200 employees</option>
                        <option value="200+">200+ employees</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                      Primary Goal or Target Audience (Optional)
                    </label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Target B2B SaaS Founders in US/UK without getting account restricted"
                      value={demoForm.notes}
                      onChange={(e) => setDemoForm({ ...demoForm, notes: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors resize-none"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-3 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-400 text-white font-semibold rounded-xl shadow-lg shadow-blue-600/30 text-sm transition-all flex items-center justify-center gap-2 mt-2 cursor-pointer"
                  >
                    <Calendar className="h-4 w-4" />
                    <span>Confirm Demo Request</span>
                  </button>

                  <p className="text-[11px] text-slate-400 text-center mt-2">
                    🔒 No obligation. 100% platform-safe walkthrough tailored to your ICP.
                  </p>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
