# DBS information findability (CocoaAgent)

This is the standalone CocoaAgent variant of the DBS Singapore Personal Banking
findability task. It runs in the shared AIO Sandbox, and `persona-cocoa` connects
to the browser service at `localhost:8080`.

- Start URL: https://www.dbs.com.sg/personal/default.page
- Objective output: `/app/output/dbs_information_findability.json`
- Persona reflection: `/app/output/user_feedback.json`
- Screenshot trace: `jobs/<job>/<trial>/agent/images/step_*.png`

The Cocoa trajectory adapter captures the browser screenshot associated with
each recorded action and references it from `agent/trajectory.json`. Playground
can consequently display the screenshots alongside the web trace. Screenshots
are trial evidence rather than files the persona must manually create.

The primary JSON artifact stores objective navigation telemetry. The reflection
stores subjective expectations, confidence, friction, and usability judgments.
The verifier checks provenance and internal consistency instead of hard-coding
volatile product names, rates, or page titles.

## Run with the local Cocoa recipe

```bash
uv run harbor run \
  -c configs/jobs/example-job-recipe/appSim-web-dbs-information-findability-cocoa-local.yaml
```

The task can also be launched directly:

```bash
uv run harbor run \
  -a persona-cocoa \
  -m anthropic/claude-sonnet-4-6 \
  --ak persona_path=persona/datasets/matraix-persona-dev-sample/persona_0042.yaml \
  -p application/tasks/web_dbs-information-findability-cocoa \
  --env-file .env
```

The reference oracle remains an independent Playwright implementation inside
the Cocoa task image, matching the pattern used by
`example-web-cocoa_plan-choice`:

```bash
uv run harbor run \
  -p application/tasks/web_dbs-information-findability-cocoa \
  -a oracle
```

## Requirements

- Docker on the host
- Outbound network access for the in-container browser
- A provider API key in the environment
- On Apple Silicon, Docker support for the environment's pinned `linux/amd64`
  image
