const URL = 'https://smlgateway.smlsoftdemo.com';
const KEY = process.env.GATEWAY_API_KEY;
const prompts = [
  'ลูกค้าจังหวัดเชียงใหม่ มีกี่ร้าน',
  'งาน: พ่วงขาย ชักโครก + ท่อ — ช่วยลดต้นทุนยังไง',
  'ยี่ห้อ KARAT มีสินค้าอะไรบ้าง',
  'สรุปยอดขายเมษายนเป็นภาษาไทย',
  'ร้านไหนซื้อเยอะสุดในภาคเหนือ',
  'ลูกค้า VIP มีกี่ราย',
  'สินค้าขายดี 10 อันดับแรก',
];
for (const p of prompts) {
  const r = await fetch(URL + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
    body: JSON.stringify({
      model: 'bcai/auto',
      messages: [{ role: 'user', content: p }],
      max_tokens: 100,
      stream: false,
    }),
  });
  const j = await r.json();
  if (j.error) console.log(`HTTP ${r.status} — ${j.error.message}`);
  else {
    const ans = j.choices[0]?.message?.content || '';
    const thai = [...ans].filter(
      (c) => c.codePointAt(0) >= 0x0e00 && c.codePointAt(0) <= 0x0e7f,
    ).length;
    console.log(`${r.status}  model=${j.model}  thai=${thai}`);
  }
  await new Promise((r) => setTimeout(r, 500));
}
