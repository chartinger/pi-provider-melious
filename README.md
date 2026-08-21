# pi-provider-melious

A [pi](https://github.com/earendil-works/pi) extension that registers
[Melious](https://melious.ai/) as an OpenAI-compatible LLM provider.

**Repository:** <https://github.com/chartinger/pi-provider-melious>

## What it does

- Registers the `melious` provider via the recommended `createProvider()` form.
- Uses pi's built-in `openai-completions` streaming implementation.
- Auth is handled by pi: a stored `melious` credential in `auth.json`, the
  `MELIOUS_API_KEY` environment variable, or `/login melious`.
- Fetches the live Melious chat model catalog (`/models?include_meta=true`):
  - seeded eagerly at startup when a key is present, so models appear
    immediately (no "no models available" warning);
  - refreshed dynamically via `fetchModels` after `/login`.

## Install

```bash
pi install git:github.com/chartinger/pi-provider-melious
# or, for a one-off test:
pi -e ./extensions/melious-provider.ts
```

Then, once per machine:

```bash
pi /login melious         # stores the key in ~/.pi/agent/auth.json
# or
export MELIOUS_API_KEY=...
```

## Usage

```bash
pi --list-models
pi --provider melious --model <id> "hello"
```

In interactive mode use `/model` to pick a Melious model.

## Notes / gotchas

- `createProvider` does **not** stamp `provider`, `baseUrl`, or `api` onto
  models. Each catalog entry must carry them itself. Omitting `provider`
  crashes the `/model` selector sort; omitting `baseUrl` crashes streaming
  with `Cannot read properties of undefined (reading 'includes')`.
- Only one extension may register the `melious` provider id. Do not ship the
  old `melious.ts` alongside this one.
- Credentials live per-machine in `~/.pi/agent/auth.json` / env vars; they are
  never part of the package.

## Development

```bash
npm install
npm run typecheck
```

## Layout

```
extensions/melious-provider.ts   # the extension entry point
package.json                     # pi package manifest + metadata
```

## License

MIT — see [LICENSE](LICENSE).