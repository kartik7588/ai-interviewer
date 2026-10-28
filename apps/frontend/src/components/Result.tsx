import { BACKEND_URL } from "@/lib/config";
import axios from "axios";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Bot, Clipboard, Download, Loader2, Sparkles, User } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { authHeaders } from "../lib/auth";

interface ResultData {
    transcript: { type: "Assistant" | "User"; content: string; createdAt: string }[];
    score: number;
    feedback: string;
    status: "Done" | "InProgress" | "Pre";
    strengths?: string[];
    weaknesses?: string[];
    studyPlan?: string;
    skillScores?: { skill: string; score: number; feedback: string }[];
}

type TranscriptTurn = ResultData["transcript"][number];

function groupTranscript(messages: TranscriptTurn[]) {
    return messages.reduce<TranscriptTurn[]>((turns, message) => {
        const content = message.content.trim();
        if (!content) return turns;

        const previous = turns.at(-1);
        if (previous?.type === message.type) {
            previous.content = `${previous.content} ${content}`.replace(/\s+/g, " ");
        } else {
            turns.push({ ...message, content });
        }
        return turns;
    }, []);
}

export function Result() {
    const { interviewId } = useParams();
    const navigate = useNavigate();
    const [result, setResult] = useState<ResultData>({
        score: 0,
        feedback: "",
        transcript: [],
        status: "Pre",
    });

    useEffect(() => {
        const fetchResult = () =>
            axios.get(`${BACKEND_URL}/api/v1/result/${interviewId}`, { headers: authHeaders() }).then((response) => {
                setResult(response.data);
                return response.data.status as ResultData["status"];
            });

        fetchResult();
        const intervalId = setInterval(async () => {
            const s = await fetchResult();
            if (s === "Done") clearInterval(intervalId);
        }, 5000);

        return () => clearInterval(intervalId);
    }, [interviewId]);

    const ready = result.status === "Done";
    const conversation = groupTranscript(result.transcript);

    const reportText = [
        "AI Interview Report",
        `Score: ${result.score}/10`,
        "",
        "Feedback",
        result.feedback,
        "",
        "Skill scores",
        ...(result.skillScores || []).map(skill => `${skill.skill}: ${skill.score}/10 — ${skill.feedback}`),
        "",
        "Strengths",
        ...(result.strengths || []).map(item => `- ${item}`),
        "",
        "Areas to improve",
        ...(result.weaknesses || []).map(item => `- ${item}`),
        "",
        "Study plan",
        result.studyPlan || "",
        "",
        "Conversation",
        ...conversation.map((turn) => `${turn.type === "Assistant" ? "Interviewer" : "You"}: ${turn.content}`),
    ].join("\n");

    async function copyReport() {
        await navigator.clipboard.writeText(reportText);
        toast.success("Report copied to your clipboard.");
    }

    function downloadReport() {
        const blob = new Blob([reportText], { type: "text/plain;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "ai-interview-report.txt";
        link.click();
        URL.revokeObjectURL(link.href);
    }

    return (
        <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-12">
            <header className="mb-10 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Interview results</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Your feedback and full conversation transcript.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {ready && (
                        <>
                            <Button variant="outline" size="sm" onClick={copyReport} className="gap-2">
                                <Clipboard className="size-4" />
                                Copy
                            </Button>
                            <Button variant="outline" size="sm" onClick={downloadReport} className="gap-2">
                                <Download className="size-4" />
                                Download
                            </Button>
                        </>
                    )}
                    <Button variant="outline" onClick={() => navigate("/")}>
                        New interview
                    </Button>
                </div>
            </header>

            {!ready ? (
                <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card/50 py-24 text-center">
                    <Loader2 className="size-7 animate-spin text-muted-foreground" />
                    <div>
                        <p className="font-medium">Analyzing your interview…</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                            This usually takes a few seconds.
                        </p>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-8">
                    {/* Score + feedback */}
                    <section className="rounded-xl border border-border bg-card/60 p-6 backdrop-blur">
                        <div className="flex items-start justify-between gap-6">
                            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                                <Sparkles className="size-4 text-violet-400" />
                                AI Feedback
                            </div>
                            <div className="flex shrink-0 items-baseline gap-1">
                                <span className="text-3xl font-bold tracking-tight">
                                    {result.score}
                                </span>
                                <span className="text-sm text-muted-foreground">/ 10</span>
                            </div>
                        </div>
                        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                            {result.feedback}
                        </p>
                    </section>

                    {(result.skillScores?.length || result.strengths?.length || result.weaknesses?.length || result.studyPlan) && <section className="grid gap-5 md:grid-cols-2">
                        <div className="rounded-xl border border-border bg-card/60 p-5"><h2 className="font-semibold">Skill breakdown</h2><div className="mt-4 space-y-4">{result.skillScores?.map(skill => <div key={skill.skill}><div className="flex justify-between gap-3 text-sm"><span className="font-medium">{skill.skill}</span><span className="text-primary">{skill.score}/10</span></div><p className="mt-1 text-sm text-muted-foreground">{skill.feedback}</p></div>)}</div></div>
                        <div className="space-y-5"><div className="rounded-xl border border-border bg-card/60 p-5"><h2 className="font-semibold">Strengths</h2><ul className="mt-3 space-y-2 text-sm text-muted-foreground">{result.strengths?.map(item => <li key={item}>• {item}</li>)}</ul></div><div className="rounded-xl border border-border bg-card/60 p-5"><h2 className="font-semibold">Focus next</h2><ul className="mt-3 space-y-2 text-sm text-muted-foreground">{result.weaknesses?.map(item => <li key={item}>• {item}</li>)}</ul></div></div>
                        {result.studyPlan && <div className="md:col-span-2 rounded-xl border border-primary/30 bg-primary/5 p-5"><h2 className="font-semibold">Personalised study plan</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{result.studyPlan}</p></div>}
                    </section>}

                    {/* Transcript */}
                    <section>
                        <h2 className="mb-4 text-sm font-medium text-muted-foreground">
                            Conversation
                        </h2>
                        <div className="flex flex-col gap-4">
                            {conversation.length === 0 && (
                                <p className="text-sm text-muted-foreground">
                                    No messages were recorded for this interview.
                                </p>
                            )}
                            {conversation.map((m, i) => {
                                const isAi = m.type === "Assistant";
                                return (
                                    <div
                                        key={i}
                                        className={cn(
                                            "flex gap-3",
                                            isAi ? "justify-start" : "flex-row-reverse",
                                        )}
                                    >
                                        <div
                                            className={cn(
                                                "grid size-8 shrink-0 place-items-center rounded-full text-white",
                                                isAi
                                                    ? "bg-violet-600"
                                                    : "bg-teal-600",
                                            )}
                                        >
                                            {isAi ? (
                                                <Bot className="size-4" />
                                            ) : (
                                                <User className="size-4" />
                                            )}
                                        </div>
                                        <div
                                            className={cn(
                                                "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                                                isAi
                                                    ? "rounded-tl-sm bg-card text-foreground"
                                                    : "rounded-tr-sm bg-primary text-primary-foreground",
                                            )}
                                        >
                                            {m.content}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                </div>
            )}
        </main>
    );
}
