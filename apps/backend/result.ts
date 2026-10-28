import { z } from "zod";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY!});

const outputSchema = z.object({
    feedback: z.string(),
    score: z.int().min(0).max(10),
    strengths: z.array(z.string()).max(5),
    weaknesses: z.array(z.string()).max(5),
    studyPlan: z.string(),
    skillScores: z.array(z.object({ skill: z.string(), score: z.int().min(0).max(10), feedback: z.string() })).length(5),
});

const RESULT_PROMPT = `
    You are an expert technical-interview evaluator. Evaluate only the supplied interview transcript.
    Give a fair overall score out of 10, practical feedback, 3-5 strengths, 3-5 weaknesses, and a concise
    personalised study plan. Score these exact skills: DSA, System design, Communication, GitHub/project depth,
    and Problem-solving. Each skill needs a score out of 10 and one concise reason. If the transcript has little
    evidence for a skill, say that rather than inventing details. Return JSON only.
    {{USER_TRANSCRIPT}}
`

export async function calculateResult(messages: {type: "Assistant" | "User", message: string, createdAt: Date}[]) {
    const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: RESULT_PROMPT.replace(`{{USER_TRANSCRIPT}}`, JSON.stringify(messages)),
        config: {
            responseMimeType: "application/json",
            responseJsonSchema: {
                type: "object",
                properties: {
                    feedback: { type: "string" },
                    score: { type: "integer" },
                    strengths: { type: "array", items: { type: "string" } },
                    weaknesses: { type: "array", items: { type: "string" } },
                    studyPlan: { type: "string" },
                    skillScores: { type: "array", items: { type: "object", properties: { skill: { type: "string" }, score: { type: "integer" }, feedback: { type: "string" } }, required: ["skill", "score", "feedback"] } },
                },
                required: ["feedback", "score", "strengths", "weaknesses", "studyPlan", "skillScores"],
            },
        },
    });
    console.log(response.text!);
    const result = outputSchema.parse(JSON.parse(response.text!));
    return result;

}
