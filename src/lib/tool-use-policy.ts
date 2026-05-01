const THCLAWS_TEAM_TOOLS = new Set([
  "AskUserQuestion",
  "CheckInbox",
  "SendMessage",
  "TeamCreate",
  "TeamTaskCreate",
  "TeamTaskList",
  "TeamTaskComplete",
  "SpawnTeammate",
]);

const ACTION_RE = /\b(send|message|tell|ask|create|spawn|delegate|assign|task|check|inbox|team|teammate|agent|email|call|search|find|open|read|write|edit|fix|run|deploy|build|test)\b|ส่ง|บอก|ถาม|สร้าง|มอบหมาย|งาน|ทีม|เอเจนต์|ค้น|หา|เปิด|อ่าน|เขียน|แก้|รัน|ดีพลอย|ทดสอบ/i;
const SIMPLE_CHAT_RE = /^(hi|hello|hey|yo|ok|okay|thanks?|thank you|why|what|how|สวัสดี|หวัดดี|ดี|โอเค|ขอบคุณ|ทำไม|อะไร|ยังไง|อย่างไร|ครับ|ค่ะ|คับ)[\s.!?。！？]*$/i;
const THCLAWS_TOOL_RESULT_CHATTER_RE = /^(message sent to|no new messages\.?|success: task\b|\[\d+\]\s+\w+\s+[—-]|task_id:|output:\s*\[?\]?|error: tool error:|<teammate_message\b|\[teammate messages from:|## agents\b)|idle_notification/i;
const THCLAWS_STATUS_CHAT_RE = /ถึงไหน|เสร็จ.*(รายงาน|รานงาน)|สถานะ|คืบหน้า|ว่างไหม|ยังอยู่ไหม/i;

export function extractLastUserText(body: Record<string, unknown>): string {
  const messages = body.messages;
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: unknown; content?: unknown };
    if (msg.role !== "user") continue;
    if (typeof msg.content === "string") return msg.content.trim();
    if (Array.isArray(msg.content)) {
      return (msg.content as Array<{ type?: string; text?: string }>)
        .filter(part => part.type === "text" && typeof part.text === "string")
        .map(part => part.text)
        .join(" ")
        .trim();
    }
  }
  return "";
}

export function isThClawsTeamToolSet(toolNames: Set<string>): boolean {
  if (toolNames.size === 0) return false;
  if (toolNames.has("AskUserQuestion")) return true;
  let matches = 0;
  for (const name of toolNames) {
    if (THCLAWS_TEAM_TOOLS.has(name)) matches++;
  }
  return matches >= 3 || (toolNames.has("SendMessage") && toolNames.has("CheckInbox"));
}

export function shouldSuppressToolsForSimpleChat(
  body: Record<string, unknown>,
  toolNames: Set<string>,
): boolean {
  if (!isThClawsTeamToolSet(toolNames)) return false;
  const toolChoice = body.tool_choice;
  if (toolChoice && toolChoice !== "auto" && toolChoice !== "none") return false;

  const text = extractLastUserText(body);
  if (!text) return false;
  if (THCLAWS_TOOL_RESULT_CHATTER_RE.test(text)) return true;
  if (THCLAWS_STATUS_CHAT_RE.test(text)) return true;
  if (ACTION_RE.test(text)) return false;
  if (SIMPLE_CHAT_RE.test(text)) return true;
  return text.length <= 24 && !/[{}[\]();=<>]/.test(text);
}
