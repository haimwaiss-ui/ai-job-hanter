import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const runtime="nodejs";
const kinds=["job_opened","job_saved","job_dismissed","job_search","scan_requested","application_created","application_status_changed","preference_updated"] as const;
export async function POST(req:Request){
 const supabase=await createSupabaseServerClient(); const {data:{user}}=await supabase.auth.getUser();
 if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const b=await req.json().catch(()=>null); if(!b||!kinds.includes(b.event_type))return NextResponse.json({error:"Unsupported event"},{status:422});
 const payload=b.payload&&typeof b.payload==="object"?b.payload:{};
 const db=supabase as any; const {error}=await db.from("user_activity_events").insert({user_id:user.id,event_type:b.event_type,entity_type:typeof b.entity_type==="string"?b.entity_type:null,entity_id:typeof b.entity_id==="string"?b.entity_id:null,payload});
 if(error)return NextResponse.json({error:error.message},{status:400}); return NextResponse.json({saved:true});
}
