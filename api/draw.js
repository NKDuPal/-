const { createClient } = require("@supabase/supabase-js");

function zodiacFromDate(dateStr) {
  const d = new Date(dateStr);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if ((m === 3 && day >= 21) || (m === 4 && day <= 19)) return "양자리";
  if ((m === 4 && day >= 20) || (m === 5 && day <= 20)) return "황소자리";
  if ((m === 5 && day >= 21) || (m === 6 && day <= 21)) return "쌍둥이자리";
  if ((m === 6 && day >= 22) || (m === 7 && day <= 22)) return "게자리";
  if ((m === 7 && day >= 23) || (m === 8 && day <= 22)) return "사자자리";
  if ((m === 8 && day >= 23) || (m === 9 && day <= 22)) return "처녀자리";
  if ((m === 9 && day >= 23) || (m === 10 && day <= 22)) return "천칭자리";
  if ((m === 10 && day >= 23) || (m === 11 && day <= 22)) return "전갈자리";
  if ((m === 11 && day >= 23) || (m === 12 && day <= 24)) return "사수자리";
  if ((m === 12 && day >= 25) || (m === 1 && day <= 19)) return "염소자리";
  if ((m === 1 && day >= 20) || (m === 2 && day <= 18)) return "물병자리";
  return "물고기자리";
}

function seedFrom(dateStr, zodiac) {
  let seed = 2166136261;
  const input = `${dateStr}:${zodiac}`;
  for (let i = 0; i < input.length; i++) {
    seed ^= input.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function seededNumbers(seed) {
  const pool = Array.from({ length: 45 }, (_, i) => i + 1);
  let state = seed || 1;
  const rand = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 6).sort((a, b) => a - b);
}

async function callOpenAI({ birthDate, zodiac, numbers, seed }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const prompt = [
    `생년월일 ${birthDate}의 별자리는 ${zodiac}입니다.`,
    `시드 ${seed}로 뽑힌 로또 번호는 ${numbers.join(", ")}입니다.`,
    "한국어로 1~2문장, 짧고 자연스럽게 결과 안내를 작성하세요.",
  ].join(" ");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: 120,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.output_text || null;
}

function makeSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { birthDate } = req.body || {};
    if (!birthDate) {
      res.status(400).json({ error: "birthDate is required" });
      return;
    }

    const zodiac = zodiacFromDate(birthDate);
    const seed = seedFrom(birthDate, zodiac);
    const numbers = seededNumbers(seed);
    const reply =
      (await callOpenAI({ birthDate, zodiac, numbers, seed })) ||
      `${zodiac}의 흐름에 맞춰 ${numbers.join(", ")}번을 뽑았습니다.`;

    const supabase = makeSupabaseClient();
    if (supabase) {
      const table = process.env.SUPABASE_TABLE || "lotto_draws";
      const { error } = await supabase.from(table).insert({
        birth_date: birthDate,
        zodiac,
        seed,
        numbers,
        reply,
      });
      if (error) throw error;
    }

    res.status(200).json({ zodiac, numbers, seed, reply });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
