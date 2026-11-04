# PHM Coach (prototype)

A conversational trainer for Southlake Health's PHM Champion process, Stage 1. Built by Ivey MSc AFP Team 25. Design spec: *PHM Coach: Learner Journey Map* (shared doc).

The coach doesn't answer from documents. It walks a learner through six stages and asks questions that get them thinking. A **background checkpoint** records which key points the learner has shown in their own words. The checkpoint, not the model, decides when the learner moves on and when they are **PHM Trained**.

## Open it

- **Online:** GitHub Pages serves the `docs/` folder. Add `?team=1` to the URL to see the checkpoint panel.
- **Locally:** `npm start`, then open http://localhost:8000.
- **Tests:** `npm test` checks the checkpoint rules and walks a scripted learner to PHM Trained.

Until the live coach is connected, the site runs the **built-in demo coach**. It follows the same journey with simple keyword rules, so the flow can be shown anywhere. To switch on the real coach (Claude), deploy the Worker in `worker/` and paste its URL into `docs/config.js`. See [worker/README.md](worker/README.md).

## Layout

| Path | What it is |
| --- | --- |
| `docs/index.html`, `docs/app.js` | The website: chat, progress track, learner ID, team panel, share-by-email |
| `docs/journey.json` | Stages, key points, exit rules, perspective tests, 20 traps, the 20 reflection questions. Edit wording here; keep ids stable. |
| `docs/lib/checkpoint.js` | The background checkpoint (shared by the site and the tests) |
| `docs/lib/offline.js` | The built-in demo coach |
| `docs/config.js` | `PHM_AI_URL`: empty for demo mode, the Worker URL for the live coach |
| `worker/` | Cloudflare Worker that holds the API key and the source documents, and asks Claude |
| `worker/content/` | The sources the coach is grounded in: Definitions Library, Tools Intro, Synthesis extract, Framework Reference, Nurse Dialogue Bank, coaching themes from the training sessions (anonymized). Bundled into the Worker; never served by the website. |
| `test/` | Node tests |

## Learner data

Each learner gets a six-digit ID; no name is stored. Progress is saved in the learner's own browser under that ID. Sharing with PHM Advance (name, progress, Certified write-up) is opt-in and opens an email to PHMAdvance@southlake.ca. A central log and weekly review for the PHM team would need storage on the Worker side; that is the next step once the live coach is on.

## Open decisions

See the sign-off table in the Journey Map: what "Trained" and "Champion" mean, the subgroup rule versus the Definitions Library, which local programs can be named, the escalation turnaround, and the "nano" moment-of-interaction layer.
