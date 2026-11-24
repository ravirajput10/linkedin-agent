import { Card, Field, Input, Textarea } from '@/components/ui'
import { TagEditor } from '@/components/TagEditor'
import type { Criteria } from '@/types/api'

type Update = <K extends keyof Criteria>(key: K, value: Criteria[K]) => void

/**
 * The review surface for everything the parser proposed.
 *
 * Nothing here is applied silently — the user sees each list and number the AI
 * produced and can change any of it before the campaign runs.
 */
export function CriteriaEditor({
  criteria,
  onChange,
}: {
  criteria: Criteria
  onChange: (next: Criteria) => void
}) {
  const update: Update = (key, value) => onChange({ ...criteria, [key]: value })

  return (
    <div className="space-y-4">
      <Card title="Target people">
        <div className="grid gap-5 sm:grid-cols-2">
          <TagEditor
            label="Job titles"
            values={criteria.job_titles}
            onChange={(next) => update('job_titles', next)}
          />
          <TagEditor
            label="Seniority levels"
            values={criteria.seniority_levels}
            onChange={(next) => update('seniority_levels', next)}
          />
          <TagEditor
            label="Industries"
            values={criteria.industries}
            onChange={(next) => update('industries', next)}
          />
          <TagEditor
            label="Locations"
            values={criteria.locations}
            onChange={(next) => update('locations', next)}
          />
          <TagEditor
            label="Profile keywords"
            values={criteria.people_keywords}
            onChange={(next) => update('people_keywords', next)}
          />
          <TagEditor
            label="Company sizes"
            values={criteria.company_sizes}
            onChange={(next) => update('company_sizes', next)}
          />
        </div>

        <div className="mt-5 max-w-xs">
          <Field
            label="Minimum candidate match score"
            hint="Below this, the person is skipped without any engagement."
          >
            <Input
              type="number"
              min={0}
              max={100}
              value={criteria.minimum_candidate_score}
              onChange={(event) =>
                update('minimum_candidate_score', Number(event.target.value))
              }
            />
          </Field>
        </div>
      </Card>

      <Card title="Post criteria">
        <div className="grid gap-5 sm:grid-cols-2">
          <TagEditor
            label="Include topics"
            values={criteria.include_topics}
            onChange={(next) => update('include_topics', next)}
          />
          <TagEditor
            label="Exclude topics"
            values={criteria.exclude_topics}
            onChange={(next) => update('exclude_topics', next)}
          />
          <TagEditor
            label="Include keywords"
            values={criteria.include_keywords}
            onChange={(next) => update('include_keywords', next)}
          />
          <TagEditor
            label="Exclude keywords"
            values={criteria.exclude_keywords}
            onChange={(next) => update('exclude_keywords', next)}
          />
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <Field label="Minimum relevance score">
            <Input
              type="number"
              min={0}
              max={100}
              value={criteria.minimum_relevance_score}
              onChange={(event) =>
                update('minimum_relevance_score', Number(event.target.value))
              }
            />
          </Field>
          <Field label="Minimum post age (hours)" hint="Leave blank for no minimum.">
            <Input
              type="number"
              min={0}
              value={criteria.min_post_age_hours ?? ''}
              onChange={(event) =>
                update(
                  'min_post_age_hours',
                  event.target.value === '' ? null : Number(event.target.value),
                )
              }
            />
          </Field>
          <Field label="Maximum post age (days)">
            <Input
              type="number"
              min={1}
              value={criteria.max_post_age_days ?? ''}
              onChange={(event) =>
                update(
                  'max_post_age_days',
                  event.target.value === '' ? null : Number(event.target.value),
                )
              }
            />
          </Field>
        </div>

        <div className="mt-5">
          <TagEditor
            label="Allowed post types"
            values={criteria.post_types}
            onChange={(next) => update('post_types', next)}
            placeholder="TEXT, ARTICLE, IMAGE, VIDEO, POLL — empty means all standard types"
          />
        </div>
      </Card>

      <Card title="Engagement">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Initial posts to like"
            hint="Liked without an AI relevance check, as they already passed the eligibility filter."
          >
            <Input
              type="number"
              min={0}
              max={10}
              value={criteria.initial_posts_to_like}
              onChange={(event) => update('initial_posts_to_like', Number(event.target.value))}
            />
          </Field>
          <Field label="Post to evaluate with AI" hint="Position in the eligible-post sequence.">
            <Input
              type="number"
              min={1}
              max={20}
              value={criteria.evaluate_post_index}
              onChange={(event) => update('evaluate_post_index', Number(event.target.value))}
            />
          </Field>
        </div>

        <div className="mt-4 space-y-2">
          <Checkbox
            label="Like the evaluated post when it is judged relevant"
            checked={criteria.like_evaluated_post_if_relevant}
            onChange={(checked) => update('like_evaluated_post_if_relevant', checked)}
          />
          <Checkbox
            label="Generate a comment on the evaluated post"
            checked={criteria.generate_comment}
            onChange={(checked) => update('generate_comment', checked)}
          />
        </div>

        <div className="mt-5 rounded-md border border-border-subtle bg-surface-muted p-3">
          <p className="text-xs font-medium text-ink">Ignore the relevance score</p>
          <p className="mt-1 mb-3 text-xs text-ink-muted">
            The post is always scored and the score is always saved. Tick these to act
            on it <em>regardless</em> of the score &mdash; the person already passed
            evaluation, and what they happened to post today need not decide it.
          </p>
          <div className="space-y-2">
            <Checkbox
              label="Like the post even when it scores below the threshold"
              checked={!criteria.require_relevance_for_like}
              onChange={(checked) => update('require_relevance_for_like', !checked)}
            />
            <Checkbox
              label="Comment even when the post scores below the threshold"
              checked={!criteria.require_relevance_for_comment}
              onChange={(checked) => update('require_relevance_for_comment', !checked)}
            />
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            {criteria.require_relevance_for_like
              ? `Unticked: a post scoring under ${criteria.minimum_relevance_score} is not liked.`
              : 'Ticked: every eligible post is liked, whatever it scores.'}
          </p>
          {!criteria.require_relevance_for_comment && (
            <p className="mt-1 text-xs text-caution">
              Comments on off-topic posts are the hardest for the AI to write well.
              Read these carefully before approving.
            </p>
          )}
        </div>
      </Card>

      <Card title="Comment settings">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Length">
            <Select
              value={criteria.comment_length}
              options={['SHORT', 'MEDIUM', 'LONG']}
              onChange={(value) => update('comment_length', value as Criteria['comment_length'])}
            />
          </Field>
          <Field label="Style">
            <Select
              value={criteria.comment_style}
              options={['PROFESSIONAL', 'TECHNICAL', 'CONVERSATIONAL']}
              onChange={(value) => update('comment_style', value as Criteria['comment_style'])}
            />
          </Field>
          <Field label="Approval">
            <Select
              value={criteria.comment_approval}
              options={['REQUIRED', 'AUTOMATIC']}
              onChange={(value) =>
                update('comment_approval', value as Criteria['comment_approval'])
              }
            />
          </Field>
        </div>
      </Card>

      <Card title="Connection settings">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Connection delay (hours)">
            <Input
              type="number"
              min={0}
              max={720}
              value={criteria.connection_delay_hours}
              onChange={(event) => update('connection_delay_hours', Number(event.target.value))}
            />
          </Field>
          <Field label="Message">
            <Select
              value={criteria.connection_message_mode}
              options={['AI_GENERATED', 'TEMPLATE', 'NONE']}
              onChange={(value) =>
                update('connection_message_mode', value as Criteria['connection_message_mode'])
              }
            />
          </Field>
          <Field label="Approval">
            <Select
              value={criteria.connection_approval}
              options={['REQUIRED', 'AUTOMATIC']}
              onChange={(value) =>
                update('connection_approval', value as Criteria['connection_approval'])
              }
            />
          </Field>
        </div>

        {criteria.connection_message_mode === 'TEMPLATE' && (
          <div className="mt-4">
            <Field
              label="Message template"
              hint="Supports {{first_name}} and {{company}}. Maximum 300 characters."
            >
              <Textarea
                rows={3}
                maxLength={300}
                value={criteria.connection_message_template ?? ''}
                onChange={(event) =>
                  update('connection_message_template', event.target.value || null)
                }
              />
            </Field>
          </div>
        )}

        <div className="mt-4">
          <Checkbox
            label="Revalidate the person before sending the connection request"
            checked={criteria.revalidate_before_connection}
            onChange={(checked) => update('revalidate_before_connection', checked)}
          />
        </div>
      </Card>

      <Card title="Rate limits">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="People per day">
            <Input
              type="number"
              min={1}
              value={criteria.max_people_per_day}
              onChange={(event) => update('max_people_per_day', Number(event.target.value))}
            />
          </Field>
          <Field label="People per run">
            <Input
              type="number"
              min={1}
              value={criteria.max_people_per_run}
              onChange={(event) => update('max_people_per_run', Number(event.target.value))}
            />
          </Field>
          <Field label="Likes per day">
            <Input
              type="number"
              min={0}
              value={criteria.max_likes_per_day}
              onChange={(event) => update('max_likes_per_day', Number(event.target.value))}
            />
          </Field>
          <Field label="Comments per day">
            <Input
              type="number"
              min={0}
              value={criteria.max_comments_per_day}
              onChange={(event) => update('max_comments_per_day', Number(event.target.value))}
            />
          </Field>
          <Field label="Connections per day">
            <Input
              type="number"
              min={0}
              value={criteria.max_connections_per_day}
              onChange={(event) => update('max_connections_per_day', Number(event.target.value))}
            />
          </Field>
          <Field label="Action delay (seconds)" hint="Minimum and maximum pause between actions.">
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                aria-label="Minimum action delay"
                value={criteria.min_action_delay_seconds}
                onChange={(event) =>
                  update('min_action_delay_seconds', Number(event.target.value))
                }
              />
              <Input
                type="number"
                min={0}
                aria-label="Maximum action delay"
                value={criteria.max_action_delay_seconds}
                onChange={(event) =>
                  update('max_action_delay_seconds', Number(event.target.value))
                }
              />
            </div>
          </Field>
        </div>
      </Card>
    </div>
  )
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 rounded border-border-subtle text-accent focus:ring-accent/30"
      />
      {label}
    </label>
  )
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-md border border-border-subtle bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option.replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  )
}
