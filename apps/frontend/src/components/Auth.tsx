import axios from "axios";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, FlaskConical, Loader2, Mic } from "lucide-react";
import { BACKEND_URL } from "@/lib/config";
import { saveSession } from "../lib/auth";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function Auth() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      const response = await axios.post(`${BACKEND_URL}/api/v1/auth/${mode === "login" ? "login" : "register"}`, { email, password });
      saveSession(response.data); navigate("/");
    } catch (error) { toast.error(axios.isAxiosError(error) ? error.response?.data?.message || "Could not sign in." : "Could not sign in."); }
    finally { setLoading(false); }
  }
  async function demoLogin() {
    setLoading(true);
    try { const response = await axios.post(`${BACKEND_URL}/api/v1/auth/demo`); saveSession(response.data); navigate("/"); }
    catch { toast.error("Demo login is unavailable. Please try again."); }
    finally { setLoading(false); }
  }
  return <main className="flex min-h-screen items-center justify-center px-6"><form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-border bg-card/70 p-7 shadow-xl backdrop-blur">
    <div className="mb-7 flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Mic className="size-5" /></span><div><h1 className="text-xl font-semibold">{mode === "login" ? "Welcome back" : "Create your account"}</h1><p className="text-sm text-muted-foreground">Keep your interview history and reports in one place.</p></div></div>
    <label className="mb-4 block text-sm font-medium">Email<Input className="mt-2" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label>
    <label className="mb-6 block text-sm font-medium">Password<Input className="mt-2" type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" /></label>
    <Button className="w-full gap-2" disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}{mode === "login" ? "Sign in" : "Create account"}</Button>
    <Button type="button" variant="outline" className="mt-3 w-full gap-2" disabled={loading} onClick={demoLogin}><FlaskConical className="size-4" /> Continue with demo account</Button>
    <p className="mt-5 text-center text-sm text-muted-foreground">{mode === "login" ? "New here?" : "Already have an account?"} <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Create one" : "Sign in"}</button></p>
  </form></main>;
}
