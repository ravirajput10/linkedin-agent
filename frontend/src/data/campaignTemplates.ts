export interface CampaignTemplate {
  id: string
  name: string
  category: string
  badgeColor: string
  summary: string
  sequenceFlow: string[]
  recommendedLimit: string
  instruction: string
}

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    id: 'founder-outreach',
    name: 'Founder & Executive Warm Outreach',
    category: 'Executive',
    badgeColor: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
    summary: 'Warm relationship sequence for startup founders, CEOs, and corporate executives.',
    sequenceFlow: ['Like 2 Posts', 'AI Leadership Comment', 'Wait 24h', 'Personalized Connection Note'],
    recommendedLimit: '15 prospects / day',
    instruction: `Find SaaS Founders, Co-Founders, and CEOs in North America and Western Europe posting about product growth, enterprise sales, or scaling SaaS.

Like their first two recent posts. On their third post, evaluate with AI and write a concise, thoughtful comment acknowledging their insight.

Wait 24 hours, then send a tailored connection request referencing their post topic.

Process up to 15 people per day.`,
  },
  {
    id: 'tech-talent',
    name: 'Technical Talent & Senior Hiring',
    category: 'Engineering & AI',
    badgeColor: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    summary: 'Targeted engagement for senior engineers, engineering managers, and technical leads.',
    sequenceFlow: ['Like 1 Post', 'AI Technical Comment', 'Wait 48h', 'Connection with Note'],
    recommendedLimit: '12 prospects / day',
    instruction: `Find Staff Engineers, Principal Engineers, Engineering Managers, and Tech Leads posting about Python, distributed systems, AI engineering, or microservices architecture.

Like their most recent technical post. Generate a short, insightful technical comment discussing architecture trade-offs.

Wait 48 hours, then send a personalized connection note expressing interest in their engineering background.

Process up to 12 people per day.`,
  },
  {
    id: 'event-followup',
    name: 'Event & Webinar Attendee Follow-up',
    category: 'Events & Conferences',
    badgeColor: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
    summary: 'Rapid follow-up sequence for attendees, speakers, and organizers of relevant industry events.',
    sequenceFlow: ['Like 1 Post', 'Connect with Note', 'Wait 72h', 'Follow-up Insight Message'],
    recommendedLimit: '20 prospects / day',
    instruction: `Find attendees, speakers, and organizers who recently posted or commented about enterprise AI conferences, SaaS webinars, or industry summits.

Like their post about the event. Send an immediate connection request mentioning shared interest in the event topics.

After 72 hours if connected, send a short follow-up message sharing a key takeaway or relevant resource.

Process up to 20 people per day.`,
  },
  {
    id: 'thought-leadership',
    name: 'Thought Leadership Relationship Builder',
    category: 'B2B GTM & Sales',
    badgeColor: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    summary: 'Multi-touch nurturing sequence for VP of Sales, Heads of Marketing, and GTM leaders.',
    sequenceFlow: ['Follow Profile', 'Like 2 Posts', 'Engage Top Post', 'Wait 48h', 'Connect'],
    recommendedLimit: '10 prospects / day',
    instruction: `Find VPs of Sales, Heads of Growth, and CMOs in B2B SaaS discussing pipeline generation, outbound strategy, and enterprise customer acquisition.

Follow their profile and like their top 2 posts. Engage with an insightful comment on their most shared post.

Wait 48 hours and send a personalized connection request praising their perspective.

Process up to 10 people per day.`,
  },
]

