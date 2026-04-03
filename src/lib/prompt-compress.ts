/**
 * Compress messages to reduce token count.
 * Strategy:
 * 1. If total estimated tokens < threshold (30K), don't compress
 * 2. Keep system message as-is (important context)
 * 3. Keep last 3 user+assistant messages as-is (recent context)
 * 4. Summarize older messages into a single system message
 * 5. Remove duplicate/similar messages
 * 6. Truncate very long individual messages (> 2000 chars) to first+last 500 chars
 */

interface Message {
  role: string;
  content: unknown;
}

export function compressMessages(messages: Message[]): { messages: Message[]; compressed: boolean; savedChars: number } {
  const originalLength = JSON.stringify(messages).length;

  // Estimate tokens (~3 chars per token)
  const estTokens = Math.ceil(originalLength / 3);

  // Don't compress if small enough
  if (estTokens < 30000 || messages.length <= 5) {
    return { messages, compressed: false, savedChars: 0 };
  }

  const result: Message[] = [];

  // Keep system messages
  const systemMsgs = messages.filter(m => m.role === "system");
  const nonSystem = messages.filter(m => m.role !== "system");

  // Keep last 3 conversation turns (6 messages: 3 user + 3 assistant)
  const recentCount = Math.min(6, nonSystem.length);
  const oldMessages = nonSystem.slice(0, -recentCount);
  const recentMessages = nonSystem.slice(-recentCount);

  // Summarize old messages
  if (oldMessages.length > 0) {
    const summary = oldMessages.map(m => {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      // Truncate each old message to 100 chars
      return `[${m.role}]: ${content.slice(0, 100)}`;
    }).join("\n");

    result.push(...systemMsgs);
    result.push({
      role: "system",
      content: `[Previous conversation summary - ${oldMessages.length} messages compressed]:\n${summary.slice(0, 2000)}`
    });
  } else {
    result.push(...systemMsgs);
  }

  // Add recent messages, truncating very long ones
  for (const msg of recentMessages) {
    if (typeof msg.content === "string" && msg.content.length > 2000) {
      result.push({
        ...msg,
        content: msg.content.slice(0, 500) + "\n...[truncated]...\n" + msg.content.slice(-500)
      });
    } else {
      result.push(msg);
    }
  }

  const compressedLength = JSON.stringify(result).length;
  return {
    messages: result,
    compressed: true,
    savedChars: originalLength - compressedLength
  };
}
