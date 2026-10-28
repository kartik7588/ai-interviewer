import express from "express";
import { PreInterviewBody } from "./types";
import { scrapeGithub } from "./scrapers/github";
import cors from "cors";
import { prisma } from "./db";
import { calculateResult } from "./result";
import { GoogleGenAI, Modality } from "@google/genai";
import { z } from "zod";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const app = express();
const port = Number(process.env.PORT || 3001);
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:3000,http://localhost:5173").split(",").map(origin => origin.trim());
const requestBuckets = new Map<string, { count: number; resetAt: number }>();
function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  console[level](JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields }));
}
function withRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  return operation().catch(async error => {
    const status = error?.status || error?.error?.code;
    if (attempts <= 1 || ![429, 500, 502, 503, 504].includes(Number(status))) throw error;
    await new Promise(resolve => setTimeout(resolve, (4 - attempts) * 700));
    return withRetry(operation, attempts - 1);
  });
}
app.use(express.json());
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)) }));
app.use(express.text({ type: ["application/sdp", "text/plain"] }));
app.use((req, res, next) => {
  const requestId = crypto.randomUUID();
  const client = req.ip || "unknown";
  const now = Date.now();
  const bucket = requestBuckets.get(client);
  const active = !bucket || bucket.resetAt <= now ? { count: 0, resetAt: now + 60_000 } : bucket;
  active.count += 1; requestBuckets.set(client, active);
  if (active.count > 90) return res.status(429).json({ message: "Too many requests. Please wait a minute and try again." });
  res.setHeader("X-Request-Id", requestId);
  res.on("finish", () => log(res.statusCode >= 500 ? "error" : "info", "http_request", { requestId, method: req.method, path: req.path, status: res.statusCode }));
  next();
});
const finalizingInterviews = new Set<string>();
const sessions = new Map<string, string>();
const Credentials = z.object({ email: z.string().email(), password: z.string().min(8).max(128) });
function currentUserId(req: express.Request) { const token = req.header("authorization")?.replace("Bearer ", ""); return token ? sessions.get(token) : undefined; }
function issueSession(userId: string) { const token = crypto.randomUUID(); sessions.set(token, userId); return token; }

app.post("/api/v1/auth/register", async (req, res) => {
  const parsed = Credentials.safeParse(req.body); if (!parsed.success) return res.status(400).json({ message: "Use a valid email and an 8-character password." });
  if (await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } })) return res.status(409).json({ message: "An account with this email already exists." });
  const user = await prisma.user.create({ data: { email: parsed.data.email.toLowerCase(), passwordHash: await Bun.password.hash(parsed.data.password) } });
  res.status(201).json({ token: issueSession(user.id), user: { id: user.id, email: user.email } });
});
app.post("/api/v1/auth/login", async (req, res) => {
  const parsed = Credentials.safeParse(req.body); if (!parsed.success) return res.status(400).json({ message: "Invalid email or password." });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !(await Bun.password.verify(parsed.data.password, user.passwordHash))) return res.status(401).json({ message: "Invalid email or password." });
  res.json({ token: issueSession(user.id), user: { id: user.id, email: user.email } });
});
app.post("/api/v1/auth/demo", async (_req, res) => {
  const email = "demo@ai-interviewer.local";
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({ data: { email, passwordHash: await Bun.password.hash(crypto.randomUUID()) } });
  }
  res.json({ token: issueSession(user.id), user: { id: user.id, email: user.email }, demo: true });
});
app.post("/api/v1/resume/parse", express.raw({ type: "application/pdf", limit: "10mb" }), async (req, res) => {
  if (!currentUserId(req)) return res.status(401).json({ message: "Sign in to upload a resume." });
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ message: "Upload a PDF resume." });
  try {
    const pdf = await getDocument({ data: new Uint8Array(req.body) }).promise;
    const pages = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
      const content = await (await pdf.getPage(index + 1)).getTextContent();
      return content.items.map((item: any) => item.str || "").join(" ");
    }));
    const text = pages.join("\n").replace(/\s+/g, " ").trim().slice(0, 50000);
    if (!text) return res.status(422).json({ message: "We could not read text from this PDF. Please upload a text-based resume." });
    res.json({ text, pages: pdf.numPages });
  } catch (error) {
    console.error("Resume parsing failed:", error);
    res.status(422).json({ message: "We could not read this PDF. Please upload a standard text-based resume." });
  }
});
app.get("/api/v1/interviews", async (req, res) => {
  const userId = currentUserId(req); if (!userId) return res.status(401).json({ message: "Sign in required." });
  res.json(await prisma.interview.findMany({ where: { userId }, orderBy: { id: "desc" }, select: { id: true, role: true, experience: true, difficulty: true, duration: true, score: true, status: true } }));
});
app.post("/api/v1/pre-interview", async (req, res) => { 
    const userId = currentUserId(req);
    if (!userId) { res.status(401).json({ message: "Sign in to start an interview." }); return; }
    const { success, data } = PreInterviewBody.safeParse(req.body) ;

    if (!success) {
        res.status(411).json({
            message: "Incorrect body"
        });
        return 
    }

    let githubUsername: string;
    try {
        const githubUrl = new URL(data.github);
        const pathParts = githubUrl.pathname.split("/").filter(Boolean);
        if (!["github.com", "www.github.com"].includes(githubUrl.hostname) || pathParts.length !== 1) {
            throw new Error("Invalid GitHub profile URL");
        }
        githubUsername = pathParts[0]!;
    } catch {
        res.status(400).json({ message: "Enter a GitHub profile URL, for example https://github.com/octocat." });
        return;
    }

    let githubData;
    try {
        githubData = await scrapeGithub(githubUsername);
    } catch (error) {
        console.error("GitHub profile lookup failed:", error);
        res.status(502).json({ message: "We could not read that GitHub profile. Check the URL and try again." });
        return;
    }

    const interview = await prisma.interview.create({
        data: {
            githubMetadata: JSON.stringify(githubData),
            status: "Pre", userId, role: data.role, experience: data.experience,
            difficulty: data.difficulty, duration: data.duration, topics: data.topics, resumeText: data.resumeText,
        }
    })

    res.json({ id: interview.id });
})

app.post("/api/v1/session/:interviewId", async (req, res) => {
    const userId = currentUserId(req);
    const interview = await prisma.interview.findFirst({ where: { id: req.params.interviewId, userId } });
    if (!interview) {
        res.status(404).json({ error: "Interview not found" });
        return;
    }
    if (!process.env.GEMINI_API_KEY) {
        res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
        return;
    }

    try {
        // The browser receives only a one-use token, never the permanent API key.
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: "v1beta" } });
        const token = await withRetry(() => ai.authTokens.create({
            config: {
                uses: 1,
                liveConnectConstraints: {
                    model: "gemini-3.8-live",
                    config: {
                        responseModalities: [Modality.AUDIO],
                        inputAudioTranscription: {},
                        outputAudioTranscription: {},
                        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } },
                        systemInstruction: `You are a friendly, rigorous computer-science interviewer. The candidate is applying for a ${interview.role} role at ${interview.experience} level. Use ${interview.difficulty} difficulty. The interview is intended to last about ${interview.duration} minutes and should emphasize these topics: ${JSON.stringify(interview.topics)}. Ask focused questions based on the candidate's experience, follow up on their answers, and use English only. Keep questions concise. Before every next question, silently assess the candidate's last answer for correctness, completeness, clarity, and evidence. If it is weak, vague, or incomplete, ask one concrete deeper follow-up on the same idea. If it is strong, acknowledge it briefly and increase the difficulty or breadth of the next question. Never reveal numeric assessment scores during the live interview.\n\nCandidate GitHub metadata:\n${interview.githubMetadata}\n\nCandidate resume text (may be empty):\n${interview.resumeText || "No resume supplied."}`,
                    },
                },
                lockAdditionalFields: [],
            },
        }));
        if (!token.name) throw new Error("Gemini did not return an ephemeral token");
        res.json({ token: token.name });
    } catch (error) {
        console.error("Gemini token generation error:", error);
        res.status(500).json({ error: "Failed to create Gemini Live session" });
    }
});

app.post("/api/v1/session/user/response/:interviewId", async (req, res) => {
  const { message } = req.body;
  await prisma.message.create({
    data: {
        interviewId: req.params.interviewId!,
        type: "User",
        message: message
    }
  });

  res.json({message: "Message saved"});
})

app.patch("/api/v1/session/user/response/:interviewId", async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) return res.status(400).json({ message: "A corrected response is required." });
  const latest = await prisma.message.findFirst({ where: { interviewId: req.params.interviewId, type: "User" }, orderBy: { createdAt: "desc" } });
  if (!latest) return res.status(404).json({ message: "No transcribed response is available to correct yet." });
  await prisma.message.update({ where: { id: latest.id }, data: { message } });
  res.json({ message: "Correction saved." });
});

app.post("/api/v1/session/assistant/response/:interviewId", async (req, res) => {
  const { message } = req.body;
  if (typeof message !== "string" || !message.trim()) {
    res.status(400).json({ message: "A message is required" });
    return;
  }
  await prisma.message.create({
    data: { interviewId: req.params.interviewId!, type: "Assistant", message },
  });
  res.json({ message: "Message saved" });
})

app.post("/api/v1/interview/:interviewId/complete", async (req, res) => {
  const interviewId = req.params.interviewId!;
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: { conversations: { orderBy: { createdAt: "asc" } } },
  });

  if (!interview) {
    res.status(404).json({ message: "Interview not found" });
    return;
  }
  if (interview.status === "Done") {
    res.json({ status: "Done" });
    return;
  }
  if (finalizingInterviews.has(interviewId)) {
    res.status(202).json({ status: "InProgress" });
    return;
  }

  finalizingInterviews.add(interviewId);
  await prisma.interview.update({ where: { id: interviewId }, data: { status: "InProgress" } });
  res.status(202).json({ status: "InProgress" });

  try {
    const result = await withRetry(() => calculateResult(interview.conversations));
    await prisma.interview.update({
      where: { id: interviewId },
      data: { status: "Done", feedback: result.feedback, score: result.score, studyPlan: result.studyPlan, strengths: result.strengths, weaknesses: result.weaknesses, skillScores: { deleteMany: {}, create: result.skillScores } },
    });
  } catch (error) {
    console.error("Interview evaluation failed:", error);
    await prisma.interview.update({ where: { id: interviewId }, data: { status: "Pre" } });
  } finally {
    finalizingInterviews.delete(interviewId);
  }
});

app.get("/api/v1/result/:interviewId", async (req, res) => {
  const userId = currentUserId(req);
  if (!userId) return res.status(401).json({ message: "Sign in required." });
  const interview = await prisma.interview.findFirst({
    where: {
      id: req.params.interviewId, userId
    },
    include: { conversations: { orderBy: { createdAt: "asc" } }, skillScores: true }
  })

  if (!interview) {
    res.status(411).json({
      message: "Interview not found"
    })
    return 
  }

  res.json({
    score: interview?.score,
    feedback: interview?.feedback,
    transcript: interview?.conversations.map(c => ({
      type: c.type,
      content: c.message,
      createdAt: c.createdAt
    })),
    status: interview.status,
    studyPlan: interview.studyPlan,
    strengths: interview.strengths,
    weaknesses: interview.weaknesses,
    skillScores: interview.skillScores
  })

})

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log("error", "unhandled_request_error", { error: error instanceof Error ? error.message : String(error) });
  if (!res.headersSent) res.status(500).json({ message: "Unexpected server error. Please try again." });
});

app.listen(port, () => log("info", "server_started", { port, environment: process.env.NODE_ENV || "development" }));
