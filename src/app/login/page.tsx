"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BriefcaseBusiness, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("ההתחברות עדיין לא חוברה. אפשר להיכנס למצב הדגמה ולבחון את הממשק.");
      return;
    }
    setBusy(true);
    const result = mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
    setBusy(false);
    if (result.error) { setError(result.error.message); return; }
    if (mode === "signup" && !result.data.session) {
      setError("נשלח אליך אימייל לאימות החשבון. לאחר האימות אפשר להתחבר.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main className="auth-shell">
      <section className="auth-aside">
        <Link href="/" className="brand"><span className="brand-mark"><BriefcaseBusiness size={21}/></span><span>Job<span className="brand-accent">Hunter</span></span></Link>
        <div className="auth-pitch">
          <div className="eyebrow"><Sparkles size={14}/> פחות חיפוש. יותר הזדמנויות.</div>
          <h1>העבודה הבאה שלך<br/><span>מתחילה כאן.</span></h1>
          <p>כל המשרות, קורות החיים והמועמדויות שלך — במקום אחד, עם עוזר AI שעוזר לך להתקדם.</p>
          <div className="auth-proof"><span className="proof-dot"/> סביבת עבודה אישית ומאובטחת</div>
        </div>
        <div className="auth-footer">AI Job Hunter · גרסת Preview</div>
      </section>
      <section className="auth-main">
        <div className="auth-card">
          <Link href="/" className="back-link"><ArrowLeft size={16}/> חזרה לדף הבית</Link>
          <div className="auth-icon"><LockKeyhole size={22}/></div>
          <h2>{mode === "login" ? "טוב לראות אותך שוב" : "יוצרים חשבון חדש"}</h2>
          <p className="muted">{mode === "login" ? "התחבר כדי להמשיך את מסע חיפוש העבודה שלך." : "מתחילים לנהל את חיפוש העבודה בצורה חכמה."}</p>
          <div className="auth-tabs">
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>התחברות</button>
            <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>הרשמה</button>
          </div>
          <form onSubmit={submit} className="auth-form">
            {mode === "signup" && <label>שם מלא<input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="איך קוראים לך?" required/></label>}
            <label>כתובת אימייל<span className="input-wrap"><Mail size={17}/><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com" required dir="ltr"/></span></label>
            <label>סיסמה<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="לפחות 8 תווים" minLength={8} required dir="ltr"/></label>
            {error && <div className="form-error">{error}</div>}
            <button className="btn btn-primary btn-full" disabled={busy}>{busy ? "רק רגע..." : mode === "login" ? "התחברות" : "יצירת חשבון"} <ArrowLeft size={17}/></button>
          </form>
          {!configured && <div className="demo-note"><strong>מצב Preview</strong><br/>החיבור ל-Supabase יופעל לאחר הגדרת מפתחות הפרויקט.</div>}
          <button className="demo-link" onClick={()=>{sessionStorage.setItem("jh-demo","1");router.push("/");}}>כניסה למצב הדגמה ללא חשבון</button>
          <p className="auth-terms">בהמשך נוסיף תנאי שימוש ומדיניות פרטיות לפני פתיחה לקהל.</p>
        </div>
      </section>
    </main>
  );
}
