import z from "zod";

export const PreInterviewBody = z.object({
    github: z.string(),
    role: z.string().min(2).max(80).default("Full-stack"),
    experience: z.string().min(2).max(80).default("Intermediate"),
    difficulty: z.string().min(2).max(80).default("Medium"),
    duration: z.number().int().min(5).max(60).default(15),
    topics: z.array(z.string().min(1).max(80)).max(8).default([]),
    resumeText: z.string().max(50000).optional(),
})
