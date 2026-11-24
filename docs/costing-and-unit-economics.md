# Kestrel — Architecture Costing & Unit Economics Model

**Document Version:** 1.0.0  
**Date:** October 26, 2026  
**Author:** Ravi Rajput  
**Target Product:** LinkedIn AI Agent ("Kestrel")  

---

## Executive Summary & Quick Reference Table

### 1-Minute Executive Overview

#### 1. Fixed & Infrastructure Costs
| Component | What You Pay | Ongoing Monthly Cost | Business Impact |
| :--- | :--- | :--- | :--- |
| **Chrome Web Store** | **$5.00** *(One-time lifetime)* | **$0.00 / mo** | Lifetime publishing access; Google takes 0% commission. |
| **DigitalOcean Hosting** | **$28.00 / mo** *(Flat)* | **~$0.28 / user** *(at 100 users)* | 2 vCPU / 4 GB RAM handles 150–300 active users easily. |
| **Cloudflare & Turnstile** | **$0.00** *(Free Tier)* | **$0.00 / mo** | Unlimited anti-bot challenges and DDoS protection at zero cost. |
| **Outreach Execution** | **$0.00** *(Chrome Extension)* | **$0.00 / mo** | Executes directly inside the user's browser; **$0 proxy bills**. |

#### 2. Per-Action AI Compute Cost
Every single AI interaction costs **fractions of a single penny**:
- 🟢 **Evaluating 1 Prospect Profile**: **0.06¢** *(Score 16 profiles for just 1 penny)*
- 🟡 **Writing 1 Custom AI Post Comment**: **0.39¢** *(Get ~3 bespoke comments for 1 penny)*
- 🟡 **Writing 1 Connection Note**: **0.23¢** *(Get ~4 custom notes for 1 penny)*
- 🟡 **Complete 4-Step Warming Sequence**: **0.62¢** *(View + Like + Comment + Note all for under 1 cent)*
- 🔵 **Generating 3 Full LinkedIn Posts**: **1.34¢** *(1.3 cents for a 3-pack thought leadership post)*

#### 3. Real Customer Profit Margins
| Customer Plan | Customer Pays You | What They Actually Cost You (AI + Server) | Your Gross Profit | Profit Margin |
| :--- | :--- | :--- | :--- | :--- |
| **Starter Plan** | **$39.00 / month** | **$0.91 / month** | **+$38.09 / user** | **97.7% Margin** |
| **Growth Plan** *(Most Popular)* | **$79.00 / month** | **$2.58 / month** | **+$76.42 / user** | **96.7% Margin** |
| **Scale / Agency Plan** | **$159.00 / month** | **$7.00 / month** | **+$152.00 / user** | **95.6% Margin** |

> **The Key Takeaway for Business Decisions**:  
> **For every $100 you collect from customers, your total cost of goods sold (COGS) is less than $4.00.**  
> Running the automation through the **Chrome Extension** rather than paying cloud proxy services (like Unipile or Bright Data) saves you €3–€5 per user every month, protecting **96%+ gross profit margins**.

---

### Component Breakdown Reference Table

| Category | Component / Provider | Unit Pricing Basis | Cost per Active User / Mo | Notes & Optimizations |
| :--- | :--- | :--- | :--- | :--- |
| **Chrome Web Store** | Google Developer Account | $5.00 one-time fee | **$0.00 / mo** (Free forever) | Zero per-download or monthly hosting fees. |
| **Hosting & Infra** | DigitalOcean Droplet | $28.00 / month flat | **$0.28 / user** (at 100 users) | 2 vCPU / 4 GB RAM handles 150–300 active users. |
| **Security & CDN** | Cloudflare & Turnstile | Free Tier ($0 / mo) | **$0.00 / mo** | Turnstile anti-bot is 100% free with unlimited checks. |
| **AI Reasoning** | Anthropic Claude API | $3.00/M in, $15.00/M out | **$0.75 – $2.80 / user** | Claude 3.5 Sonnet for comments; Haiku for candidate scoring. |
| **Outreach Execution** | Native Chrome Extension | Uses user's browser session | **$0.00 / user** (Zero proxy fees) | **Primary execution method**; zero recurring proxy bills. |
| **Cloud Bridge (Opt)**| Unipile (Cloud Accounts) | ~€2.50 – €4.00 / user / mo | **$2.75 / user** (if cloud chosen) | Only needed if user runs automation with laptop shut. |
| **Data Enrichment** | Bright Data (Optional) | ~$0.0015 / profile record | **$0.15 – $0.45 / user** | Only for off-LinkedIn cold lead batch discovery. |
| **Total COGS** | **All Combined** | **Extension-First Architecture** | **$1.03 – $3.53 / user / mo** | **Gross Margin: 91% – 97%** on $39 / $79 plans. |

---

## 1. Chrome Web Store Deployment Cost & Requirements

### 1.1 Store Registration Fee
- **Google Chrome Web Store Developer Fee**: **$5.00 USD (One-time lifetime payment)**.
- Paid via Google Pay / Credit Card when creating the publisher account.
- Allows publishing up to **20 public extensions** under the same organization account.
- **Zero Ongoing Fees**: Google does not charge any monthly fee, bandwidth fee, or per-download commission for extensions.

### 1.2 Store Publishing Requirements & Verification
1. **Developer Console Registration**: Register publisher profile at [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. **Privacy Policy Hosting**: Mandatory URL hosted publicly explaining that session cookies and profile URLs are used solely for user-requested LinkedIn outreach. (We host this at `app.kestrel.ai/privacy` or on our landing page footer).
3. **Manifest V3 Review Timeline**:
   - Initial review for new extensions requesting `cookies`, `tabs`, and `alarms` takes **2 to 3 business days**.
   - Subsequent bug fixes and minor updates typically get approved in **under 24 hours**.
4. **Permissions Audit**:
   - The Kestrel extension only requests `https://*.linkedin.com/*` and `https://*.kestrel.ai/*` host permissions. Restricting hosts to only these two origins ensures smooth and fast Chrome Web Store approval without manual compliance escalations.

---

## 2. AI Reasoning Cost Model (Anthropic Claude API)

Kestrel uses the Anthropic Claude API for high-converting, human-grade reasoning.

### 2.1 Model Token Rates

| Model | Input Tokens (per 1M) | Output Tokens (per 1M) | Prompt Caching Read (per 1M) | Best Used For |
| :--- | :--- | :--- | :--- | :--- |
| **Claude 3.5 Sonnet** | **$3.00** ($0.003 / 1k) | **$15.00** ($0.015 / 1k) | **$0.30** (90% discount!) | Bespoke Comments, Post Generation, Connection Notes |
| **Claude 3.5 Haiku** | **$0.80** ($0.0008 / 1k) | **$4.00** ($0.004 / 1k) | **$0.08** | Fast Candidate Fit Scoring, Sentiment Filter, Classification |

---

### 2.2 Cost per User Request & Action

#### Executive Decision Table (At a Glance)

| Workflow Phase | Specific User Request / Action | AI Model | Cost per Request ($ USD) | Cost per Request (Cents) | Cost per 1,000 Requests | Actions for $1.00 | Cost Rating |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Discovery & Search** | **Natural Language Audience Search** *(Prompt → Structured Filters)* | Claude 3.5 Sonnet | **$0.0045** | **0.45¢** | **$4.50** | **222 searches** | 🟡 Low |
| | **Candidate Fit Scoring** *(Per individual profile evaluation)* | Claude 3.5 Haiku | **$0.0006** | **0.06¢** | **$0.60** | **1,666 profiles** | 🟢 Micro |
| | **Batch Candidate Scoring** *(Full batch of 25 profiles)* | Claude 3.5 Haiku | **$0.0150** | **1.50¢** | **$15.00** | **66 batches (1,666 leads)** | 🟢 Micro |
| **2. Outreach & Warming** | **Bespoke Post Comment Drafting** *(Context-aware peer voice)* | Claude 3.5 Sonnet | **$0.0039** | **0.39¢** | **$3.90** | **256 comments** | 🟡 Low |
| | **Personalized Connection Note** *(<= 300 char custom note)* | Claude 3.5 Sonnet | **$0.0023** | **0.23¢** | **$2.30** | **444 notes** | 🟡 Low |
| | **Full 4-Step Warming Sequence** *(View + Like + Comment + Note)* | Extension + Sonnet | **$0.0062** | **0.62¢** | **$6.20** | **161 full prospects** | 🟡 Low |
| **3. Content & Setup** | **Content Studio Post Pack** *(3 full thought-leadership posts)* | Claude 3.5 Sonnet | **$0.0134** | **1.34¢** | **$13.40** | **75 packs (225 posts)** | 🔵 Standard |
| | **Voice Profile Calibration** *(Scans 20 past posts on onboarding)* | Claude 3.5 Sonnet | **$0.0180** | **1.80¢** | **$18.00** | **55 voice scans** | 🔵 Standard |

> **Cost Rating Legend**:  
> 🟢 **Micro (Under 0.1¢ / request)**: Candidate scoring ($0.60 per 1k) — *Negligible cost; evaluate thousands freely.*  
> 🟡 **Low (0.1¢ – 0.5¢ / request)**: Comments & Connection notes ($2.30 – $3.90 per 1k) — *High-converting core engine.*  
> 🔵 **Standard (1.0¢ – 2.0¢ / request)**: Post packs & Voice calibration — *Infrequent, high-value bulk operations.*

---

#### Real-World Monthly Customer Cost (What 1 Active User Actually Costs You)

To make clear pricing and margin decisions, here is the exact total AI + Hosting bill for real customer usage:

| Plan Tier | Typical Monthly Activity Breakdown | Total AI API Cost | $28/mo Droplet Share (at 100 users) | Total Monthly Cost (COGS) | Plan Retail Price | Gross Profit Margin |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Starter Plan** | 200 Candidate Scores + 100 Bespoke Comments + 50 Notes + 1 Audience Search | **$0.63 / mo** | **$0.28 / mo** | **$0.91 / user / mo** | **$39.00 / mo** | **97.7% Gross Margin** |
| **Growth Plan** *(Most Popular)* | 800 Candidate Scores + 350 Bespoke Comments + 150 Notes + 4 Audience Searches + 6 Post Packs | **$2.30 / mo** | **$0.28 / mo** | **$2.58 / user / mo** | **$79.00 / mo** | **96.7% Gross Margin** |
| **Scale / Agency Plan** | 2,500 Candidate Scores + 1,000 Bespoke Comments + 400 Notes + 15 Audience Searches + 20 Post Packs | **$6.72 / mo** | **$0.28 / mo** | **$7.00 / user / mo** | **$159.00 / mo** | **95.6% Gross Margin** |

---

#### Detailed Mathematical Breakdown by Action

#### Action A: Natural Language Prompt-to-Audience Parsing
- **Input**: User prompt + JSON schema instructions (~600 tokens)
- **Output**: Structured filter JSON (~180 tokens)
- **Claude 3.5 Sonnet Cost**:
  $$\text{Input: } 600 \times \$0.000003 = \$0.0018$$
  $$\text{Output: } 180 \times \$0.000015 = \$0.0027$$
  $$\mathbf{\text{Total Cost per Audience Search: }} \mathbf{\$0.0045} \text{ (Less than half a cent)}$$

#### Action B: Candidate Fit Scoring (Per Candidate)
- **Input**: Target persona criteria + Prospect headline, summary & experience (~450 tokens)
- **Output**: JSON with score (0-100), criteria matches, and 1-line reason (~60 tokens)
- **Claude 3.5 Haiku Cost**:
  $$\text{Input: } 450 \times \$0.0000008 = \$0.00036$$
  $$\text{Output: } 60 \times \$0.000004 = \$0.00024$$
  $$\mathbf{\text{Total Cost per Candidate Scored: }} \mathbf{\$0.00060} \text{ (6/100ths of a cent)}$$
  *(Scoring a full batch of 25 candidates costs just **$0.015**)*

#### Action C: Bespoke Post Comment Drafting
- **Input**: Author post context + top comments + user voice profile + "Never say" guardrails (~850 tokens)
- **Output**: Thoughtful comment text (~90 tokens)
- **Claude 3.5 Sonnet Cost**:
  $$\text{Input: } 850 \times \$0.000003 = \$0.00255$$
  $$\text{Output: } 90 \times \$0.000015 = \$0.00135$$
  $$\mathbf{\text{Total Cost per Generated Comment: }} \mathbf{\$0.00390} \text{ (~0.39 cents)}$$

#### Action D: Personalized Connection Note Generation
- **Input**: Prospect bio + interaction context (~500 tokens)
- **Output**: Concise connection note <= 300 characters (~50 tokens)
- **Claude 3.5 Sonnet Cost**:
  $$\text{Input: } 500 \times \$0.000003 = \$0.00150$$
  $$\text{Output: } 50 \times \$0.000015 = \$0.00075$$
  $$\mathbf{\text{Total Cost per Connection Note: }} \mathbf{\$0.00225} \text{ (~0.22 cents)}$$

#### Action E: Content Studio: 3 Long-Form Post Drafts
- **Input**: Topic/idea + content pillar guidelines + past post voice samples (~1,200 tokens)
- **Output**: 3 full post variations with hooks (~650 tokens)
- **Claude 3.5 Sonnet Cost**:
  $$\text{Input: } 1,200 \times \$0.000003 = \$0.0036$$
  $$\text{Output: } 650 \times \$0.000015 = \$0.00975$$
  $$\mathbf{\text{Total Cost per 3 Drafts: }} \mathbf{\$0.01335} \text{ (~1.3 cents)}$$

#### Action F: End-to-End Warming Sequence per Prospect (4 Days)
- **Day 1 (Profile View)**: Native Extension DOM action ($0.00)
- **Day 2 (Like Relevant Post)**: Native Extension DOM action ($0.00)
- **Day 3 (Bespoke Comment)**: Claude 3.5 Sonnet generated ($0.0039)
- **Day 4 (Connection Note)**: Claude 3.5 Sonnet generated ($0.0023)
- **Total Cost per Warmed Prospect**: **$0.0062** *(0.62 cents — over 160 prospects warmed per $1.00)*

---

## 3. Platform Data & Outreach Providers (Unipile vs. Bright Data vs. Chrome Extension)

Kestrel supports three integration pathways. Understanding their cost structure enables massive profit margins:

| Provider | Purpose | Pricing Structure | Monthly Cost Impact |
| :--- | :--- | :--- | :--- |
| **Native Chrome Extension** *(Default)* | **Outreach Execution (Likes, Comments, Invites, Profile Views)** | **$0.00 (Free)** | **$0.00 / user** — Runs inside the user's authentic browser session using their own IP and cookies. Zero proxy bills. |
| **Unipile** *(Cloud Option)* | 24/7 Cloud Background Execution without browser open | **€2.50 – €4.00 per account/mo** (~$2.75 – $4.40) | **$3.00 / user** — Optional for users who request cloud execution while their computer is off. |
| **Bright Data** *(Enrichment)* | Bulk search & profile scraping off-LinkedIn | **$0.0015 – $0.0025 per record** (or $1.50/1k records) | **$0.30 / user** — Only triggered when user imports external URLs or does wide off-session scraping. |

> **Architectural Recommendation**:  
> By making the **Chrome Extension the primary execution engine**, our direct outreach cost is **$0.00**. We only incur Unipile fees if the user explicitly upgrades to a "Cloud Background" plan.

---

## 4. DigitalOcean Hosting ($28/Month Droplet) Capacity & Sizing

You are currently hosting Kestrel on a **$28/month DigitalOcean Droplet**. Let's analyze how far this server takes us.

### 4.1 Droplet Specifications ($28/month)
- **vCPUs**: 2 Dedicated/Premium AMD or Intel vCPUs
- **RAM**: 4 GB Memory
- **Storage**: 80 GB NVMe SSD
- **Bandwidth**: 4 TB / month included transfer

### 4.2 Workload Running on the Droplet
1. **FastAPI Web Service**: 4 Uvicorn async worker processes (`~180 MB RAM`).
2. **PostgreSQL 16**: Relational database with connection pool capped at 30 connections (`~450 MB RAM`).
3. **Redis 7**: In-memory cache, rate limiter, and Celery message broker (`~120 MB RAM`).
4. **Celery Task Worker**: 2 concurrent background task workers for scheduling (`~220 MB RAM`).
5. **Nginx Reverse Proxy / SSL**: Handles HTTPS termination (`~50 MB RAM`).
- **Total Base Memory Footprint**: **~1.02 GB RAM** (leaving **~2.98 GB buffer** for traffic spikes).

### 4.3 Concurrent Capacity & Sizing Thresholds
- **Daily Action Frequency**: A single active LinkedIn campaign executes between 15 to 40 actions spread randomly over a 9-hour workday.
- That means an active user generates only **~2 to 5 requests per hour** to the backend.
- **Capacity Limits for a Single $28/mo Droplet**:
  - **Concurrent Web Requests**: FastAPI handles **~800 to 1,200 req/sec** asynchronously.
  - **Active Paying Users Supported**: **150 to 300 active users** simultaneously running campaigns without any degradation.
  - **Hosting Cost per User**:
    - At 50 active users: $\frac{\$28}{50} = \mathbf{\$0.56 / \text{user}}$
    - At 100 active users: $\frac{\$28}{100} = \mathbf{\$0.28 / \text{user}}$
    - At 250 active users: $\frac{\$28}{250} = \mathbf{\$0.11 / \text{user}}$

---

## 5. Cloudflare & Security Costs

| Feature | Plan | Cost | Capability |
| :--- | :--- | :--- | :--- |
| **Cloudflare Turnstile** | Free Tier | **$0.00 / mo** | Unlimited anti-bot challenges on `/login` and `/register`. Zero friction compared to Google reCAPTCHA. |
| **Cloudflare CDN & Proxy** | Free Tier | **$0.00 / mo** | Unlimited DDoS protection, global edge caching, SSL certificates, and Ray ID logging. |
| **Cloudflare WAF** *(Optional)* | Pro Plan ($20/mo) | **$20.00 / mo** | Optional upgrade only when crossing $10k+ MRR for managed OWASP rule sets. |

---

## 6. End-to-End Unit Economics per User Plan

Here is the exact monthly cost to service a customer compared to what they pay us:

### Plan 1: Starter Plan ($39 / month)
- **Usage Limits**: 2 active campaigns, 200 AI candidate evaluations, 60 comments, 30 connection notes.
- **Direct Costs**:
  - DigitalOcean Hosting Share: **$0.28**
  - Claude AI API (200 candidate scores + 90 drafts):
    - $200 \text{ evaluations} \times \$0.0006 = \$0.12$
    - $90 \text{ drafts} \times \$0.0039 = \$0.35$
    - Total AI Cost = **$0.47**
  - Outreach Execution: Extension Native = **$0.00**
  - Cloudflare & Turnstile: **$0.00**
- **Total Cost per User**: **$0.75 / month**
- **Gross Revenue**: **$39.00 / month**
- **Gross Profit**: **$38.25 / month (98.0% Gross Margin)**

---

### Plan 2: Growth Plan ($79 / month) — *Most Popular*
- **Usage Limits**: Unlimited campaigns, 800 AI candidate evaluations, 250 comments, 120 connection notes, 20 Content Studio posts.
- **Direct Costs**:
  - DigitalOcean Hosting Share: **$0.28**
  - Claude AI API (800 candidate scores + 370 drafts + 20 posts):
    - $800 \text{ evaluations} \times \$0.0006 = \$0.48$
    - $370 \text{ drafts} \times \$0.0039 = \$1.44$
    - $20 \text{ Content Studio posts} \times \$0.013 = \$0.26$
    - Total AI Cost = **$2.18**
  - Outreach Execution: Extension Native = **$0.00**
  - Cloudflare & Turnstile: **$0.00**
- **Total Cost per User**: **$2.46 / month**
- **Gross Revenue**: **$79.00 / month**
- **Gross Profit**: **$76.54 / month (96.8% Gross Margin)**

---

### Plan 3: Scale & Team Plan ($159 / month)
- **Usage Limits**: Multi-account workspaces, 2,500 evaluations, 800 comments, 400 notes, optional Unipile cloud sync.
- **Direct Costs**:
  - DigitalOcean Hosting Share: **$0.50**
  - Claude AI API: **$6.80**
  - Unipile Cloud Slot (if enabled): **$3.00**
- **Total Cost per User**: **$10.30 / month**
- **Gross Revenue**: **$159.00 / month**
- **Gross Profit**: **$148.70 / month (93.5% Gross Margin)**

---

## 7. Business Break-Even Analysis

With our current fixed server cost of **$28.00 / month**:

$$\text{Break-Even at Starter Plan (\$39/mo)}: \mathbf{1 \text{ paying customer}} \implies \text{Profitable on Customer \#1!}$$

- **At 10 Customers on Growth Plan ($79/mo)**:
  - Monthly Revenue: **$790.00**
  - Server Cost (DO): -$28.00
  - AI API Costs: -$24.60
  - **Net Profit**: **+$737.40 / month (93.3% margin)**

- **At 50 Customers on Growth Plan ($79/mo)**:
  - Monthly Revenue: **$3,950.00**
  - Server Cost (DO): -$28.00
  - AI API Costs: -$123.00
  - **Net Profit**: **+$3,799.00 / month (96.1% margin)**

- **At 200 Customers on Growth Plan ($79/mo)**:
  - Monthly Revenue: **$15,800.00**
  - Server Cost (DO Upgraded to $56/mo): -$56.00
  - AI API Costs: -$492.00
  - **Net Profit**: **+$15,252.00 / month (96.5% margin)**

---

## 8. 4 Golden Rules for Cost Optimization

1. **Leverage Claude Prompt Caching**:
   - Claude allows caching system instructions and persona profiles. Repeated calls against the same cached prompt drop input token costs by **90%** (from $3.00/M to $0.30/M).
2. **Use Claude 3.5 Haiku for Candidate Scoring**:
   - Never use Claude 3.5 Sonnet for binary classification or fit scoring. Haiku is 4x cheaper and 3x faster, delivering identical scoring accuracy.
3. **Prioritize Native Chrome Extension Execution**:
   - Executing actions via the Chrome extension avoids third-party proxy costs completely, keeping delivery cost at **$0.00**.
4. **Cloudflare Turnstile over Google reCAPTCHA**:
   - Google reCAPTCHA Enterprise charges $1.00 per 1,000 calls past the free tier. Cloudflare Turnstile is **100% free with unlimited validations**.
