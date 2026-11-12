import { and, desc, eq, gte } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import type { ChatMessage } from '@/lib/ai/provider'
import { citationRules, generateCitedAnswer, githubKind, SourceRegistry, type CitedAnswer } from '@/lib/ai/citations'

/**
 * Marina AI for the individual — "ask anything about your own work".
 *
 * The un-ChatGPT-able part: it's grounded in the person's OWN accumulated data
 * (their GitHub activity, meetings + who they were with, and logged
 * deliverables), so it can actually answer "how many meetings did I have with
 * Suresh last week?" or "which navbar PRs got merged?". Org-free.
 */

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

const SYSTEM = [
  'You are Marina, a personal work assistant for ONE individual.',
  'Answer questions about this person\'s own work using ONLY the JSON data provided',
  '(their GitHub activity, calendar meetings with attendees, and logged deliverables).',
  'Be concise and specific: when asked to count or filter (e.g. meetings with a person,',
  'PRs about a feature, what shipped), filter the data yourself and give the number plus a',
  'short supporting list. Match names/keywords case-insensitively and loosely.',
  'If the data does not contain the answer, say so plainly — never invent activity.',
  'Today is ' + new Date().toISOString().slice(0, 10) + '. The data covers the last 90 days.',
].join(' ') + '\n\n' + citationRules({ allowProduct: false })

function emailLocal(email: string): string {
  const local = (String(email).split('@')[0] ?? '').trim()
  return local.replace(/[._-]+/g, ' ')
}

export async function buildMyContext(userId: number, registry: SourceRegistry = new SourceRegistry()): Promise<string> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const [events, meetings, delivs] = await Promise.all([
    db
      .select({ id: schema.githubEvents.id, url: schema.githubEvents.url, type: schema.githubEvents.type, title: schema.githubEvents.title, repo: schema.githubEvents.repo, occurredAt: schema.githubEvents.occurredAt, raw: schema.githubEvents.raw })
      .from(schema.githubEvents)
      .where(and(eq(schema.githubEvents.userId, userId), gte(schema.githubEvents.occurredAt, since)))
      .orderBy(desc(schema.githubEvents.occurredAt))
      .limit(250),
    db
      .select({ id: schema.meetings.id, title: schema.meetings.title, startAt: schema.meetings.startAt, endAt: schema.meetings.endAt, attendees: schema.meetings.attendees })
      .from(schema.meetings)
      .where(and(eq(schema.meetings.userId, userId), gte(schema.meetings.startAt, since)))
      .orderBy(desc(schema.meetings.startAt))
      .limit(150),
    db
      .select({ id: schema.deliverables.id, url: schema.deliverables.url, title: schema.deliverables.title, kind: schema.deliverables.kind, completedAt: schema.deliverables.completedAt })
      .from(schema.deliverables)
      .where(and(eq(schema.deliverables.userId, userId), gte(schema.deliverables.completedAt, since)))
      .orderBy(desc(schema.deliverables.completedAt))
      .limit(150),
  ])

  const ctx = {
    window: 'last 90 days',
    github: events.map((e) => ({
      src: registry.add(githubKind(e.type), e.id, {
        label: `${e.type === 'commit' ? 'Commit' : e.type === 'pr_opened' ? 'PR' : e.type === 'pr_reviewed' ? 'Review' : 'Issue'} in ${e.repo}: ${e.title}`,
        url: e.url,
        date: e.occurredAt.toISOString().slice(0, 10),
      }),
      kind: e.type,
      title: e.title,
      repo: e.repo,
      status: (e.raw as { status?: string } | null)?.status ?? undefined,
      date: e.occurredAt.toISOString().slice(0, 10),
    })),
    meetings: meetings.map((m) => ({
      src: registry.add('meeting', m.id, {
        label: `Calendar event: ${m.title}`,
        date: m.startAt.toISOString().slice(0, 10),
      }),
      title: m.title,
      minutes: Math.max(0, Math.round((m.endAt.getTime() - m.startAt.getTime()) / 60000)),
      with: (m.attendees ?? []).map(emailLocal).filter(Boolean),
      date: m.startAt.toISOString().slice(0, 10),
    })),
    deliverables: delivs.map((d) => ({
      src: registry.add('deliverable', d.id, {
        label: `Logged deliverable: ${d.title}`,
        url: d.url ?? undefined,
        date: d.completedAt.toISOString().slice(0, 10),
      }),
      title: d.title, kind: d.kind ?? undefined, date: d.completedAt.toISOString().slice(0, 10) })),
  }
  return JSON.stringify(ctx)
}

export async function chatAboutMe(input: { userId: number; history: ChatTurn[]; question: string }): Promise<CitedAnswer> {
  const registry = new SourceRegistry()
  const ctx = await buildMyContext(input.userId, registry)
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM },
    { role: 'system', content: `Your work data (JSON):\n${ctx}` },
    ...input.history.slice(-6).map<ChatMessage>((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: input.question },
  ]
  return generateCitedAnswer(messages, registry, { allowProduct: false, maxTokens: 1000 })
}
