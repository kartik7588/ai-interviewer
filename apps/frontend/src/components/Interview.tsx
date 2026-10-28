import { BACKEND_URL } from "@/lib/config";
import axios from "axios";
import { authHeaders } from "../lib/auth";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Bot, Check, Loader2, Mic, MicOff, Pencil, PhoneOff, RotateCcw, Send, User } from "lucide-react";
import { GoogleGenAI, Modality } from "@google/genai";
import { Button } from "./ui/button";
import { VoiceOrb } from "./VoiceOrb";
import { Textarea } from "./ui/textarea";

type Status = "connecting" | "live" | "ending" | "error";

/** Attaches an analyser to a stream and returns a getter for its current 0..1 volume level. */
function createLevelMeter(ctx: AudioContext, stream: MediaStream) {
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);

    return () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            const v = (data[i]! - 128) / 128;
            sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        // Boost and clamp so normal speech fills most of the range.
        return Math.min(1, rms * 3.2);
    };
}

export function Interview() {
    const { interviewId } = useParams();
    const navigate = useNavigate();

    const [status, setStatus] = useState<Status>("connecting");
    const [aiLevel, setAiLevel] = useState(0);
    const [userLevel, setUserLevel] = useState(0);
    const [isMuted, setIsMuted] = useState(false);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    const [draft, setDraft] = useState("");
    const [caption, setCaption] = useState("");
    const [isAiSpeaking, setIsAiSpeaking] = useState(false);
    const [isCandidateActive, setIsCandidateActive] = useState(false);
    const [liveQuestion, setLiveQuestion] = useState("");
    const [liveResponse, setLiveResponse] = useState("");
    const [editingTranscript, setEditingTranscript] = useState(false);
    const [conversation, setConversation] = useState<{ type: "Interviewer" | "You"; text: string }[]>([]);

    // Resources we need to tear down on exit.
    const userStreamRef = useRef<MediaStream | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const rafRef = useRef<number | null>(null);
    const liveSessionRef = useRef<{ close: () => void } | null>(null);
    const sendTextRef = useRef<((message: string) => void) | null>(null);
    const timerRef = useRef<number | null>(null);
    const aiSpeakingTimerRef = useRef<number | null>(null);
    const captionTimerRef = useRef<number | null>(null);
    const inactivityTimerRef = useRef<number | null>(null);
    const aiAudioEndsAtRef = useRef(0);
    const reminderSentRef = useRef(false);
    const hasAssistantTurnRef = useRef(false);
    const outputGainRef = useRef<GainNode | null>(null);
    const candidateSilenceTimerRef = useRef<number | null>(null);
    const liveQuestionRef = useRef("");
    const liveResponseRef = useRef("");

    useEffect(() => {
        let cancelled = false;

        (async () => {
            setError("");
            setElapsedSeconds(0);
            const audioCtx = new AudioContext();
            audioCtxRef.current = audioCtx;
            const outputGain = audioCtx.createGain();
            outputGain.connect(audioCtx.destination);
            outputGainRef.current = outputGain;
            let aiMeter: (() => number) | null = null;
            let userMeter: (() => number) | null = null;
            let nextAudioTime = 0;

            // Capture the user's microphone.
            const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (cancelled) {
                ms.getTracks().forEach((t) => t.stop());
                return;
            }
            userStreamRef.current = ms;
            userMeter = createLevelMeter(audioCtx, ms);

            const { data } = await axios.post<{ token: string }>(`${BACKEND_URL}/api/v1/session/${interviewId}`, {}, { headers: authHeaders() });
            const ai = new GoogleGenAI({ apiKey: data.token, httpOptions: { apiVersion: "v1beta" } });
            const playPcm = (base64: string) => {
                const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
                const input = new Int16Array(bytes.buffer);
                const buffer = audioCtx.createBuffer(1, input.length, 24000);
                const samples = buffer.getChannelData(0);
                for (let i = 0; i < input.length; i++) samples[i] = input[i]! / 32768;
                const source = audioCtx.createBufferSource();
                source.buffer = buffer;
                source.connect(outputGain);
                const stream = audioCtx.createMediaStreamDestination();
                source.connect(stream);
                aiMeter = createLevelMeter(audioCtx, stream.stream);
                nextAudioTime = Math.max(nextAudioTime, audioCtx.currentTime);
                source.start(nextAudioTime);
                nextAudioTime += buffer.duration;
                aiAudioEndsAtRef.current = nextAudioTime;
                setIsAiSpeaking(true);
                if (aiSpeakingTimerRef.current) window.clearTimeout(aiSpeakingTimerRef.current);
                aiSpeakingTimerRef.current = window.setTimeout(() => {
                    setIsAiSpeaking(false);
                }, Math.max(700, Math.ceil((nextAudioTime - audioCtx.currentTime) * 1000) + 180));
            };
            const session = await ai.live.connect({
                model: "gemini-3.8-live",
                config: { responseModalities: [Modality.AUDIO] },
                callbacks: {
                    onmessage: (message) => {
                        const content = message.serverContent;
                        const audio = content?.modelTurn?.parts?.find((part) => part.inlineData?.data)?.inlineData?.data;
                        if (audio) playPcm(audio);
                        if (content?.interrupted) {
                            nextAudioTime = audioCtx.currentTime;
                            setIsAiSpeaking(false);
                        }
                        const userText = content?.inputTranscription?.text;
                        const assistantText = content?.outputTranscription?.text;
                        if (userText) {
                            setLiveResponse((previous) => {
                                const updated = mergeTranscript(previous, userText);
                                liveResponseRef.current = updated;
                                return updated;
                            });
                            axios.post(`${BACKEND_URL}/api/v1/session/user/response/${interviewId}`, { message: userText });
                        }
                        if (userText) cancelInactivityReminder();
                        if (assistantText) {
                            const isNewAssistantTurn = !hasAssistantTurnRef.current;
                            if (isNewAssistantTurn && liveQuestionRef.current) {
                                const previousTurn = liveQuestionRef.current;
                                const previousResponse = liveResponseRef.current;
                                setConversation(turns => [...turns, { type: "Interviewer", text: previousTurn }, ...(previousResponse ? [{ type: "You" as const, text: previousResponse }] : [])]);
                            }
                            setLiveQuestion((previous) => {
                                const updated = isNewAssistantTurn ? assistantText.trim() : mergeTranscript(previous, assistantText);
                                liveQuestionRef.current = updated;
                                return updated;
                            });
                            if (isNewAssistantTurn) { setLiveResponse(""); liveResponseRef.current = ""; }
                            hasAssistantTurnRef.current = true;
                            setCaption((previous) => {
                                const normalized = assistantText.trim();
                                if (!normalized) return previous;
                                return normalized.startsWith(previous) ? normalized : `${previous} ${normalized}`.trim();
                            });
                            if (captionTimerRef.current) window.clearTimeout(captionTimerRef.current);
                            captionTimerRef.current = window.setTimeout(() => setCaption(""), 5500);
                            axios.post(`${BACKEND_URL}/api/v1/session/assistant/response/${interviewId}`, { message: assistantText });
                        }
                        if (content?.turnComplete && hasAssistantTurnRef.current) {
                            reminderSentRef.current = false;
                            const audioRemainingMs = Math.max(0, (aiAudioEndsAtRef.current - audioCtx.currentTime) * 1000);
                            armInactivityReminder(audioRemainingMs + 10_000);
                            hasAssistantTurnRef.current = false;
                        }
                    },
                    onerror: (error) => console.error("Gemini Live error", error),
                },
            });
            liveSessionRef.current = session;
            sendTextRef.current = (message) => {
                session.sendClientContent({
                    turns: [{ role: "user", parts: [{ text: message }] }],
                    turnComplete: true,
                });
            };

            // Gemini Live accepts raw 16 kHz PCM audio; resample the microphone before sending.
            const input = audioCtx.createMediaStreamSource(ms);
            const processor = audioCtx.createScriptProcessor(4096, 1, 1);
            const silent = audioCtx.createGain();
            silent.gain.value = 0;
            input.connect(processor);
            processor.connect(silent);
            silent.connect(audioCtx.destination);
            processor.onaudioprocess = (event) => {
                const source = event.inputBuffer.getChannelData(0);
                const peak = source.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
                if (peak > 0.025) {
                    cancelInactivityReminder();
                    setIsCandidateActive(true);
                    if (candidateSilenceTimerRef.current) window.clearTimeout(candidateSilenceTimerRef.current);
                    candidateSilenceTimerRef.current = window.setTimeout(() => setIsCandidateActive(false), 900);
                }
                const length = Math.floor(source.length * 16000 / audioCtx.sampleRate);
                const pcm = new Int16Array(length);
                for (let i = 0; i < length; i++) pcm[i] = Math.max(-1, Math.min(1, source[Math.floor(i * audioCtx.sampleRate / 16000)]!)) * 32767;
                const bytes = new Uint8Array(pcm.buffer);
                let binary = "";
                for (const byte of bytes) binary += String.fromCharCode(byte);
                session.sendRealtimeInput({ audio: { data: btoa(binary), mimeType: "audio/pcm;rate=16000" } });
            };
            session.sendClientContent({ turns: [{ role: "user", parts: [{ text: "Start the interview with your first question." }] }], turnComplete: true });

            if (cancelled) return;
            setStatus("live");
            const startedAt = Date.now();
            timerRef.current = window.setInterval(() => {
                setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
            }, 1000);

            // Single animation loop drives both volume meters.
            const tick = () => {
                if (aiMeter) setAiLevel(aiMeter());
                if (userMeter) setUserLevel(userMeter());
                rafRef.current = requestAnimationFrame(tick);
            };
            rafRef.current = requestAnimationFrame(tick);
        })().catch((reason) => {
            if (cancelled) return;
            console.error("Interview connection failed", reason);
            cleanup();
            setError(
                axios.isAxiosError(reason)
                    ? reason.response?.data?.error || reason.response?.data?.message || "The interview service could not be reached."
                    : "We couldn't connect your interview. Check microphone access and try again.",
            );
            setStatus("error");
        });

        return () => {
            cancelled = true;
            cleanup();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [interviewId, attempt]);

    useEffect(() => {
        userStreamRef.current?.getAudioTracks().forEach((track) => {
            track.enabled = !isMuted;
        });
    }, [isMuted]);

    useEffect(() => {
        const gain = outputGainRef.current;
        if (!gain || !audioCtxRef.current) return;
        gain.gain.setTargetAtTime(isCandidateActive ? 0 : 1, audioCtxRef.current.currentTime, 0.04);
    }, [isCandidateActive]);

    function cleanup() {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        if (timerRef.current) window.clearInterval(timerRef.current);
        if (aiSpeakingTimerRef.current) window.clearTimeout(aiSpeakingTimerRef.current);
        if (captionTimerRef.current) window.clearTimeout(captionTimerRef.current);
        if (inactivityTimerRef.current) window.clearTimeout(inactivityTimerRef.current);
        if (candidateSilenceTimerRef.current) window.clearTimeout(candidateSilenceTimerRef.current);
        userStreamRef.current?.getTracks().forEach((t) => t.stop());
        liveSessionRef.current?.close();
        sendTextRef.current = null;
        audioCtxRef.current?.close().catch(() => {});
    }

    async function endInterview() {
        setStatus("ending");
        cleanup();
        try {
            await axios.post(`${BACKEND_URL}/api/v1/interview/${interviewId}/complete`);
        } catch (reason) {
            console.error("Interview finalization failed", reason);
        }
        navigate(`/result/${interviewId}`);
    }

    function retryInterview() {
        cleanup();
        setStatus("connecting");
        setAttempt((value) => value + 1);
    }

    function sendTypedAnswer() {
        const message = draft.trim();
        if (!message || status !== "live" || !sendTextRef.current) return;

        sendTextRef.current(message);
        cancelInactivityReminder();
        setIsCandidateActive(false);
        setDraft("");
        setLiveResponse(message); liveResponseRef.current = message;
        void axios
            .post(`${BACKEND_URL}/api/v1/session/user/response/${interviewId}`, { message })
            .catch((reason) => console.error("Could not save typed response", reason));
    }

    async function saveTranscriptCorrection() {
        const message = liveResponse.trim();
        if (!message) return;
        try {
            await axios.patch(`${BACKEND_URL}/api/v1/session/user/response/${interviewId}`, { message });
            setEditingTranscript(false);
        } catch (reason) { console.error("Could not save transcript correction", reason); }
    }

    function cancelInactivityReminder() {
        if (inactivityTimerRef.current) window.clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
    }

    function armInactivityReminder(delay: number) {
        cancelInactivityReminder();
        inactivityTimerRef.current = window.setTimeout(() => {
            if (reminderSentRef.current || !sendTextRef.current) return;
            reminderSentRef.current = true;
            sendTextRef.current(
                "The candidate has not responded yet. Please repeat your most recent question once, clearly and concisely.",
            );
        }, delay);
    }

    const timeLabel = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`;

    const aiSpeaking = isAiSpeaking || (aiLevel > 0.06 && aiLevel >= userLevel);
    const userSpeaking = userLevel > 0.06 && userLevel > aiLevel;

    return (
        <main className="interview-shell flex min-h-screen w-screen flex-col overflow-x-hidden">
            {/* Header */}
            <header className="interview-header flex items-center justify-between px-6 py-5">
                <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="relative flex size-2.5">
                        <span
                            className={
                                status === "live"
                                    ? "absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
                                    : "hidden"
                            }
                        />
                        <span
                            className={
                                "relative inline-flex size-2.5 rounded-full " +
                                (status === "live" ? "bg-emerald-400" : "bg-amber-400")
                            }
                        />
                    </span>
                    {status === "connecting"
                        ? "Connecting…"
                        : status === "ending"
                          ? "Wrapping up…"
                          : status === "error"
                            ? "Connection needs attention"
                            : "Interview live"}
                </div>
                <span className="text-sm tabular-nums text-muted-foreground">
                    {status === "live" ? timeLabel : "AI Interview"}
                </span>
            </header>

            {/* Stage */}
            <div className="interview-stage flex flex-1 items-center justify-center px-6">
                {status === "connecting" ? (
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                        <Loader2 className="size-7 animate-spin" />
                        <p className="text-sm">Setting up your interview & microphone…</p>
                    </div>
                ) : status === "error" ? (
                    <div className="max-w-md text-center">
                        <p className="text-lg font-semibold">Unable to start the interview</p>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error}</p>
                        <Button className="mt-6 gap-2" onClick={retryInterview}>
                            <RotateCcw className="size-4" />
                            Try again
                        </Button>
                    </div>
                ) : (
                    <div className="flex w-full max-w-3xl flex-col items-center gap-6">
                        <div className="flex w-full items-center justify-center gap-12 sm:gap-24">
                            <VoiceOrb
                                level={aiSpeaking ? Math.max(aiLevel, 0.35) : aiLevel}
                                speaking={aiSpeaking}
                                label="Interviewer"
                                sublabel="Listening"
                                icon={Bot}
                                accent="violet"
                            />
                            <VoiceOrb
                                level={userLevel}
                                speaking={userSpeaking}
                                label="You"
                                sublabel="Mic on"
                                icon={User}
                                accent="emerald"
                            />
                        </div>
                        <div className="min-h-14 w-full max-w-xl text-center" aria-live="polite">
                            {caption && (
                                <p className="animate-in fade-in slide-in-from-top-2 rounded-xl bg-card px-4 py-3 text-sm leading-relaxed text-foreground shadow-sm duration-300">
                                    {caption}
                                </p>
                            )}
                        </div>
                        <section className="w-full rounded-xl border border-border bg-card/60 p-4 text-left" aria-label="Live transcript">
                            <div className="grid gap-4 md:grid-cols-2"><div><p className="mb-1 text-xs font-medium text-muted-foreground">CURRENT QUESTION</p><p className="text-sm leading-relaxed">{liveQuestion || caption || "The interviewer’s question will appear here."}</p></div><div><div className="mb-1 flex items-center justify-between"><p className="text-xs font-medium text-muted-foreground">YOUR RESPONSE</p>{liveResponse && <button type="button" onClick={() => editingTranscript ? saveTranscriptCorrection() : setEditingTranscript(true)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">{editingTranscript ? <Check className="size-3" /> : <Pencil className="size-3" />}{editingTranscript ? "Save correction" : "Correct"}</button>}</div>{editingTranscript ? <Textarea value={liveResponse} onChange={event => { setLiveResponse(event.target.value); liveResponseRef.current = event.target.value; }} className="min-h-20 text-sm" /> : <p className="text-sm leading-relaxed text-muted-foreground">{liveResponse || "Your spoken words will appear here in real time."}</p>}</div></div>
                            {conversation.length > 0 && <div className="mt-5 max-h-36 space-y-3 overflow-y-auto border-t border-border pt-4"><p className="text-xs font-medium text-muted-foreground">LIVE CONVERSATION</p>{conversation.map((turn, index) => <div key={`${turn.type}-${index}`} className="text-sm"><span className={turn.type === "Interviewer" ? "font-medium text-violet-300" : "font-medium text-emerald-300"}>{turn.type}: </span><span className="text-muted-foreground">{turn.text}</span></div>)}</div>}
                        </section>
                    </div>
                )}
            </div>

            {/* Controls */}
            <footer className="interview-footer border-t border-border/70 px-4 py-4 sm:px-6">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
                    {status === "live" && (
                        <div className="flex items-end gap-2">
                            <Textarea
                                value={draft}
                                onChange={(event) => {
                                    setDraft(event.target.value);
                                    setIsCandidateActive(Boolean(event.target.value.trim()));
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" && !event.shiftKey) {
                                        event.preventDefault();
                                        sendTypedAnswer();
                                    }
                                }}
                                placeholder="Type an answer instead…"
                                aria-label="Type an interview answer"
                                className="min-h-11 resize-none py-2.5"
                            />
                            <Button
                                size="icon"
                                onClick={sendTypedAnswer}
                                disabled={!draft.trim()}
                                aria-label="Send typed answer"
                                className="size-11 shrink-0"
                            >
                                <Send className="size-4" />
                            </Button>
                        </div>
                    )}
                    <div className="flex flex-wrap justify-center gap-3">
                        {status === "live" && (
                            <Button variant="outline" size="lg" onClick={() => setIsMuted((value) => !value)} className="gap-2 rounded-full px-5">
                                {isMuted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                                {isMuted ? "Unmute" : "Mute mic"}
                            </Button>
                        )}
                        <Button
                            variant="destructive"
                            size="lg"
                            onClick={endInterview}
                            disabled={status === "ending" || status === "connecting"}
                            className="gap-2 rounded-full px-6"
                        >
                            {status === "ending" ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : (
                                <PhoneOff className="size-4" />
                            )}
                            End interview
                        </Button>
                    </div>
                </div>
            </footer>
        </main>
    );
}

function mergeTranscript(previous: string, next: string) {
    const normalized = next.trim();
    if (!normalized) return previous;
    if (normalized.startsWith(previous)) return normalized;
    if (previous.endsWith(normalized)) return previous;
    return `${previous} ${normalized}`.trim();
}
