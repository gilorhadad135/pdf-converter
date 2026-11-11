import express from "express";
import multer from "multer";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TOKEN || ""; // אופציונלי: מגן על השרת
const MAX_MB = Number(process.env.MAX_MB || 50);
const ALLOWED = new Set([".pptx", ".ppt", ".docx", ".doc", ".odt", ".odp", ".rtf", ".xlsx", ".xls"]);

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024 } });

// המרה אחת בכל פעם – LibreOffice לא אוהב ריצות מקבילות
let queue = Promise.resolve();
const enqueue = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

function runSoffice(inputPath, outDir, profileDir) {
  return new Promise((resolve, reject) => {
    const p = spawn("soffice", [
      `-env:UserInstallation=file://${profileDir}`,
      "--headless", "--norestore", "--nolockcheck",
      "--convert-to", "pdf", "--outdir", outDir, inputPath,
    ]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new Error("timeout")); }, 120000);
    p.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(err || `exit ${code}`)); });
    p.on("error", reject);
  });
}

async function convert(buffer, ext) {
  const dir = await mkdtemp(path.join(tmpdir(), "conv-"));
  try {
    const input = path.join(dir, "input" + ext);
    await writeFile(input, buffer);
    await runSoffice(input, dir, path.join(dir, "profile"));
    return await readFile(path.join(dir, "input.pdf"));
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function auth(req, res, next) {
  if (!TOKEN) return next();
  const t = req.get("x-token") || req.query.token;
  if (t === TOKEN) return next();
  res.status(401).json({ error: "unauthorized" });
}

app.get("/healthz", (_req, res) => res.send("ok"));
app.get("/config", (_req, res) => res.json({ tokenRequired: !!TOKEN, maxMB: MAX_MB }));

// מקבל multipart (שדה בשם file) או גוף גולמי עם ?name=file.docx
app.post("/convert", auth, (req, res, next) => {
  if ((req.get("content-type") || "").startsWith("multipart/")) return upload.single("file")(req, res, next);
  express.raw({ type: () => true, limit: `${MAX_MB}mb` })(req, res, next);
}, async (req, res) => {
  try {
    const name = req.file ? Buffer.from(req.file.originalname, "latin1").toString("utf8") : (req.query.name || "file.docx");
    const buffer = req.file ? req.file.buffer : req.body;
    const ext = path.extname(name).toLowerCase();
    if (!buffer?.length) return res.status(400).json({ error: "no file" });
    if (!ALLOWED.has(ext)) return res.status(400).json({ error: `unsupported type ${ext}` });
    const pdf = await enqueue(() => convert(buffer, ext));
    const outName = path.basename(name, ext) + ".pdf";
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="converted.pdf"; filename*=UTF-8''${encodeURIComponent(outName)}`,
      "Access-Control-Expose-Headers": "Content-Disposition",
    });
    res.send(pdf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "conversion failed" });
  }
});

app.use(express.static(path.join(__dirname, "public")));
app.listen(PORT, () => console.log(`listening on ${PORT}`));
