# AI choreographer – how it fits in

The "3. AI choreographer" box on the website already sends your prompt to `/api/choreograph`.
`server.js` (repo root, next to the `website` folder) is what answers that call.

1. Install Node (once): https://nodejs.org -> LTS. Check with `node -v` (needs 18+).
2. Copy `.env.example` to `.env` and paste your Anthropic API key (https://console.anthropic.com -> API keys).
   Make sure `.env` is listed in `.gitignore` so the key is never pushed to GitHub.
3. In the VS Code terminal, from the repo root:  `node server.js`
4. Open http://localhost:3000   (NOT the Live Server / port 5500 page, it has no AI backend)
5. Type e.g. "20 second hype routine that ends with the shaka walk" and press Choreograph it.

No key? It still works in quick mode with a simple built-in choreographer.
