import {NextResponse,type NextRequest} from 'next/server';
import {createClient,getAuthUser} from '@/lib/supabase/server';
import {saveWorkPlanning} from '@/app/(crm)/work-planning-actions';

// POST/Redirect/GET preserva a lista depois de conferências consecutivas no celular.
export async function POST(request:NextRequest){
 if(request.headers.get('origin')!==request.nextUrl.origin)return NextResponse.json({error:'Origem não autorizada'},{status:403});
 const db=await createClient();
 if(!await getAuthUser(db))return NextResponse.json({error:'Entre novamente'},{status:401});
 const next=await saveWorkPlanning(await request.formData());
 return NextResponse.redirect(new URL(next,request.url),303);
}
