import { Box, render, Static, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import { useCallback, useRef, useState } from "react";
import { dispatchCommand, type CommandContext } from "../commands/registry";
import type { Conversation } from "../engine/conversation";
import type { RunEvent } from "../loop/orchestrator";

type Kind = "info" | "user" | "step" | "tool" | "ok" | "err" | "answer";

interface LogItem {
  id: number;
  kind: Kind;
  text: string;
}

const COLOR: Record<Kind, string | undefined> = {
  info: "gray",
  user: "blue",
  step: "cyan",
  tool: "gray",
  ok: "green",
  err: "red",
  answer: undefined,
};

const PREFIX: Record<Kind, string> = {
  info: "",
  user: "❯ ",
  step: "",
  tool: "  ",
  ok: "  ",
  err: "  ",
  answer: "",
};

function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export interface TuiOptions {
  makeConversation: () => Conversation;
  context: CommandContext;
}

function App({ makeConversation, context }: TuiOptions) {
  const { exit } = useApp();
  const conversation = useRef<Conversation | null>(null);
  conversation.current ??= makeConversation();

  const [items, setItems] = useState<LogItem[]>([
    { id: 0, kind: "info", text: "Caduceus — type a task, or /help for commands. Ctrl+C to quit." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);

  const add = useCallback((kind: Kind, text: string) => {
    setItems((prev) => [...prev, { id: nextId.current++, kind, text }]);
  }, []);

  const submit = useCallback(
    async (value: string) => {
      const text = value.trim();
      if (!text || busy) {
        return;
      }
      setInput("");

      if (text.startsWith("/")) {
        const result = await dispatchCommand(text, context);
        if (result) {
          if (result.action === "print") {
            add("info", result.text);
          } else if (result.action === "clear") {
            setItems([]);
          } else if (result.action === "new") {
            conversation.current = makeConversation();
            setItems([{ id: nextId.current++, kind: "info", text: "New conversation." }]);
          } else {
            exit();
          }
          return;
        }
      }

      const convo = conversation.current;
      if (!convo) {
        return;
      }
      add("user", text);
      setBusy(true);
      try {
        const result = await convo.send(text, {
          onEvent: (event: RunEvent) => {
            if (event.type === "step") {
              add("step", `▸ step ${event.n}`);
            } else if (event.type === "tool_call") {
              add("tool", `→ ${event.call.name}(${truncate(JSON.stringify(event.call.arguments))})`);
            } else if (event.type === "tool_result") {
              add(event.isError ? "err" : "ok", `${event.isError ? "✗" : "✓"} ${event.name}`);
            }
          },
        });
        add("answer", result.finalText);
      } catch (error) {
        add("err", `error: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [add, busy, context, exit, makeConversation],
  );

  return (
    <Box flexDirection="column">
      <Static items={items}>
        {(item) => (
          <Box key={item.id}>
            <Text color={COLOR[item.kind]}>{PREFIX[item.kind] + item.text}</Text>
          </Box>
        )}
      </Static>
      {busy ? (
        <Box>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text dimColor> working…</Text>
        </Box>
      ) : (
        <Box>
          <Text color="green">❯ </Text>
          <TextInput value={input} onChange={setInput} onSubmit={submit} placeholder="Ask Caduceus, or /help…" />
        </Box>
      )}
    </Box>
  );
}

/** Render the interactive terminal chat. Requires a TTY. */
export async function runTui(options: TuiOptions): Promise<void> {
  const { waitUntilExit } = render(<App makeConversation={options.makeConversation} context={options.context} />);
  await waitUntilExit();
}
