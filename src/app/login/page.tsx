"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BriefcaseBusiness, Mail, Sparkles, KeyRound } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [workspace, setWorkspace] = useState<"candidate" | "employer">("candidate");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  async function sendCode() {
    setError(""); setNotice("");
    const supabase = createSupabaseBrowserClient();
    if (!supabase) { setError("ההתחברות עדיין לא חוברה. אפשר להיכנס למצב הדגמה."); return; }
    if (!email.trim()) { setError("יש להזין כתובת אימייל."); return; }
    if (mode === "signup" && !fullName.trim()) { setError("יש להזין שם מלא."); return; }
    setBusy(true);
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: mode === "signup",
        data: mode === "signup" ? { full_name: fullName.trim() } : undefined,
      },
    });
    setBusy(false);
    if (sendError) { setError(sendError.message); return; }
    setStep("code");
    setNotice("שלחנו קוד חד־פעמי בן 6 ספרות למייל. הקוד תקף לזמן מוגבל.");
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault(); setError(""); setNotice("");
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    if (!/^\\d{6}$/.test(code.trim())) { setError("יש להזין קוד בן 6 ספרות."); return; }
    setBusy(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: "email",
    });
    setBusy(false);
    if (verifyError) { setError("הקוד שגוי או שפג תוקפו. אפשר לשלוח קוד חדש ולנסות שוב."); return; }
    sessionStorage.removeItem("jh-demo");
    localStorage.setItem("jh-workspace", workspace);
    router.replace(workspace === "employer" ? "/employer" : "/");
    router.refresh();
  }

  async function resendCode() {
    setCode("");
    await sendCode();
  }

  return (
    <main className="auth-shell">
      <section className="auth-aside">
        <Link href="/" className="brand"><span className="brand-mark"><BriefcaseBusiness size={21}/></span><span>Job<span className="brand-accent">Hunter</span></span></Link>
        <div className="auth-pitch">
          <div className="eyebrow"><Sparkles size={14}/> פחות חיפוש. יותר הזדמנויות.</div>
          <h1>העבודה הבאה שלך<br/><span>מתחילה כאן.</span></h1>
          <p>כל המשרות, קורות החיים והמועמדויות שלך — במקום אחד, עם סביבת עבודה חכמה למועמדים ולמעסיקים.</p>
          <div className="auth-proof"><span className="proof-dot"/> כניסה מאובטחת עם קוד חד־פעמי למייל</div>
        </div>
        <div className="auth-footer">AI Job Hunter</div>
      </section>
      <section className="auth-main">
        <div className="auth-card">
          <Link href="/" className="back-link"><ArrowLeft size={16}/> חזרה לדף הבית</Link>
          <div className="auth-icon"><KeyRound size={22}/></div>
          <h2>{step === "code" ? "בדיקת תיבת המייל" : mode === "login" ? "טוב לראות אותך שוב" : "יוצרים חשבון חדש"}</h2>
          <p className="muted">{step === "code" ? "הזן את הקוד שקיבלת כדי להיכנס לחשבון." : "בוחרים סביבת עבודה ומקבלים קוד חדש בכל התחברות."}</p>
          {step === "email" ? <>
            <div className="auth-tabs">
              <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>התחברות</button>
              <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>הרשמה</button>
            </div>
            <div className="auth-tabs workspace-tabs">
              <button className={workspace === "candidate" ? "active" : ""} onClick={() => setWorkspace("candidate")}>מחפש עבודה</button>
              <button className={workspace === "employer" ? "active" : ""} onClick={() => setWorkspace("employer")}>מעסיק</button>
            </div>
            <form onSubmit={e => { e.preventDefault(); void sendCode(); }} className="auth-form">
              {mode === "signup" && <label>שם מלא<input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="איך קוראים לך?" required/></label>}
              <label>כתובת אימייל<span className="input-wrap"><Mail size={17}/><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com" required dir="ltr"/></span></label>
              {error && <div className="form-error">{error}</div>}
              {notice && <div className="demo-note">{notice}</div>}
              <button className="btn btn-primary btn-full" disabled={busy}>{busy ? "שולח קוד..." : "שליחת קוד למייל"} <ArrowLeft size={17}/></button>
            </form>
          </> : <form onSubmit={verifyCode} className="auth-form">
            <label>קוד חד־פעמי<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\\D/g,"").slice(0,6))} placeholder="123456" dir="ltr" required/></label>
            <div className="muted" dir="ltr">{email}</div>
            {error && <div className="form-error">{error}</div>}
            {notice && <div className="demo-note">{notice}</div>}
            <button className="btn btn-primary btn-full" disabled={busy}>{busy ? "מאמת..." : "אימות והתחברות"} <ArrowLeft size={17}/></button>
            <button type="button" className="demo-link" onClick={resendCode} disabled={busy}>שלח שוב קוד למייל</button>
            <button type="button" className="demo-link" onClick={()=>{setStep("email");setCode("");setError("");setNotice("");}}>שינוי כתובת מייל</button>
          </form>}
          {!configured && <div className="demo-note"><strong>מצב Preview</strong><br/>החיבור ל-Supabase יופעל לאחר הגדרת מפתחות הפרויקט.</div>}
          <button className="demo-link" onClick={()=>{sessionStorage.setItem("jh-demo","1");router.push("/");}}>כניסה למצב הדגמה ללא חשבון</button>
          <p className="auth-terms">בכל התחברות נשלח קוד חדש. אין צורך לזכור סיסמה.</p>
        </div>
      </section>
    </main>
  );
}
