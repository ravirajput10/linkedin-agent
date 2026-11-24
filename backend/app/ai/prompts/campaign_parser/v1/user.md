# Campaign Brief

Convert the following instruction into structured campaign criteria.

## Instruction from the user

{{instruction}}

## Defaults

Use these values for any engagement setting the instruction does not specify.

- Initial posts to like before evaluating: {{default_initial_likes}}
- Which post to evaluate with AI: post number {{default_evaluate_index}}
- Minimum relevance score: {{default_relevance_score}}
- Connection delay: {{default_connection_delay_hours}} hours
- Maximum people per day: {{default_max_people_per_day}}

Return the `ParsedCampaign` object.
