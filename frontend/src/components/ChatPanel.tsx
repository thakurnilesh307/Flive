import { useEffect, useRef, useState } from "react";
import { CloseIcon, SendIcon, SparkIcon } from "./icons";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  tools?: { name: string }[];
  seconds?: number;
  error?: boolean;
}

interface Props {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  suggestions: string[];
  onClose: () => void;
}

const TOOL_LABEL: Record<string, string> = {
  traffic_summary: "traffic summary",
  list_aircraft: "aircraft list",
  get_aircraft: "aircraft details",
  landing_sequence: "landing order",
};

// Models like to emit Markdown bold; we render plain text only, so drop it.
const tidy = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1");

export default function ChatPanel({ messages, setMessages, suggestions, onClose }: Props) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ available: boolean; model: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stop = false;
    const check = () =>
      fetch("/api/ask/status")
        .then((r) => r.json())
        .then((s) => { if (!stop) setStatus(s); })
        .catch(() => { if (!stop) setStatus({ available: false, model: "" }); });
    check();
    const t = window.setInterval(check, 30000);
    return () => { stop = true; window.clearInterval(t); };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text: string) => {
    const question = text.trim().slice(0, 300);
    if (!question || busy) return;
    const history = messages.filter((m) => !m.error).slice(-6).map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detail = typeof body.detail === "string" ? body.detail : "Something went wrong. Try again.";
        setMessages((m) => [...m, { role: "assistant", content: detail, error: true }]);
      } else {
        setMessages((m) => [...m, {
          role: "assistant", content: tidy(String(body.answer ?? "")), tools: body.tools ?? [], seconds: body.seconds,
        }]);
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Couldn't reach the Flive server.", error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const offline = status != null && !status.available;

  return (
    <aside className="panel detail chat" aria-label="Ask Flive">
      <header className="chat-head">
        <div className="chat-mark"><SparkIcon size={20} /></div>
        <div className="detail-title">
          <h2>Ask Flive</h2>
          <p>
            {status == null ? "Checking…" : offline ? "Offline" : `Local AI · ${status.model}`}
          </p>
        </div>
        <button className="icon-btn ghost" onClick={onClose} aria-label="Close Ask Flive"><CloseIcon size={20} /></button>
      </header>

      <div className="chat-list" ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="chat-intro">
            <p>Ask me about the planes on the map. It only answers from the live data, so if it doesn&apos;t know something (like where a flight is going) it should say so.</p>
            <a href="/about.html#ask-flive">How this works →</a>
          </div>
        )}
        {offline && (
          <div className="chat-offline">
            The AI runs on my own machine, and it&apos;s not running right now. The map still works fine.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role} ${m.error ? "error" : ""}`}>
            <p>{m.content}</p>
            {m.role === "assistant" && !m.error && m.tools && (
              <span className="bubble-meta">
                {m.tools.length ? `Checked ${[...new Set(m.tools.map((t) => TOOL_LABEL[t.name] ?? t.name))].join(", ")}` : "No live data used"}
                {m.seconds != null ? ` · ${m.seconds}s` : ""}
              </span>
            )}
          </div>
        ))}
        {busy && <div className="bubble assistant typing" aria-label="Thinking"><span /><span /><span /></div>}
      </div>

      {messages.length === 0 && !offline && (
        <div className="chips">
          {suggestions.map((s) => (
            <button key={s} className="chip" onClick={() => send(s)} disabled={busy}>{s}</button>
          ))}
        </div>
      )}

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={offline ? "Ask Flive is offline" : "Ask about live traffic…"}
          maxLength={300}
          disabled={offline}
          aria-label="Your question"
        />
        <button className="icon-btn send" type="submit" disabled={busy || offline || !input.trim()} aria-label="Send">
          <SendIcon size={18} />
        </button>
      </form>
    </aside>
  );
}
