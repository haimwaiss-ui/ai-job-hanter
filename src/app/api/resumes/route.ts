import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const runtime="nodejs";
export async function GET(){
 const supabase=await createSupabaseServerClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const db=supabase as any;const {data,error}=await db.from("resumes").select("id,name,original_filename,file_size_bytes,is_default,created_at").eq("user_id",user.id).order("created_at",{ascending:false});
 if(error)return NextResponse.json({error:error.message},{status:400});return NextResponse.json({resumes:data??[]});
}
export async function POST(req:Request){
 const supabase=await createSupabaseServerClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const form=await req.formData();const file=form.get("file");if(!(file instanceof File))return NextResponse.json({error:"Missing PDF"},{status:400});
 if(file.type!=="application/pdf"||file.size>10*1024*1024)return NextResponse.json({error:"PDF עד 10MB בלבד"},{status:422});
 const path=user.id+"/"+crypto.randomUUID()+".pdf";const db=supabase as any;
 const {error:uploadError}=await db.storage.from("resumes").upload(path,file,{contentType:"application/pdf",upsert:false});
 if(uploadError)return NextResponse.json({error:uploadError.message},{status:400});
 const {data,error}=await db.from("resumes").insert({user_id:user.id,name:file.name,original_filename:file.name,storage_bucket:"resumes",storage_path:path,mime_type:"application/pdf",file_size_bytes:file.size}).select("id,name,original_filename,file_size_bytes,is_default,created_at").single();
 if(error){await db.storage.from("resumes").remove([path]);return NextResponse.json({error:error.message},{status:400});}
 await db.from("user_activity_events").insert({user_id:user.id,event_type:"resume_uploaded",entity_type:"resume",entity_id:data.id,payload:{file_name:file.name,file_size_bytes:file.size}});
 return NextResponse.json({resume:data},{status:201});
}
