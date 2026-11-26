# Dashboard app (Netlify)

```
dashboard-app/
├── index.html                  # Dashboard table (front end)
├── data/items.json             # Sample data (replace with your own)
├── netlify/functions/items.js  # Serverless API: GET /.netlify/functions/items
└── netlify.toml                # Netlify build and function settings
```

## Run locally

```bash
npx netlify-cli dev
```

Open the URL it prints (usually http://localhost:8888). The table loads from the function.

## Deploy

Drag-and-drop uploads do not run functions, so deploy with Git or the CLI.

**Option A: Git (recommended)**
1. Push this folder to a GitHub repository.
2. In Netlify: *Add new site → Import from Git* and pick the repo.
3. Leave the build command empty and the publish directory as `.`. Netlify reads `netlify.toml`.

**Option B: CLI**
```bash
npx netlify-cli login
npx netlify-cli deploy --prod
```

## Next steps
- **Replace the JSON file** with a database or API call inside `items.js`. The front end does not change.
- **Add an MCP server** that calls the same data source (for example, a tool named `list_items` that returns the same JSON). Keep the logic in one module and reuse it in both the function and the MCP server.
