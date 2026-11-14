import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const runtime="nodejs";
const defaults={scan_frequency:"daily",scan_time:"08:00",timezone:"Asia/Jerusalem",scan_enabled:false,scan_sources:["manual"],submission_mode:"approval",min_match_score:85,auto_submit_enabled:false,require_approval:true};
export async function GET(){
 const supabase=await createSupabaseServerClient(); const {data:{user}}=await supabase.auth.getUser();
 if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const db=supabase as any; let {data,error}=await db.from("user_preferences").select("*").eq("user_id",user.id).maybeSingle();
 if(error)return NextResponse.json({error:error.message},{status:400});
 if(!data){const r=await db.from("user_preferences").insert({user_id:user.id,...defaults}).select("*").single();data=r.data;error=r.error;}
 if(error)return NextResponse.json({error:error.message},{status:400}); return NextResponse.json({preferences:data});
}
export async function PATCH(req:Request){
 const supabase=await createSupabaseServerClient(); const {data:{user}}=await supabase.auth.getUser();
 if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const b=await req.json().catch(()=>null); if(!b)return NextResponse.json({error:"Invalid body"},{status:400});
 const patch:any={user_id:user.id,updated_at:new Date().toISOString()};
 if(["daily","weekly","monthly"].includes(b.scan_frequency))patch.scan_frequency=b.scan_frequency;
 if(typeof b.scan_time==="string"&&/^([01]\d|2[0-3]):[0-5]\d$/.test(b.scan_time))patch.scan_time=b.scan_time;
 if(typeof b.scan_enabled==="boolean")patch.scan_enabled=b.scan_enabled;
 if(typeof b.timezone==="string"&&b.timezone.length<80)patch.timezone=b.timezone;
 if(Array.isArray(b.scan_sources))patch.scan_sources=b.scan_sources.filter((s:any)=>["manual","linkedin","alljobs","facebook","company_sites"].includes(s));
 if(["manual","approval","automatic"].includes(b.submission_mode))patch.submission_mode=b.submission_mode;
 if(Number.isInteger(b.min_match_score)&&b.min_match_score>=0&&b.min_match_score<=100)patch.min_match_score=b.min_match_score;
 if(typeof b.auto_submit_enabled==="boolean")patch.auto_submit_enabled=b.auto_submit_enabled;
 if(typeof b.require_approval==="boolean")patch.require_approval=b.require_approval;
 const db=supabase as any; const {data,error}=await db.from("user_preferences").upsert(patch,{onConflict:"user_id"}).select("*").single();
 if(error)return NextResponse.json({error:error.message},{status:400});
 await db.from("user_activity_events").insert({user_id:user.id,event_type:"preference_updated",payload:{fields:Object.keys(patch).filter(k=>k!=="user_id"&&k!=="updated_at")}});
 return NextResponse.json({preferences:data,notice:data.auto_submit_enabled?"העדפת הגשה נשמרה; מנוע הגשה אוטומטי עדיין אינו מחובר.":undefined});
}
