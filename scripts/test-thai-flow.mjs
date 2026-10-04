const KEY = process.env.GATEWAY_API_KEY;
const URL = 'https://smlgateway.smlsoftdemo.com';

const prompt = 'พิมพ์คำว่า สวัสดีครับ เท่านั้น ไม่ต้องพูดอย่างอื่น';

for (let i = 1; i <= 3; i++) {
  try {
    const r = await fetch(`${URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        model: 'bcai/auto',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 40,
        stream: false,
      }),
    });
    const j = await r.json();
    if (j.error) {
      console.log(`[${i}] ERR HTTP${r.status}: ${j.error.message}`);
      continue;
    }
    const ans = j.choices[0]?.message?.content || '';
    const thai = [...ans].filter(
      (c) => c.codePointAt(0) >= 0x0e00 && c.codePointAt(0) <= 0x0e7f,
    ).length;
    const qs = [...ans].filter((c) => c === '?').length;
    const ratio = ans.length ? (qs / ans.length).toFixed(2) : '1';
    console.log(`[${i}] model=${j.model} thai=${thai} ?=${qs} ratio=${ratio}`);
    console.log(`     preview=${JSON.stringify(ans.slice(0, 120))}`);
  } catch (e) {
    console.log(`[${i}] ERR ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
