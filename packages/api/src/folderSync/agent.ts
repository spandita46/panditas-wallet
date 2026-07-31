import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ImportRow } from "@panditas/shared";
import { getAnthropicClient } from "../anthropicClient.js";
import { env } from "../env.js";
import type { ParsedGrid } from "./csvParse.js";
import type { ColumnMapping } from "./normalize.js";

export interface AccountBrief {
  id: string;
  name: string;
  officialName: string | null;
  type: string;
  currency: string;
  institutionName: string | null;
}

export interface AccountMatch {
  accountId: string;
  confidence: number;
}

// Tuning knob, not an env var — how confident (and how account-certain) a
// scan needs to be before landing in needs_review instead of needs_account.
export const CONFIDENCE_THRESHOLD = 0.7;

export function resolveInitialStatus(
  accountMatch: AccountMatch | null,
  overallConfidence: number,
): "needs_review" | "needs_account" {
  return accountMatch !== null && overallConfidence >= CONFIDENCE_THRESHOLD ? "needs_review" : "needs_account";
}

const nullableString = z
  .string()
  .nullable()
  .optional()
  .transform((v) => v ?? null);
const nullableInt = z
  .number()
  .int()
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const accountMatchSchema = z
  .object({ accountId: z.string(), confidence: z.number() })
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const columnMappingResultSchema = z.object({
  dateColumn: z.number().int(),
  dateFormat: z.enum(["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"]),
  payeeColumn: nullableInt,
  memoColumn: nullableInt,
  amountMode: z.enum(["single", "debit_credit"]),
  amountColumn: nullableInt,
  flipSign: z.boolean().default(false),
  debitColumn: nullableInt,
  creditColumn: nullableInt,
});

const submitColumnMappingSchema = z.object({
  institutionGuess: nullableString,
  accountMatch: accountMatchSchema,
  columnMapping: columnMappingResultSchema,
  // Set only when the file spans multiple household accounts (e.g. one
  // Wealthsimple export covering Chequing + FHSA + two TFSAs), identified by
  // a per-row account-id column. Null for the common single-account file —
  // in that case accountMatch above is what to use.
  accountIdentifierColumn: nullableInt,
  accountTypeColumn: nullableInt,
  overallConfidence: z.number(),
  notes: nullableString,
});

export interface ColumnMappingAgentResult {
  institutionGuess: string | null;
  accountMatch: AccountMatch | null;
  columnMapping: ColumnMapping;
  accountIdentifierColumn: number | null;
  accountTypeColumn: number | null;
  overallConfidence: number;
  notes: string | null;
}

const importRowResultSchema = z.object({
  postedAt: z.string(),
  amount: z.number(),
  payee: nullableString,
  memo: nullableString,
});

const submitTranscribedTransactionsSchema = z.object({
  institutionGuess: nullableString,
  accountMatch: accountMatchSchema,
  rows: z.array(importRowResultSchema),
  overallConfidence: z.number(),
  notes: nullableString,
});

export interface TranscribedAgentResult {
  institutionGuess: string | null;
  accountMatch: AccountMatch | null;
  rows: ImportRow[];
  overallConfidence: number;
  notes: string | null;
}

const groupMatchResultSchema = z.object({
  rawAccountId: z.string(),
  accountId: nullableString,
  confidence: z.number(),
  notes: nullableString,
});

const submitAccountGroupMatchesSchema = z.object({
  matches: z.array(groupMatchResultSchema),
});

export interface AmbiguousAccountGroup {
  rawAccountId: string;
  accountType: string | null;
  // Representative transactions for this group — the caller should weight
  // these toward distinguishing activity (fee/admin rows) when the group is
  // large, since only a sample is sent.
  sampleRows: ImportRow[];
  // Narrowed to same-type/institution candidates — never the full household
  // list, so the agent's job here is a tie-break, not a fresh search.
  candidates: AccountBrief[];
}

export interface GroupMatch {
  rawAccountId: string;
  accountMatch: AccountMatch | null;
  notes: string | null;
}

function accountsBlock(accounts: AccountBrief[]): string {
  return accounts
    .map(
      (a) =>
        `- id=${a.id} name="${a.name}" officialName=${a.officialName ? `"${a.officialName}"` : "null"} type=${a.type} currency=${a.currency} institution=${a.institutionName ?? "null"}`,
    )
    .join("\n");
}

const COLUMN_MAPPING_TOOL: Anthropic.Tool = {
  name: "submit_column_mapping",
  description:
    "Submit the identified column mapping for a bank-export CSV/XLSX grid, plus a guess at which household account this file belongs to.",
  input_schema: {
    type: "object",
    properties: {
      institutionGuess: { type: "string", description: "Bank/institution name guessed from the file. Omit if unclear." },
      accountMatch: {
        type: "object",
        description: "Best-matching account from the provided list. Omit entirely if no account is a confident match.",
        properties: {
          accountId: { type: "string" },
          confidence: { type: "number", description: "0-1, how confident this is the right account." },
        },
        required: ["accountId", "confidence"],
      },
      columnMapping: {
        type: "object",
        properties: {
          dateColumn: { type: "integer", description: "0-based index of the date column." },
          dateFormat: { type: "string", enum: ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"] },
          payeeColumn: { type: "integer", description: "0-based index of the payee/description column. Omit if none." },
          memoColumn: { type: "integer", description: "0-based index of an optional memo column. Omit if none." },
          amountMode: { type: "string", enum: ["single", "debit_credit"] },
          amountColumn: { type: "integer", description: "0-based index. Required when amountMode is single." },
          flipSign: { type: "boolean", description: "True only if this file uses negative = money in (uncommon)." },
          debitColumn: { type: "integer", description: "0-based index. Required when amountMode is debit_credit." },
          creditColumn: { type: "integer", description: "0-based index. Required when amountMode is debit_credit." },
        },
        required: ["dateColumn", "dateFormat", "amountMode", "flipSign"],
      },
      accountIdentifierColumn: {
        type: "integer",
        description:
          "0-based index of a column that identifies which of the household's accounts each row belongs to (e.g. an internal account id), ONLY if this file's rows span more than one account. Omit for an ordinary single-account file — the common case.",
      },
      accountTypeColumn: {
        type: "integer",
        description: "0-based index of a column naming the account type (e.g. 'TFSA', 'Chequing'), if present. Omit if none or not multi-account.",
      },
      overallConfidence: { type: "number", description: "0-1 overall confidence in this mapping and account guess." },
      notes: {
        type: "string",
        description: "Free-text explanation shown to the human reviewer, e.g. flagging ambiguity or a multi-sheet workbook.",
      },
    },
    required: ["columnMapping", "overallConfidence"],
  },
};

const TRANSCRIBE_TOOL: Anthropic.Tool = {
  name: "submit_transcribed_transactions",
  description:
    "Submit transactions transcribed from a bank statement PDF, plus a guess at which household account this statement belongs to.",
  input_schema: {
    type: "object",
    properties: {
      institutionGuess: { type: "string", description: "Bank/institution name from the statement. Omit if unclear." },
      accountMatch: {
        type: "object",
        description: "Best-matching account from the provided list. Omit entirely if no account is a confident match.",
        properties: {
          accountId: { type: "string" },
          confidence: { type: "number", description: "0-1, how confident this is the right account." },
        },
        required: ["accountId", "confidence"],
      },
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            postedAt: { type: "string", description: "YYYY-MM-DD" },
            amount: { type: "number", description: "Negative = money out, positive = money in." },
            payee: { type: "string" },
            memo: { type: "string" },
          },
          required: ["postedAt", "amount"],
        },
      },
      overallConfidence: { type: "number", description: "0-1 overall confidence in the transcription and account guess." },
      notes: {
        type: "string",
        description: "Free-text explanation shown to the human reviewer, e.g. flagging illegible rows.",
      },
    },
    required: ["rows", "overallConfidence"],
  },
};

const GROUP_MATCH_TOOL: Anthropic.Tool = {
  name: "submit_account_group_matches",
  description:
    "Submit, for each ambiguous raw account id in a multi-account file, which candidate household account it actually is (or that none is confident).",
  input_schema: {
    type: "object",
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          properties: {
            rawAccountId: { type: "string" },
            accountId: { type: "string", description: "Chosen candidate account id. Omit if none of the candidates is a confident match." },
            confidence: { type: "number", description: "0-1." },
            notes: { type: "string", description: "Brief reasoning, e.g. which transactions gave it away." },
          },
          required: ["rawAccountId", "confidence"],
        },
      },
    },
    required: ["matches"],
  },
};

function extractToolInput(message: Anthropic.Message, toolName: string): unknown {
  if (message.stop_reason === "max_tokens") {
    throw new Error("The agent's response hit the token limit before finishing — this file may have more transactions than fit in one pass.");
  }
  const block = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === toolName);
  if (!block) throw new Error(`Agent did not call ${toolName}`);
  return block.input;
}

function requireModel(model: string | undefined, varName: string): string {
  if (!model) throw new Error(`${varName} is not configured — folder sync is unavailable.`);
  return model;
}

export async function mapCsvColumns(grid: ParsedGrid, accounts: AccountBrief[], sourceLabel?: string): Promise<ColumnMappingAgentResult> {
  const client = getAnthropicClient();
  const sample = grid.rows.slice(0, 25);
  const message = await client.messages.create({
    model: requireModel(env.ANTHROPIC_MODEL_TEXT, "ANTHROPIC_MODEL_TEXT"),
    max_tokens: 2048,
    tools: [COLUMN_MAPPING_TOOL],
    tool_choice: { type: "tool", name: "submit_column_mapping" },
    // Instructions + account list are identical across every file in a scan
    // batch (and across scans, until accounts change) — cached separately
    // from the per-file header/sample rows so a multi-file scan only pays
    // full price on the first agent call. Below the model's minimum
    // cacheable prefix today with a small household; grows into a real hit
    // as the account list (or this prompt) grows. See prompt-caching docs:
    // tools -> system -> messages render order, breakpoint on the last
    // cacheable system block covers both.
    system: [
      {
        type: "text",
        text: [
          "You are mapping a bank-export CSV/XLSX file to a normalized transaction format for a household finance app.",
          "Identify which column is the date, payee/description, memo, and amount (either one signed column or separate debit/credit columns). Guess which account this file most likely belongs to, if any is a confident match.",
          "Some exports (e.g. Wealthsimple's full-activity export) cover multiple accounts in one file, with a per-row column identifying which account each row belongs to. If you see this — rows clearly split across more than one account, not just one account's full history — set accountIdentifierColumn (and accountTypeColumn if a type/product column exists) instead of a single accountMatch.",
          `Known household accounts:\n${accountsBlock(accounts)}`,
        ].join("\n\n"),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          sourceLabel ? `File name: ${sourceLabel}` : null,
          `Header row: ${JSON.stringify(grid.header)}`,
          `Sample rows (up to 25):\n${sample.map((r) => JSON.stringify(r)).join("\n")}`,
        ]
          .filter((s): s is string => s !== null)
          .join("\n\n"),
      },
    ],
  });

  return submitColumnMappingSchema.parse(extractToolInput(message, "submit_column_mapping"));
}

// Tie-breaks raw account ids that a deterministic type/label narrow couldn't
// resolve to a single candidate (e.g. two TFSAs of the same type) — one call
// for every ambiguous group in a file, using each group's own transaction
// content as the disambiguating signal (a recurring "Management fee" row is
// a strong tell for a professionally-managed account, for instance).
export async function resolveAmbiguousAccountGroups(groups: AmbiguousAccountGroup[]): Promise<GroupMatch[]> {
  if (groups.length === 0) return [];
  const client = getAnthropicClient();

  const groupsBlock = groups
    .map((g) => {
      const candidatesText = g.candidates
        .map((c) => `  - id=${c.id} name="${c.name}" officialName=${c.officialName ? `"${c.officialName}"` : "null"}`)
        .join("\n");
      const rowsText = g.sampleRows
        .slice(0, 40)
        .map((r) => `  ${r.postedAt} ${r.amount} ${r.payee ?? ""} ${r.memo ?? ""}`.trim())
        .join("\n");
      return [
        `Raw account id: ${g.rawAccountId}${g.accountType ? ` (type: ${g.accountType})` : ""}`,
        `Candidate accounts:\n${candidatesText}`,
        `Sample transactions:\n${rowsText}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  const message = await client.messages.create({
    model: requireModel(env.ANTHROPIC_MODEL_TEXT, "ANTHROPIC_MODEL_TEXT"),
    max_tokens: 2048,
    tools: [GROUP_MATCH_TOOL],
    tool_choice: { type: "tool", name: "submit_account_group_matches" },
    messages: [
      {
        role: "user",
        content: [
          "A household finance app found a multi-account bank export where several candidate accounts share the same type, so type/label matching alone can't tell them apart. Use each group's own transaction content to disambiguate — e.g. a recurring 'Management fee' pattern usually marks a professionally-managed account rather than a self-directed one with manual trades.",
          "For each raw account id below, pick the correct candidate, or omit accountId if genuinely unsure.",
          groupsBlock,
        ].join("\n\n"),
      },
    ],
  });

  const parsed = submitAccountGroupMatchesSchema.parse(extractToolInput(message, "submit_account_group_matches"));
  return parsed.matches.map((m) => ({
    rawAccountId: m.rawAccountId,
    accountMatch: m.accountId ? { accountId: m.accountId, confidence: m.confidence } : null,
    notes: m.notes,
  }));
}

export async function transcribePdf(pdfBytes: Buffer, accounts: AccountBrief[]): Promise<TranscribedAgentResult> {
  const client = getAnthropicClient();
  // A dense multi-month statement can run to hundreds of transaction rows —
  // 8192 wasn't enough headroom and cut a real statement off mid-JSON with
  // stop_reason "max_tokens" (confirmed against a real 16-page TD statement).
  // Stream rather than a plain non-streaming call: the SDK's HTTP timeout
  // isn't sized for a max_tokens this large otherwise.
  const stream = client.messages.stream({
    model: requireModel(env.ANTHROPIC_MODEL_PDF, "ANTHROPIC_MODEL_PDF"),
    max_tokens: 32000,
    tools: [TRANSCRIBE_TOOL],
    tool_choice: { type: "tool", name: "submit_transcribed_transactions" },
    // Same split as mapCsvColumns — instructions + account list cached
    // separately from the per-file PDF bytes.
    system: [
      {
        type: "text",
        text: [
          "This is a bank statement PDF for a household finance app. Transcribe every transaction row into the tool call: date (YYYY-MM-DD), amount (negative = money out, positive = money in), payee, and memo if present.",
          "Guess which account this statement belongs to, if any is a confident match.",
          `Known household accounts:\n${accountsBlock(accounts)}`,
        ].join("\n\n"),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBytes.toString("base64") } },
        ],
      },
    ],
  });
  const message = await stream.finalMessage();

  return submitTranscribedTransactionsSchema.parse(extractToolInput(message, "submit_transcribed_transactions"));
}
