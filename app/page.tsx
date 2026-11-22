const AGENTS = [
  {
    name: "Chat",
    description:
      "A general assistant that checks the weather, detects your timezone, does math, and schedules reminders.",
  },
  {
    name: "Research",
    description:
      "Reads web pages you point it to, summarizes them, and keeps a persistent notebook of findings.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-10 px-6 py-16">
      <section className="text-center max-w-2xl space-y-4">
        <h1 className="text-4xl font-bold">AI Agents on Cloudflare</h1>
        <p className="text-lg opacity-80">
          Two stateful AI agents, each running in its own Durable Object with
          its own SQLite storage and chat history.
        </p>
        <a
          href="/chat"
          className="inline-block rounded-lg bg-black text-white px-6 py-3 font-medium hover:opacity-90"
        >
          Start chatting
        </a>
      </section>
      <section className="grid gap-6 sm:grid-cols-2 max-w-3xl w-full">
        {AGENTS.map((agent) => (
          <div key={agent.name} className="rounded-xl border p-6 space-y-2">
            <h2 className="text-xl font-semibold">{agent.name} Agent</h2>
            <p className="opacity-80">{agent.description}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
