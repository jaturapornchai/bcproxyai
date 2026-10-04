// Getting-started checklist — derived from live gateway state so the steps
// tick themselves off as the user actually completes them.

export interface OnboardingInput {
  /** providers that have an API key saved (env or DB) */
  providersWithKey: number;
  /** models that passed the entrance exam (= routable) */
  modelsPassed: number;
  /** successful chat requests seen by the gateway */
  successfulRequests: number;
  /** client wired up: a bcai_live_ key exists or the user confirmed it */
  clientConnected: boolean;
}

export type StepStatus = "done" | "current" | "todo";

export interface OnboardingStep {
  id: "provider" | "exam" | "first-request" | "connect";
  title: string;
  description: string;
  href: string;
  cta: string;
  status: StepStatus;
}

export interface OnboardingState {
  steps: OnboardingStep[];
  completed: number;
  total: number;
  percent: number;
  /** id of the first unfinished step, null when everything is done */
  currentId: OnboardingStep["id"] | null;
}

const STEPS: Array<Omit<OnboardingStep, "status"> & { done: (i: OnboardingInput) => boolean }> = [
  {
    id: "provider",
    title: "เพิ่ม API key ของผู้ให้บริการ",
    description: "ใส่ key ฟรีอย่างน้อย 1 เจ้า เช่น OpenRouter หรือ Groq — ระบบจะค้นหาโมเดลให้เอง",
    href: "/setup",
    cta: "ไปใส่ key",
    done: (i) => i.providersWithKey > 0,
  },
  {
    id: "exam",
    title: "รอระบบสอบคัดเลือกโมเดล",
    description: "ระบบทดสอบโมเดลทุกตัวอัตโนมัติ ตัวที่สอบผ่านจะถูกใช้ตอบจริง (ประมาณ 1–3 นาที)",
    href: "/models",
    cta: "ดูผลสอบ",
    done: (i) => i.modelsPassed > 0,
  },
  {
    id: "first-request",
    title: "ทดลองส่งข้อความแรก",
    description: "คุยกับ AI ในหน้าทดลองแชท เพื่อยืนยันว่าทุกอย่างทำงาน",
    href: "/playground",
    cta: "เปิดหน้าทดลองแชท",
    done: (i) => i.successfulRequests > 0,
  },
  {
    id: "connect",
    title: "เชื่อมแอปของคุณ",
    description: "ชี้ base URL ของแอปมาที่ BCAiRouter แล้วใช้ model bcai/auto ได้ทันที",
    href: "/admin/keys",
    cta: "สร้าง API key",
    done: (i) => i.clientConnected,
  },
];

export function computeOnboarding(input: OnboardingInput): OnboardingState {
  const doneFlags = STEPS.map((s) => s.done(input));
  const firstOpen = doneFlags.indexOf(false);
  const steps = STEPS.map(({ done: _done, ...s }, idx): OnboardingStep => ({
    ...s,
    status: doneFlags[idx] ? "done" : idx === firstOpen ? "current" : "todo",
  }));
  const completed = doneFlags.filter(Boolean).length;
  return {
    steps,
    completed,
    total: steps.length,
    percent: Math.round((completed / steps.length) * 100),
    currentId: firstOpen === -1 ? null : steps[firstOpen].id,
  };
}
