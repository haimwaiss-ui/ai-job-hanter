"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, Building2, Users, Plus, Search, ArrowLeft, LogOut, MapPin, Globe2, MoreHorizontal, CheckCircle2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type EmployerJob = { id: string; title: string; department: string | null; location: string | null; status: string; created_at: string; workplace_type: string };
type Applicant = { id: string; candidate_user_id: string; employer_job_id: string; cover_letter: string | null; status: string; created_at: string; employer_jobs?: { title?: string; department?: string | null; location?: string | null } | null };
const statusLabels: Record<string,string> = { new: "חדש", reviewing: "בבדיקה", interview: "ראיון", offer: "הצעה", rejected: "נדחה", hired: "התקבל" };

export default function EmployerDashboard() {
  const router = useRouter();
  const [company, setCompany] = useState({ company_name: "", company_website: "", company_description: "", contact_name: "" });
  const [jobs, setJobs] = useState<EmployerJob[]>([]);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [tab, setTab] = useState<"overview"|"jobs"|"applicants"|"company">("overview");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [job, setJob] = useState({ title: "", department: "", description: "", location: "", employment_type: "full_time", workplace_type: "hybrid", salary_range: "", publish: true });

  const load = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase?.auth.getUser() ?? { data: { user: null } };
    if (!data.user) { router.replace("/login"); return; }
    const [jr, ar] = await Promise.all([fetch("/api/employer/jobs"), fetch("/api/employer/applications")]);
    if (jr.status === 401) { router.replace("/login"); return; }
    const j = await jr.json(); const a = await ar.json();
    if (jr.ok) { if (j.company) setCompany(j.company); setJobs(j.jobs ?? []); }
    if (ar.ok) setApplicants(a.applications ?? []);
    setLoading(false);
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  const visibleJobs = useMemo(() => jobs.filter(x => (x.title + " " + (x.department ?? "") + " " + (x.location ?? "")).toLowerCase().includes(query.toLowerCase())), [jobs, query]);
  const published = jobs.filter(x => x.status === "published").length;
  const newApplicants = applicants.filter(x => x.status === "new").length;

  async function createJob(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setNotice("");
    const response = await fetch("/api/employer/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...company, ...job }) });
    const result = await response.json(); setSaving(false);
    if (!response.ok) { setNotice(result.error ?? "לא ניתן לשמור את המשרה"); return; }
    setJobs([result.job, ...jobs]); setShowForm(false); setJob({ title: "", department: "", description: "", location: "", employment_type: "full_time", workplace_type: "hybrid", salary_range: "", publish: true });
    setNotice("המשרה נשמרה בהצלחה");
  }

  async function changeJobStatus(id: string, status: string) {
    const response = await fetch("/api/employer/jobs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    const result = await response.json();
    if (response.ok) setJobs(jobs.map(x => x.id === id ? result.job : x)); else setNotice(result.error ?? "לא ניתן לעדכן");
  }

  async function changeApplicantStatus(id: string, status: string) {
    const response = await fetch("/api/employer/applications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    const result = await response.json();
    if (response.ok) setApplicants(applicants.map(x => x.id === id ? result.application : x)); else setNotice(result.error ?? "לא ניתן לעדכן");
  }

  async function saveCompany() {
    if (!company.company_name.trim()) { setNotice("יש להזין שם חברה"); return; }
    setSaving(true);
    const response = await fetch("/api/employer/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...company, title: "פרופיל חברה — טיוטה", description: "", publish: false }) });
    const result = await response.json(); setSaving(false);
    if (!response.ok) { setNotice(result.error ?? "לא ניתן לשמור"); return; }
    setJobs([result.job, ...jobs]); await changeJobStatus(result.job.id, "draft"); setNotice("פרטי החברה נשמרו");
  }

  async function logout() {
    const supabase = createSupabaseBrowserClient();
    await supabase?.auth.signOut();
    localStorage.removeItem("jh-workspace");
    router.replace("/login");
  }

  if (loading) return <main className="employer-loading">טוען את סביבת המעסיק…</main>;

  return <main className="employer-shell" dir="rtl">
    <aside className="employer-sidebar">
      <div className="employer-brand"><span><BriefcaseBusiness size={21}/></span> JobHunter <small>EMPLOYER</small></div>
      <div className="employer-company-mini"><div className="employer-company-icon"><Building2 size={20}/></div><div><strong>{company.company_name || "החברה שלך"}</strong><small>סביבת מעסיק</small></div></div>
      <nav className="employer-nav">
        <button className={tab==="overview"?"active":""} onClick={()=>setTab("overview")}><BriefcaseBusiness size={17}/> סקירה כללית</button>
        <button className={tab==="jobs"?"active":""} onClick={()=>setTab("jobs")}><Globe2 size={17}/> המשרות שלי</button>
        <button className={tab==="applicants"?"active":""} onClick={()=>setTab("applicants")}><Users size={17}/> מועמדים <b>{newApplicants}</b></button>
        <button className={tab==="company"?"active":""} onClick={()=>setTab("company")}><Building2 size={17}/> פרטי החברה</button>
      </nav>
      <div className="employer-sidebar-bottom">
        <button onClick={()=>{localStorage.setItem("jh-workspace","candidate");router.push("/");}}><ArrowLeft size={16}/> מעבר לחשבון מחפש עבודה</button>
        <button onClick={()=>router.push("/login?switch=1")}><Users size={16}/> החלפת חשבון</button>
        <button onClick={logout}><LogOut size={16}/> יציאה</button>
      </div>
    </aside>
    <section className="employer-main">
      <header className="employer-topbar"><div><span>סביבת עבודה</span><strong>{tab==="overview"?"סקירה כללית":tab==="jobs"?"המשרות שלי":tab==="applicants"?"ניהול מועמדים":"פרטי החברה"}</strong></div><button className="employer-add" onClick={()=>setShowForm(true)}><Plus size={17}/> פרסום משרה</button></header>
      {notice && <div className="employer-notice">{notice}<button onClick={()=>setNotice("")}>×</button></div>}
      {tab==="overview" && <>
        <div className="employer-welcome"><div><span className="employer-eyebrow">לוח הבקרה שלך</span><h1>שלום{company.contact_name ? ", "+company.contact_name : ""} 👋</h1><p>כל תהליכי הגיוס וההזדמנויות של החברה במקום אחד.</p></div><div className="employer-welcome-icon"><Building2 size={38}/></div></div>
        <div className="employer-stats">
          <div><span>משרות פעילות</span><strong>{published}</strong><small>משרות שפורסמו באתר</small></div>
          <div><span>כלל המשרות</span><strong>{jobs.length}</strong><small>כולל טיוטות ומשרות סגורות</small></div>
          <div><span>מועמדים שהגישו</span><strong>{applicants.length}</strong><small>בכל המשרות שלך</small></div>
          <div><span>ממתינים לבדיקה</span><strong>{newApplicants}</strong><small>מועמדים חדשים</small></div>
        </div>
        <div className="employer-content-grid">
          <section className="employer-panel"><div className="employer-panel-head"><div><h2>משרות אחרונות</h2><p>ניהול מהיר של המשרות שפרסמת</p></div><button onClick={()=>setTab("jobs")}>לכל המשרות ←</button></div>
            {jobs.slice(0,5).map(x=><div className="employer-job-row" key={x.id}><div className="employer-job-icon"><BriefcaseBusiness size={18}/></div><div className="employer-job-info"><strong>{x.title}</strong><small>{x.department || "כללי"} · {x.location || "לא צוין מיקום"}</small></div><span className={"employer-status "+x.status}>{x.status==="published"?"פורסמה":x.status==="draft"?"טיוטה":x.status==="paused"?"מושהית":"נסגרה"}</span><button aria-label="סגירת משרה" onClick={()=>changeJobStatus(x.id,x.status==="published"?"paused":"published")}><MoreHorizontal size={18}/></button></div>)}
            {!jobs.length && <div className="employer-empty"><BriefcaseBusiness size={30}/><strong>עדיין לא פרסמת משרה</strong><span>צור מודעה ראשונה כדי להתחיל לקבל מועמדים.</span><button onClick={()=>setShowForm(true)}>פרסום משרה ראשונה</button></div>}
          </section>
          <section className="employer-panel"><div className="employer-panel-head"><div><h2>תיבת מועמדים</h2><p>מועמדים שממתינים לטיפול</p></div><Users size={19}/></div>
            {applicants.slice(0,5).map(x=><div className="employer-applicant-row" key={x.id}><div className="employer-candidate-avatar">{(x.candidate_user_id||"מ").slice(0,1).toUpperCase()}</div><div><strong>מועמד/ת · {x.candidate_user_id.slice(0,8)}</strong><small>{x.employer_jobs?.title || "משרה"} · {new Date(x.created_at).toLocaleDateString("he-IL")}</small></div><span>{statusLabels[x.status] || x.status}</span></div>)}
            {!applicants.length && <div className="employer-empty small">מועמדים חדשים שיוגשו למשרות שלך יופיעו כאן.</div>}
          </section>
        </div>
      </>}
      {tab==="jobs" && <section className="employer-panel"><div className="employer-panel-head"><div><h2>המשרות שלי</h2><p>יצירה, פרסום וניהול של מודעות הדרושים</p></div><button className="employer-add" onClick={()=>setShowForm(true)}><Plus size={16}/> משרה חדשה</button></div><div className="employer-search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="חיפוש לפי תפקיד, מחלקה או מיקום"/></div>
        {visibleJobs.map(x=><div className="employer-job-row" key={x.id}><div className="employer-job-icon"><BriefcaseBusiness size={18}/></div><div className="employer-job-info"><strong>{x.title}</strong><small>{x.department || "כללי"} · {x.location || "לא צוין"} · {new Date(x.created_at).toLocaleDateString("he-IL")}</small></div><span className={"employer-status "+x.status}>{x.status==="published"?"פורסמה":x.status==="draft"?"טיוטה":x.status==="paused"?"מושהית":"נסגרה"}</span><select value={x.status} onChange={e=>changeJobStatus(x.id,e.target.value)}><option value="draft">טיוטה</option><option value="published">פורסמה</option><option value="paused">מושהית</option><option value="closed">נסגרה</option></select></div>)}
        {!visibleJobs.length && <div className="employer-empty">לא נמצאו משרות. לחץ על "משרה חדשה" כדי להתחיל.</div>}
      </section>}
      {tab==="applicants" && <section className="employer-panel"><div className="employer-panel-head"><div><h2>ניהול מועמדים</h2><p>מעקב אחר מועמדים לפי שלבי הגיוס</p></div><Users size={20}/></div>
        <div className="employer-pipeline">{["new","reviewing","interview","offer","hired"].map(s=><div key={s}><span>{statusLabels[s]}</span><strong>{applicants.filter(x=>x.status===s).length}</strong></div>)}</div>
        {applicants.map(x=><div className="employer-job-row" key={x.id}><div className="employer-candidate-avatar"><Users size={16}/></div><div className="employer-job-info"><strong>מועמד/ת · {x.candidate_user_id.slice(0,8)}</strong><small>{x.employer_jobs?.title || "משרה"} · {new Date(x.created_at).toLocaleDateString("he-IL")}</small></div><select value={x.status} onChange={e=>changeApplicantStatus(x.id,e.target.value)}>{Object.entries(statusLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>)}
        {!applicants.length && <div className="employer-empty">כשתתקבל מועמדות למשרה שפרסמת, היא תופיע כאן. פרטי מועמדים אישיים לא יוצגו לפני הגשת מועמדות מפורשת.</div>}
      </section>}
      {tab==="company" && <section className="employer-panel employer-company-form"><h2>פרטי החברה</h2><p>המידע הזה יוצג בפרופיל החברה ובמודעות הדרושים.</p><label>שם החברה<input value={company.company_name} onChange={e=>setCompany({...company,company_name:e.target.value})} placeholder="שם החברה"/></label><label>שם איש קשר<input value={company.contact_name} onChange={e=>setCompany({...company,contact_name:e.target.value})} placeholder="שם מלא"/></label><label>אתר החברה<input value={company.company_website} onChange={e=>setCompany({...company,company_website:e.target.value})} placeholder="https://..." dir="ltr"/></label><label>אודות החברה<textarea value={company.company_description} onChange={e=>setCompany({...company,company_description:e.target.value})} rows={4} placeholder="כמה מילים על החברה"/></label><button className="employer-add" onClick={saveCompany} disabled={saving}>{saving?"שומר...":"שמירת פרטי החברה"}</button></section>}
    </section>
    {showForm && <div className="employer-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setShowForm(false)}}><form className="employer-modal" onSubmit={createJob}><div className="employer-panel-head"><h2>פרסום משרה חדשה</h2><button type="button" onClick={()=>setShowForm(false)}>×</button></div><label>שם התפקיד<input required value={job.title} onChange={e=>setJob({...job,title:e.target.value})} placeholder="לדוגמה: מנהל/ת מוצר"/></label><label>מחלקה<input value={job.department} onChange={e=>setJob({...job,department:e.target.value})} placeholder="פיתוח, מכירות, כספים..."/></label><label>מיקום<input value={job.location} onChange={e=>setJob({...job,location:e.target.value})} placeholder="עיר / עבודה מרחוק"/></label><label>תיאור המשרה<textarea required rows={5} value={job.description} onChange={e=>setJob({...job,description:e.target.value})} placeholder="תיאור התפקיד, דרישות ואחריות"/></label><label>סוג עבודה<select value={job.workplace_type} onChange={e=>setJob({...job,workplace_type:e.target.value})}><option value="onsite">מהמשרד</option><option value="hybrid">היברידי</option><option value="remote">מרחוק</option></select></label><label>טווח שכר<input value={job.salary_range} onChange={e=>setJob({...job,salary_range:e.target.value})} placeholder="למשל 18,000–22,000 ₪"/></label><label className="employer-publish-toggle"><input type="checkbox" checked={job.publish} onChange={e=>setJob({...job,publish:e.target.checked})}/> פרסום מיידי</label><div className="employer-modal-actions"><button type="button" onClick={()=>setShowForm(false)}>ביטול</button><button className="employer-add" disabled={saving}>{saving?"מפרסם...":"שמירה ופרסום"}</button></div></form></div>}
  </main>;
}
