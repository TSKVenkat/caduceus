# System Design Guide: Principles and Patterns

This guide explains the core principles and patterns of system design using Caduceus as a reference implementation. Caduceus is an autonomous coding agent that demonstrates several important system design concepts.

## 1. Core Architecture Principles

### 1.1 Single Responsibility Principle
Each component in Caduceus has a single, well-defined responsibility:
- **Orchestrator**: Manages the agent loop and control flow
- **Tool Registry**: Manages available tools and their specifications
- **Context Builder**: Assembles the system prompt for each turn
- **Model Client**: Handles communication with the AI model

### 11.2 Separation of Concerns
The system is organized into distinct layers:
- **Interface Layer**: Tools that interact with the external environment
- **Business Logic Layer**: Core agent logic and decision making
- **Data Layer**: Context management and memory systems

### 1.3 Modularity and Extensibility
Tools are designed as modular components that can be registered and used as needed. This allows the system to be extended with new capabilities without modifying existing code.

## 2. System Components

### 2.1 Agent Loop (Orchestrator)
The core of the system is a bounded reason-act loop:

```
1. Assemble context (system prompt + user task)
2. Call the model
3. Execute any requested tools
4. Append results and repeat until completion
```

Key features:
- **Bounded execution**: Maximum step limit prevents infinite loops
- **Circuit breaker**: Stops execution after consecutive errors
- **State management**: Maintains message history across steps

### 2.2 Tool System
Tools are the primary way the agent interacts with the environment:

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run(rawArgs: unknown, ctx: ToolContext): Promise<string>;
}
```

Design patterns:
- **Type safety**: Zod validation at the boundary
- **Error handling**: Specific error types for different failure modes
- **Context isolation**: Each tool receives a controlled execution context

### 2.3 Context Management
The system uses a tiered approach to context:

1. **Stable context**: Identity, tools, and skill catalog (cached)
2. **Project context**: Files, knowledge, and memory
3. **Volatile context**: Timestamp and dynamic information

This approach optimizes for cache efficiency while maintaining flexibility.

## 3. Design Patterns Used

### 3.1 Factory Pattern
Tools are created using a factory function (`defineTool`) that handles common concerns like validation and error handling.

### 3.2 Registry Pattern
The `ToolRegistry` manages available tools, providing a clean interface for registration and retrieval.

### 3.3 Strategy Pattern
Different tools implement the same interface but have different behaviors, allowing the system to treat them uniformly.

### 3.4 Decorator Pattern
The tool execution pipeline adds functionality like compression and error handling without modifying the core tool logic.

## 4. Error Handling and Reliability

### 4.1 Circuit Breaker
The system stops execution after 3 consecutive tool failures to prevent infinite loops or resource exhaustion.

### 4.2 Validation Boundaries
All external input is validated using Zod schemas before being processed by the system, preventing type-related errors in the core logic.

### 4.3 Graceful Degradation
When optional features like compression fail, the system continues with the original data rather than failing completely.

## 5. Performance Considerations

### 5.1 Context Caching
The system prompt is assembled in tiers to maximize cache efficiency - stable parts are kept consistent to benefit from LLM context caching.

### 5.2 Output Compression
Large tool outputs can be compressed to reduce token usage while maintaining functionality.

### 5.3 Lazy Loading
Large artifacts and detailed knowledge are loaded on demand rather than included in every prompt.

## 6. Security Considerations

### 6.1 Sandboxing
Shell commands are executed in a restricted environment with sensitive environment variables scrubbed.

### 6.2 Input Validation
All tool arguments are validated before execution to prevent injection attacks.

### 6.3 Resource Limits
Timeouts and output limits prevent resource exhaustion.

## 7. Scalability Patterns

### 7.1 Horizontal Separation
Different concerns are handled by separate components that can be scaled independently.

### 7.2 Statelessness
Most components are stateless, making horizontal scaling easier.

### 7.3 Asynchronous Processing
I/O operations are performed asynchronously to maximize throughput.

## 8. Observability

### 8.1 Event Streaming
The system emits events during execution that can be used for monitoring and debugging.

### 8.2 Structured Logging
Events are emitted in a structured format that can be easily parsed and analyzed.

## 9. Key Design Decisions

### 9.1 Typed Boundaries
Using Zod for validation at system boundaries ensures type safety throughout the system while keeping the core logic clean.

### 9.2 Functional Core, Imperative Shell
Core logic is implemented as pure functions where possible, with I/O operations handled at the boundaries.

### 9.3 Explicit Error Handling
Errors are handled explicitly rather than using exceptions, making the system more predictable and easier to reason about.

## 10. Best Practices Demonstrated

1. **Small, focused modules**: Each file has a single responsibility
2. **Clear interfaces**: Well-defined contracts between components
3. **Comprehensive error handling**: Multiple layers of protection
4. **Performance optimization**: Caching, compression, and lazy loading
5. **Security by design**: Sandboxing and input validation built in
6. **Observability**: Rich event stream for monitoring and debugging
7. **Extensibility**: Plugin architecture for tools and skills
8. **Configuration over code**: Behavior controlled by configuration rather than hardcoding

This system design demonstrates how to build a robust, scalable, and maintainable agent system that can safely interact with complex environments while maintaining performance and reliability.