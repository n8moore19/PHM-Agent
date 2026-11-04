# PHM Coach worker (live Claude)

A small Cloudflare Worker that lets the PHM Coach talk to Claude. The website sends the
conversation plus the checkpoint briefing; the worker adds the secret API key and the
source documents, asks Claude, and returns the coach's reply and a report of what the
learner showed. The key and the source documents never appear on the public website.

Until this is set up, the site uses its built-in demo coach, and it falls back to the
demo coach automatically if the worker is ever unreachable.

## Setup (about 10 minutes)

1. **Anthropic API key**: console.anthropic.com → add credit, set a monthly spend limit,
   create a key. Keep it private.
2. **Cloudflare account**: free at dash.cloudflare.com.
3. **Deploy** from Terminal:

   ```bash
   cd ~/phm-learning-agent/worker
   npm install
   npx wrangler login
   npx wrangler deploy                       # prints the worker URL
   npx wrangler secret put ANTHROPIC_API_KEY # paste the key when asked
   ```

4. **Connect the site**: put that URL in `docs/config.js`
   (`window.PHM_AI_URL = 'https://phm-coach-ai.<you>.workers.dev';`) and push.

## Settings (wrangler.toml)

- `MODEL` / `EFFORT`: `claude-opus-5-5` at `medium` effort by default.
- `ALLOWED_ORIGINS`: sites allowed to call the worker.

## Safety

- Only the allowed site can call the worker; each visitor is limited to about 20 messages a minute.
- The spend limit in the Anthropic console is the real backstop. Set it.
- The coach's report is checked by the site's checkpoint, which ignores any id it doesn't know.
