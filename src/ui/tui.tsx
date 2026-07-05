import { Box, render, Static, Text, useApp, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import { basename } from "node:path";
import { useCallback, useMemo, useRef, useState } from "react";
import { dispatchCommand, suggestCommands, type CommandContext } from "../commands/registry";
import type { Conversation } from "../engine/conversation";
import { type ApprovalRequest, type Approver, denyApprover, resolveApprovalMode } from "../exec/approval";
import type { RunEvent } from "../loop/orchestrator";
import { pickLogo } from "./banner";

type Kind = "banner" | "user" | "answer" | "tool" | "ok" | "err" | "info";

interface LogItem {
  id: number;
  kind: Kind;
  text: string;
}

function truncate(text: string, max = 64): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function Banner({ width, model }: { width: number; model: string }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} marginBottom={1}>
      {pickLogo(width).map((line, i) => (
        <Text key={i} color="cyan" bold>
          {line}
        </Text>
      ))}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>An open coding agent on Ollama Cloud.</Text>
        <Box>
          <Text dimColor>model </Text>
          <Text color="cyan">{model}</Text>
          <Text dimColor>{"  ·  type "}</Text>
          <Text color="magenta">/help</Text>
          <Text dimColor>{"  ·  Ctrl+C to quit"}</Text>
        </Box>
      </Box>
    </Box>
  );
}

function Line({ item, width, model }: { item: LogItem; width: number; model: string }) {
  switch (item.kind) {
    case "banner":
      return <Banner width={width} model={model} />;
    case "user":
      return (
        <Box marginTop={1}>
          <Text color="blueBright">▌ </Text>
          <Text bold>{item.text}</Text>
        </Box>
      );
    case "answer":
      return (
        <Box marginTop={1}>
          <Text color="cyan">◆ </Text>
          <Text>{item.text}</Text>
        </Box>
      );
    case "tool": {
      const open = item.text.indexOf("(");
      const name = open > 0 ? item.text.slice(0, open) : item.text;
      const args = open > 0 ? item.text.slice(open) : "";
      return (
        <Box>
          <Text color="yellow">{"  ↳ "}</Text>
          <Text color="yellow">{name}</Text>
          <Text dimColor>{args}</Text>
        </Box>
      );
    }
    case "ok":
      return <Text color="green">{`  ✓ ${item.text}`}</Text>;
    case "err":
      return <Text color="red">{`  ✗ ${item.text}`}</Text>;
    default:
      return <Text dimColor>{item.text}</Text>;
  }
}

function StatusBar({ model, cwd, tokens, sandbox }: { model: string; cwd: string; tokens: number; sandbox: string }) {
  return (
    <Box marginTop={1} justifyContent="space-between">
      <Box>
        <Text backgroundColor="cyan" color="black" bold>
          {" caduceus "}
        </Text>
        <Text backgroundColor="gray" color="black">
          {` ${model} `}
        </Text>
      </Box>
      <Box>
        <Text backgroundColor="gray" color="black">
          {` ${basename(cwd) || cwd} `}
        </Text>
        <Text backgroundColor={sandbox === "off" ? "red" : "green"} color="black">
          {` sandbox:${sandbox} `}
        </Text>
        <Text backgroundColor="blue" color="white">
          {` ${tokens} tok `}
        </Text>
      </Box>
    </Box>
  );
}

export interface TuiOptions {
  makeConversation: (confirm?: Approver) => Conversation;
  context: CommandContext;
}

function App({ makeConversation, context }: TuiOptions) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const nextId = useRef(1);

  const [items, setItems] = useState<LogItem[]>([{ id: 0, kind: "banner", text: "" }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState(0);
  const [pending, setPending] = useState<ApprovalRequest | null>(null);
  const pendingRef = useRef<{ req: ApprovalRequest; resolve: (ok: boolean) => void } | null>(null);

  const add = useCallback((kind: Kind, text: string) => {
    setItems((prev) => [...prev, { id: nextId.current++, kind, text }]);
  }, []);

  // Approval gate: in prompt mode, a risky command pauses the turn until answered.
  const approver = useMemo<Approver | undefined>(() => {
    const mode = resolveApprovalMode();
    if (mode === "allow") {
      return undefined;
    }
    if (mode === "deny") {
      return denyApprover;
    }
    return (req) =>
      new Promise<boolean>((resolve) => {
        pendingRef.current = { req, resolve };
        setPending(req);
      });
  }, []);

  const conversation = useRef<Conversation | null>(null);
  conversation.current ??= makeConversation(approver);

  const suggestions = useMemo(() => (busy ? [] : suggestCommands(input)), [busy, input]);

  // Answer a pending approval (y allows, anything else denies).
  useInput(
    (char) => {
      const p = pendingRef.current;
      if (!p) {
        return;
      }
      const allow = char.toLowerCase() === "y";
      add(allow ? "ok" : "err", `${allow ? "approved" : "denied"}: ${p.req.command}`);
      pendingRef.current = null;
      setPending(null);
      p.resolve(allow);
    },
    { isActive: pending !== null },
  );

  // Tab completes the current slash command to the top suggestion.
  useInput(
    (_char, key) => {
      if (key.tab && suggestions.length > 0) {
        setInput(`/${suggestions[0]?.name ?? ""} `);
      }
    },
    { isActive: !busy && pending === null },
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
            conversation.current = makeConversation(approver);
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
            } else if (event.type === "tool_call") {
              add("tool", `${event.call.name}(${truncate(JSON.stringify(event.call.arguments))})`);
            } else if (event.type === "tool_result") {
              add(event.isError ? "err" : "ok", event.isError ? `${event.name}: ${truncate(event.content, 80)}` : event.name);
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
    [add, approver, busy, context, exit, makeConversation],
  );

  const sandbox = process.env.CADUCEUS_SANDBOX ?? "auto";

  return (
    <Box flexDirection="column">
      <Static items={items}>
        {(item) => (
          <Box key={item.id} flexDirection="column">
            <Line item={item} width={width} model={context.model} />
          </Box>
        )}
      </Static>

      {pending ? (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
          <Text color="yellow" bold>
            Approval needed
          </Text>
          <Text dimColor>{pending.reason}</Text>
          <Text>{pending.command}</Text>
          <Text dimColor>Press y to allow, any other key to deny.</Text>
        </Box>
      ) : busy ? (
        <Box marginTop={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text dimColor>{steps > 0 ? `  working  ·  step ${steps}` : "  working"}</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Box borderStyle="round" borderColor="cyan" paddingX={1}>
            <Text color="cyan">❯ </Text>
            <TextInput value={input} onChange={setInput} onSubmit={submit} placeholder="Ask Caduceus, or /help" />
          </Box>
          {suggestions.length > 0 && (
            <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
              {suggestions.map((cmd, i) => (
                <Box key={cmd.name}>
                  <Text color={i === 0 ? "cyan" : "gray"} bold={i === 0}>
                    {`/${cmd.name}`.padEnd(12)}
                  </Text>
                  <Text dimColor>{cmd.description}</Text>
                  {i === 0 ? <Text color="magenta">{"  ⇥ tab"}</Text> : null}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}

      <StatusBar model={context.model} cwd={context.cwd} tokens={context.usage()} sandbox={sandbox} />
    </Box>
  );
}

/** Render the interactive terminal chat. Requires a TTY. */
export async function runTui(options: TuiOptions): Promise<void> {
  const { waitUntilExit } = render(<App makeConversation={options.makeConversation} context={options.context} />);
  await waitUntilExit();
}
