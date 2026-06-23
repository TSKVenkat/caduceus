import { Box, render, Static, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import { basename } from "node:path";
import { useCallback, useMemo, useRef, useState } from "react";
import { dispatchCommand, suggestCommands, type CommandContext } from "../commands/registry";
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
  const [steps, setSteps] = useState(0);
  const nextId = useRef(1);

  const add = useCallback((kind: Kind, text: string) => {
    setItems((prev) => [...prev, { id: nextId.current++, kind, text }]);
  }, []);

  const suggestions = useMemo(() => (busy ? [] : suggestCommands(input)), [busy, input]);

  // Tab completes the current slash command to the top suggestion.
  useInput(
    (_char, key) => {
      if (key.tab && suggestions.length > 0) {
        setInput(`/${suggestions[0]?.name ?? ""} `);
      }
    },
    { isActive: !busy },
  );

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
      setSteps(0);
      try {
        const result = await convo.send(text, {
          onEvent: (event: RunEvent) => {
            if (event.type === "step") {
              setSteps(event.n);
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

  const sandbox = process.env.CADUCEUS_SANDBOX ?? "auto";

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
          <Text dimColor>{steps > 0 ? ` working… (step ${steps})` : " working…"}</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box>
            <Text color="green">❯ </Text>
            <TextInput value={input} onChange={setInput} onSubmit={submit} placeholder="Ask Caduceus, or /help…" />
          </Box>
          {suggestions.length > 0 && (
            <Box flexDirection="column" marginLeft={2}>
              {suggestions.map((cmd, index) => (
                <Text key={cmd.name} color={index === 0 ? "cyan" : "gray"} dimColor={index !== 0}>
                  {`/${cmd.name}`.padEnd(12)} {cmd.description}
                  {index === 0 ? "  ⇥ tab" : ""}
                </Text>
              ))}
            </Box>
          )}
        </Box>
      )}

      <Box marginTop={1}>
        <Text backgroundColor="blue" color="white">
          {` ${context.model} `}
        </Text>
        <Text backgroundColor="gray" color="black">
          {` ${basename(context.cwd) || context.cwd} `}
        </Text>
        <Text backgroundColor="gray" color="black">
          {` sandbox:${sandbox} `}
        </Text>
        <Text backgroundColor="gray" color="black">
          {` ${context.usage()} tok `}
        </Text>
      </Box>
    </Box>
  );
}

/** Render the interactive terminal chat. Requires a TTY. */
export async function runTui(options: TuiOptions): Promise<void> {
  const { waitUntilExit } = render(<App makeConversation={options.makeConversation} context={options.context} />);
  await waitUntilExit();
}
