# Repository governance development rules

- Use Node.js 22 for development and verification.
- Keep each change small, reviewable, and paired with its tests, documentation, and CI updates.
- The Initializer may only create scaffolding. Coding work must implement one planned feature node at a time.
- `feature-list.json` is the implementation ledger. After initialization, Coding work may only change its `passes` fields.
- Never modify or enroll existing repositories while developing or testing this project. Hook and template tests must use isolated temporary homes and repositories.
- Never add secrets, telemetry, or implicit network access. Push hooks must remain fully offline.
- Run the fastest relevant test first, then the complete test suite before each planned commit.

