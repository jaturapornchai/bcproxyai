// Shared chat prompt categories for load tests.
// Diverse mix of Thai/English and small/medium prompt sizes.
export const categories = [
  { name: 'thai_small',     body: { model: 'bcproxy/auto', messages: [{ role: 'user', content: 'สวัสดี ตอบสั้นๆ' }] } },
  { name: 'code_small',     body: { model: 'bcproxy/auto', messages: [{ role: 'user', content: 'Python fn reverse string' }] } },
  { name: 'general_medium', body: { model: 'bcproxy/auto', messages: [{ role: 'user', content: 'Explain photosynthesis in 3 sentences for a 10-year-old.' }] } },
  { name: 'thai_medium',    body: { model: 'bcproxy/auto', messages: [{ role: 'user', content: 'อธิบายการทำงานของ AI 3 ย่อหน้า สำหรับเด็ก 10 ขวบ' }] } },
];

export function pickCategory() {
  return categories[Math.floor(Math.random() * categories.length)];
}
