const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || "lotto_draws";

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function callOpenAI({ birthDate, zodiac, numbers, seed }) {
  if (!OPENAI_API_KEY) return null;
  const prompt = [
    `생년월일 ${birthDate}의 별자리는 ${zodiac}입니다.`,
    `시드 ${seed}로 뽑힌 로또 번호는 ${numbers.join(", ")}입니다.`,
    "한국어로 1~2문장, 짧고 자연스럽게 결과 안내를 작성하세요.",
  ].join(" ");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
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

async function saveToSupabase(record) {
  if (!supabase) return null;

  const { error } = await supabase.from(SUPABASE_TABLE).insert(record);
  if (error) throw error;
  return true;
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  const type = MIME[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/") {
    return serveFile(res, path.join(__dirname, "index.html"));
  }

  if (req.method === "POST" && url.pathname === "/api/draw") {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body || "{}");
      const birthDate = parsed.birthDate;
      if (!birthDate) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ error: "birthDate is required" }));
      }

      const zodiac = zodiacFromDate(birthDate);
      const seed = seedFrom(birthDate, zodiac);
      const numbers = seededNumbers(seed);
      const reply = await callOpenAI({ birthDate, zodiac, numbers, seed }) ||
        `${zodiac}의 흐름에 맞춰 ${numbers.join(", ")}번을 뽑았습니다.`;

      await saveToSupabase({
        birth_date: birthDate,
        zodiac,
        seed,
        numbers,
        reply,
      });

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ zodiac, numbers, seed, reply }));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: error.message }));
    }
  }

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({
      ok: true,
      supabase: Boolean(supabase),
      openai: Boolean(OPENAI_API_KEY),
    }));
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
