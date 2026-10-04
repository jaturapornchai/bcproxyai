import type { Metadata } from "next";
import { Landing } from "@/components/landing/Landing";

const TITLE = "BCAiRouter — เกตเวย์ AI ส่วนตัว ชมการทำงานสด";
const DESCRIPTION =
  "เกตเวย์ AI ส่วนตัวที่เลือกโมเดลฟรีให้อัตโนมัติ — ชมกาแล็กซีของผู้ให้บริการและคำขอแบบสดได้ ใช้งานได้เฉพาะเจ้าของระบบ";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", locale: "th_TH", siteName: "BCAiRouter" },
};

export default function HomePage() {
  return <Landing />;
}
