/**
 * Melious LLM provider (modern implementation).
 *
 * Uses the recommended `createProvider` form:
 *  - auth is handled by pi (auth.json, `MELIOUS_API_KEY` env, `/login melious`)
 *  - models are seeded eagerly at startup (when a key is present) so they show
 *    up in `pi --list-models` / the picker immediately (no "no models available"
 *    warning), and refreshed dynamically via `fetchModels` after auth resolves.
 *
 * IMPORTANT: `createProvider` does NOT stamp `provider`, `baseUrl`, or `api`
 * onto models. Each catalog entry must carry them itself (built-in catalogs do
 * the same). Omitting `provider` crashes the /model selector sort; omitting
 * `baseUrl` crashes streaming with "Cannot read properties of undefined
 * (reading 'includes')".
 *
 * Only one extension may register the `melious` provider id, so the old
 * `melious.ts` is renamed to `melious.ts.disabled` (kept intact).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	createProvider,
	envApiKeyAuth,
	openAICompletionsApi,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BASE_URL = "https://api.melious.ai/v1";
// Melious frequently omits max_output_tokens; 8K is a useful baseline for
// coding-agent workloads.
const DEFAULT_MAX_TOKENS = 8192;
// DeepSeek V4 documentation advertises a 384K (393,216) output limit, which
// Melious also accepts for deepseek-v4.1-flash.
const DEEPSEEK_V4_MAX_TOKENS = 393216;

function defaultMaxTokens(modelId: string): number {
	return modelId.toLowerCase().startsWith("deepseek-v4")
		? DEEPSEEK_V4_MAX_TOKENS
		: DEFAULT_MAX_TOKENS;
}

/** Environment variable that can provide the Melious API key. */
export const MELIOUS_API_KEY_ENV = "MELIOUS_API_KEY";

interface MeliousMeta {
	type?: "chat" | "embedding" | "image";
	display_name?: string;
	capabilities?: { reasoning?: boolean; vision?: boolean };
	pricing?: {
		input_cost_per_million_eur?: number;
		output_cost_per_million_eur?: number;
		cache_read_cost_per_million_eur?: number;
	};
	context_length?: number;
	max_output_tokens?: number;
}

interface MeliousCatalogModel {
	id: string;
	_meta?: MeliousMeta;
}

async function fetchMeliousModels(apiKey: string, signal?: AbortSignal) {
	const res = await fetch(`${BASE_URL}/models?include_meta=true`, {
		headers: { Authorization: `Bearer ${apiKey}` },
		signal,
	});
	if (!res.ok) {
		throw new Error(`Melious model catalog request failed: ${res.status} ${await res.text()}`);
	}
	const { data } = (await res.json()) as { data: MeliousCatalogModel[] };
	return data
		.filter((m) => m._meta?.type === "chat")
		.map((m) => ({
			id: m.id,
			name: m._meta?.display_name ?? m.id,
			api: "openai-completions",
			provider: "melious",
			baseUrl: BASE_URL,
			reasoning: m._meta?.capabilities?.reasoning ?? false,
			input: m._meta?.capabilities?.vision
				? (["text", "image"] as ("text" | "image")[])
				: (["text"] as ("text" | "image")[]),
			cost: {
				input: m._meta?.pricing?.input_cost_per_million_eur ?? 0,
				output: m._meta?.pricing?.output_cost_per_million_eur ?? 0,
				cacheRead: m._meta?.pricing?.cache_read_cost_per_million_eur ?? 0,
				cacheWrite: 0,
			},
			contextWindow: m._meta?.context_length ?? 128000,
			maxTokens: m._meta?.max_output_tokens ?? defaultMaxTokens(m.id),
		}));
}

// Eager-startup seed: read the key from MELIOUS_API_KEY or the stored credential
// in auth.json (same place `/login melious` writes). Only used to populate the
// baseline catalog at startup; runtime auth still goes through pi's auth layer.
function readStoredKey(): string | undefined {
	if (process.env[MELIOUS_API_KEY_ENV]) return process.env[MELIOUS_API_KEY_ENV];
	try {
		const data = JSON.parse(readFileSync(join(homedir(), ".pi", "agent", "auth.json"), "utf8"));
		const cred = data?.melious;
		return cred?.type === "api_key" ? cred.key : undefined;
	} catch {
		return undefined;
	}
}

export default async function (pi: ExtensionAPI) {
	// Seed eagerly so models are available at startup (when a key is present).
	let baseline: Awaited<ReturnType<typeof fetchMeliousModels>> = [];
	const seedKey = readStoredKey();
	if (seedKey) {
		try {
			baseline = await fetchMeliousModels(seedKey);
		} catch {
			baseline = [];
		}
	}

	pi.registerProvider(
		createProvider({
			id: "melious",
			name: "Melious",
			baseUrl: BASE_URL,
			auth: {
				// Stored `melious` credential in auth.json wins, then MELIOUS_API_KEY,
				// and `/login melious` prompts to store a key.
				apiKey: envApiKeyAuth("Melious API key", [MELIOUS_API_KEY_ENV]),
			},
			// Seeded at startup when a key exists; empty otherwise until fetchModels.
			models: baseline,
			api: openAICompletionsApi(),
			fetchModels: async (context) => {
				const key =
					context.credential?.type === "oauth"
						? context.credential.access
						: context.credential?.key;
				if (!key) return [];
				return fetchMeliousModels(key, context.signal);
			},
		}),
	);
}