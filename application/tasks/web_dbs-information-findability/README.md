# DBS information findability

This Playwright web task measures whether a persona can find eight kinds of public information on the DBS Singapore Personal Banking site in one ordered session. The primary artifact stores objective navigation telemetry; `user_feedback.json` stores subjective expectations, confidence, friction, and usability judgments. The verifier checks provenance and internal consistency rather than volatile product names or rates.

The reference oracle uses one browser context, never logs in or submits forms, and records unavailable information as an honest failed step.
