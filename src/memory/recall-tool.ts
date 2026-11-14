import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Static } from "typebox";

import type { Runtime } from "../runtime.js";
import {
	DEFAULT_SOURCE_RECALL_CHARS,
	MAX_SOURCE_RECALL_CHARS,
	defaultSessionsRoot,
	readSourceRangePage,
	type SourceRecallCursor,
} from "./source-recall.js";

const SourceRangeSchema = Type.Object({
	sessionId: Type.String({ minLength: 1, maxLength: 256, description: "Immutable source session ID copied from a topic-file source line." }),
	firstEntryId: Type.String({ minLength: 1, maxLength: 256, description: "First source-entry ID in the stored observer chunk range." }),
	lastEntryId: Type.String({ minLength: 1, maxLength: 256, description: "Last source-entry ID in the stored observer chunk range." }),
});
const RecallSourceSchema = Type.Object({
	sourceRange: SourceRangeSchema,
	cursor: Type.Optional(
		Type.Object({
			entryId: Type.String({ minLength: 1, maxLength: 256, description: "Entry ID from the previous page's continuation cursor." }),
			characterOffset: Type.Integer({ minimum: 0, description: "Character offset within that serialized entry." }),
		}),
	),
	maxChars: Type.Optional(
		Type.Integer({ minimum: 256, maximum: MAX_SOURCE_RECALL_CHARS, description: "Page size in characters (default 6000; hard cap 12000)." }),
	),
});
type RecallSourceInput = Static<typeof RecallSourceSchema>;

type ToolText = { content: { type: "text"; text: string }[]; details: unknown };

function unavailable(reason: string): ToolText {
	return { content: [{ type: "text", text: `Source unavailable: ${reason}` }], details: { available: false, reason } };
}

/** Register a read-only tool that resolves only exact references already stored in this session's topic files. */
export function registerSourceRecallTool(
	pi: ExtensionAPI,
	runtime: Runtime,
	sessionsRoot = defaultSessionsRoot(),
): void {
	pi.registerTool({
		name: "recall_source",
		label: "Recall source conversation",
		description:
			"Read a bounded page from the exact source range stored beside a durable topic fact. " +
			"Pass its sessionId/firstEntryId/lastEntryId; use a returned continuation cursor to expand the same range. " +
			"This is read-only and cannot search unrelated sessions or ranges.",
		parameters: RecallSourceSchema,
		async execute(_id: string, params: RecallSourceInput, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext): Promise<ToolText> {
			if (!runtime.enabled || !runtime.memoryRoot) {
				return unavailable("observational memory is not active for this session.");
			}
			const result = readSourceRangePage(
				ctx.sessionManager,
				runtime.memoryRoot,
				sessionsRoot,
				params.sourceRange,
				params.cursor as SourceRecallCursor | undefined,
				params.maxChars ?? DEFAULT_SOURCE_RECALL_CHARS,
			);
			if (!result.available) return unavailable(result.reason);

			const cursorNotice = result.page.nextCursor
				? `\n\nMore source is available. Continue with cursor ${JSON.stringify(result.page.nextCursor)}.`
				: "";
			return {
				content: [{ type: "text", text: result.page.text + cursorNotice }],
				details: {
					available: true,
					sourceRange: params.sourceRange,
					returnedEntryIds: result.page.returnedEntryIds,
					nextCursor: result.page.nextCursor,
				},
			};
		},
	});
}
