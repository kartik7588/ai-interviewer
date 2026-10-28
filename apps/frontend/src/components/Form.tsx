import { useState } from "react";
import axios from "axios";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, FileText, Github, LayoutDashboard, Loader2, LogOut, Mic } from "lucide-react";
import { toast } from "sonner";
import { BACKEND_URL } from "@/lib/config";
import { authHeaders, clearSession, getSession } from "../lib/auth";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const topicOptions = ["React", "Node.js", "DSA", "System design", "Databases", "GitHub projects"];

export function Form() {
    const [github, setGithub] = useState(""); const [role, setRole] = useState("Full-stack"); const [experience, setExperience] = useState("Intermediate"); const [difficulty, setDifficulty] = useState("Medium"); const [duration, setDuration] = useState(15); const [topics, setTopics] = useState<string[]>(["GitHub projects", "Communication"]); const [resumeText, setResumeText] = useState(""); const [resumeName, setResumeName] = useState(""); const [parsingResume, setParsingResume] = useState(false);
    const [loading, setLoading] = useState(false); const navigate = useNavigate(); const session = getSession();
    function toggleTopic(topic: string) { setTopics(current => current.includes(topic) ? current.filter(item => item !== topic) : [...current, topic]); }
    async function uploadResume(file?: File) {
        if (!file) return;
        if (file.type !== "application/pdf") { toast.error("Please choose a PDF resume."); return; }
        setParsingResume(true); setResumeName(file.name);
        try { const response = await axios.post(`${BACKEND_URL}/api/v1/resume/parse`, await file.arrayBuffer(), { headers: { ...authHeaders(), "Content-Type": "application/pdf" } }); setResumeText(response.data.text); toast.success(`Resume analysed (${response.data.pages} page${response.data.pages === 1 ? "" : "s"}).`); }
        catch (error) {
            setResumeName("");
            const message = axios.isAxiosError(error)
                ? error.response?.status === 404
                    ? "Resume analysis is not loaded yet. Restart the backend, then try again."
                    : error.response?.data?.message || "Could not analyse this resume."
                : "Could not analyse this resume.";
            toast.error(message);
        }
        finally { setParsingResume(false); }
    }

    async function onSubmit() {
        const value = github.trim();
        try {
            const url = new URL(value);
            if (!["github.com", "www.github.com"].includes(url.hostname) || url.pathname.split("/").filter(Boolean).length !== 1) {
                throw new Error("Invalid GitHub URL");
            }
        } catch {
            toast.error("Enter a GitHub profile URL, for example https://github.com/octocat.");
            return;
        }

        setLoading(true);
        try {
            const response = await axios.post(`${BACKEND_URL}/api/v1/pre-interview`, { github: value, role, experience, difficulty, duration, topics, resumeText: resumeText || undefined }, { headers: authHeaders() });
            navigate(`/interview/${response.data.id}`);
        } catch (e) {
            const message = axios.isAxiosError(e) ? e.response?.data?.message : undefined;
            toast.error(message || "We couldn't start the interview. Please try again.");
            setLoading(false);
        }
    }

    if (!session) return <Navigate to="/login" replace />;
    return <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-10"><header className="mb-12 flex items-center justify-between"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Mic className="size-5" /></span><div><p className="font-semibold">AI Interview</p><p className="text-xs text-muted-foreground">{session.user.email}</p></div></div><div className="flex gap-2"><Button variant="outline" size="sm" className="gap-2" onClick={() => navigate('/dashboard')}><LayoutDashboard className="size-4" /> Dashboard</Button><Button variant="outline" size="icon" aria-label="Sign out" onClick={() => { clearSession(); navigate('/login'); }}><LogOut className="size-4" /></Button></div></header>
      <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]"><section><h1 className="text-4xl font-semibold tracking-tight">Make this interview yours.</h1><p className="mt-4 max-w-sm leading-relaxed text-muted-foreground">Choose what you want to practise. Your interviewer will adapt its questions to your profile and goals.</p><div className="mt-8 rounded-2xl border border-border bg-card/50 p-5 text-sm text-muted-foreground"><p className="font-medium text-foreground">Before you begin</p><p className="mt-2">Allow microphone access in the next step. You can also type every answer—both are saved in your report.</p></div></section>
      <section className="rounded-2xl border border-border bg-card/70 p-6 shadow-lg"><h2 className="text-lg font-semibold">Interview setup</h2><div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="Role" value={role} setValue={setRole} options={["Frontend", "Backend", "Full-stack"]} /><Field label="Experience" value={experience} setValue={setExperience} options={["Beginner", "Intermediate", "Senior"]} /><Field label="Difficulty" value={difficulty} setValue={setDifficulty} options={["Easy", "Medium", "Hard"]} /><label className="text-sm font-medium">Duration<select value={duration} onChange={e => setDuration(Number(e.target.value))} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value={10}>10 minutes</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option></select></label></div><label className="mt-5 block text-sm font-medium">GitHub profile<Input value={github} placeholder="https://github.com/your-username" onChange={e => setGithub(e.target.value)} className="mt-2" /></label><div className="mt-5"><p className="text-sm font-medium">Résumé (optional)</p><label className="mt-2 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground hover:bg-muted/50"><FileText className="size-4 text-primary" /><span className="min-w-0 flex-1 truncate">{parsingResume ? "Reading résumé…" : resumeName || "Upload a PDF to personalize questions"}</span>{parsingResume && <Loader2 className="size-4 animate-spin" />}<input type="file" accept="application/pdf" className="sr-only" disabled={parsingResume} onChange={event => uploadResume(event.target.files?.[0])} /></label></div><div className="mt-5"><p className="text-sm font-medium">Topics to focus on</p><div className="mt-2 flex flex-wrap gap-2">{topicOptions.map(topic => <button type="button" key={topic} onClick={() => toggleTopic(topic)} className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${topics.includes(topic) ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}>{topic}</button>)}</div></div><Button disabled={loading || parsingResume} onClick={onSubmit} className="mt-7 w-full gap-2">{loading ? <Loader2 className="size-4 animate-spin" /> : <><Github className="size-4" /><ArrowRight className="size-4" /></>}{loading ? "Preparing your interview" : "Start interview"}</Button></section></div>
    </main>;
}

function Field({ label, value, setValue, options }: { label: string; value: string; setValue: (value: string) => void; options: string[] }) { return <label className="text-sm font-medium">{label}<select value={value} onChange={e => setValue(e.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{options.map(option => <option key={option}>{option}</option>)}</select></label>; }
