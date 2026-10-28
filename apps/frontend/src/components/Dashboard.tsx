import axios from "axios";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Plus, ClipboardList, ChevronRight } from "lucide-react";
import { BACKEND_URL } from "@/lib/config";
import { authHeaders, clearSession, getSession } from "../lib/auth";
import { Button } from "./ui/button";

type Interview = { id: string; role: string; experience: string; difficulty: string; duration: number; score: number; status: "Done" | "InProgress" | "Pre" };
export function Dashboard() {
  const [items, setItems] = useState<Interview[]>([]); const navigate = useNavigate(); const session = getSession();
  useEffect(() => { if (!session) { navigate("/login"); return; } axios.get(`${BACKEND_URL}/api/v1/interviews`, { headers: authHeaders() }).then(r => setItems(r.data)).catch(() => navigate("/login")); }, [navigate, session]);
  return <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-10"><header className="mb-10 flex items-center justify-between gap-4"><div><h1 className="text-3xl font-semibold tracking-tight">Your interviews</h1><p className="mt-1 text-sm text-muted-foreground">{session?.user.email}</p></div><div className="flex gap-2"><Button onClick={() => navigate("/")} className="gap-2"><Plus className="size-4" /> New interview</Button><Button variant="outline" size="icon" aria-label="Sign out" onClick={() => { clearSession(); navigate("/login"); }}><LogOut className="size-4" /></Button></div></header>
    {items.length === 0 ? <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-border bg-card/40 text-center"><div><ClipboardList className="mx-auto mb-3 size-7 text-muted-foreground" /><p className="font-medium">No interviews yet</p><p className="mt-1 text-sm text-muted-foreground">Your completed interview reports will appear here.</p></div></div> : <div className="divide-y overflow-hidden rounded-2xl border border-border bg-card/60">{items.map(item => <button key={item.id} onClick={() => navigate(`/result/${item.id}`)} className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/60"><div className="grid size-10 place-items-center rounded-xl bg-primary/15 text-sm font-semibold text-primary">{item.status === "Done" ? `${item.score}/10` : "…"}</div><div className="min-w-0 flex-1"><p className="font-medium">{item.role} interview</p><p className="text-sm text-muted-foreground">{item.experience} · {item.difficulty} · {item.duration} min · {item.status === "Done" ? "Completed" : "In progress"}</p></div><ChevronRight className="size-4 text-muted-foreground" /></button>)}</div>}
  </main>;
}
