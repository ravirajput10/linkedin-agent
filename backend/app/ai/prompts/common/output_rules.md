# Output Rules

- Return exactly one JSON object. Nothing before it, nothing after it.
- Do not wrap the JSON in markdown code fences.
- Do not add commentary, preamble, apology or explanation outside the JSON.
- Use the exact field names given in the schema. Do not invent extra fields.
- Use `null` only where the schema permits it. Prefer empty arrays over `null` for list fields.
- Numeric scores are integers from 0 to 100 inclusive.
- Every free-text field must be plain prose. No markdown headings, no bullet lists, no emoji.
- If you are uncertain, still return a well-formed object and express the uncertainty
  through a lower score and an honest `reason`.
