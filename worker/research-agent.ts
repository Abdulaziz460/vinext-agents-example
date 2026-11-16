import { createWorkersAI } from "workers-ai-provider";
import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  streamText,
  convertToModelMessages,
  pruneMessages,
  tool,
  stepCountIs,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from "ai";
import { z } from "zod";

const MAX_PAGE_CHARS = 8000;
const MAX_DOWNLOAD_BYTES = 1_000_000;

type Note = {
  id: number;
  title: string;
  content: string;
  source: string | null;
  created_at: string;
};

async function readBodyCapped(res: Response, maxBytes: number) {
  if (!res.body) return { body: "", capped: false };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let received = 0;
  let capped = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - received;
    if (value.byteLength >= remaining) {
      body += decoder.decode(value.subarray(0, remaining));
      capped = true;
      await reader.cancel();
      break;
    }
    received += value.byteLength;
    body += decoder.decode(value, { stream: true });
  }
  return { body: body + decoder.decode(), capped };
}

function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export class ResearchAgent extends AIChatAgent<Env> {
  private ensureNotesTable() {
    void this.sql`CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`;
  }

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: { abortSignal?: AbortSignal }
  ) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersai("@cf/zai-org/glm-4.7-flash"),
      system: `You are a meticulous research assistant. You read web pages the user points you to, summarize them accurately, and keep a persistent notebook of findings.

- Use fetchPage to read a URL before summarizing or answering questions about it. Never invent page contents.
- When the user asks you to remember, save, or note something, use saveNote. Include the source URL when there is one.
- Use listNotes to recall saved notes and deleteNote to remove one.
- Cite the source URL when your answer is based on a fetched page.`,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
      }),
      tools: {
        fetchPage: tool({
          description:
            "Fetch a public web page over HTTP(S) and return its readable text content (truncated).",
          inputSchema: z.object({
            url: z.string().url().describe("Absolute http(s) URL to fetch"),
          }),
          execute: async ({ url }) => {
            const parsed = new URL(url);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
              return { error: "Only http and https URLs are supported" };
            }
            try {
              const res = await fetch(parsed, {
                headers: { "User-Agent": "ResearchAgent/1.0" },
                signal: AbortSignal.timeout(10_000),
              });
              if (!res.ok) {
                return { url, error: `HTTP ${res.status} ${res.statusText}` };
              }
              const contentType = res.headers.get("content-type") ?? "";
              const { body, capped } = await readBodyCapped(
                res,
                MAX_DOWNLOAD_BYTES
              );
              const text = contentType.includes("html")
                ? htmlToText(body)
                : body.trim();
              const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
              return {
                url,
                title: title ? htmlToText(title) : undefined,
                content: text.slice(0, MAX_PAGE_CHARS),
                truncated: capped || text.length > MAX_PAGE_CHARS,
              };
            } catch (error) {
              return { url, error: `Failed to fetch: ${error}` };
            }
          },
        }),

        saveNote: tool({
          description: "Save a research note to the persistent notebook",
          inputSchema: z.object({
            title: z.string().describe("Short title for the note"),
            content: z.string().describe("The note body"),
            source: z
              .string()
              .optional()
              .describe("Source URL the note is based on, if any"),
          }),
          execute: async ({ title, content, source }) => {
            this.ensureNotesTable();
            const [note] = this.sql<Note>`
              INSERT INTO notes (title, content, source)
              VALUES (${title}, ${content}, ${source ?? null})
              RETURNING *`;
            return { saved: note };
          },
        }),

        listNotes: tool({
          description: "List all saved research notes, newest first",
          inputSchema: z.object({}),
          execute: async () => {
            this.ensureNotesTable();
            const notes = this.sql<Note>`
              SELECT * FROM notes ORDER BY id DESC`;
            return notes.length > 0 ? notes : "No notes saved yet.";
          },
        }),

        deleteNote: tool({
          description: "Delete a saved research note by its ID",
          inputSchema: z.object({
            id: z.number().int().describe("The ID of the note to delete"),
          }),
          execute: async ({ id }) => {
            this.ensureNotesTable();
            const deleted = this.sql<Note>`
              DELETE FROM notes WHERE id = ${id} RETURNING *`;
            return deleted.length > 0
              ? `Note ${id} deleted.`
              : `No note with ID ${id}.`;
          },
        }),
      },
      onFinish,
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal,
    });

    return result.toUIMessageStreamResponse();
  }
}
