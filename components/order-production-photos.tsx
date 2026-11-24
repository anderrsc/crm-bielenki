import Link from 'next/link';
import { getRequestClient } from '@/lib/supabase/server';
import { loadProductionStepPhotos } from '@/lib/production-photos';
import { ProductionStepPhotos } from '@/components/production-step-photos';

export async function OrderProductionPhotos({orderId}:{orderId:string}) {
  const db=await getRequestClient();
  const {data:allowed}=await db.rpc('has_table_access',{resource:'production_orders',action:'select'});
  if(!allowed)return null;
  const {data:orders,error}=await db.from('production_orders').select('id,production_number').eq('order_id',orderId);
  if(error)return <p role="alert">Não foi possível carregar as fotos da produção.</p>;
  const galleries=await Promise.all((orders??[]).map(async order=>({order,photos:await loadProductionStepPhotos(db,order.id)})));
  return <section id="fotos-producao" className="card mt-5 p-5"><h2 className="font-semibold">Fotos da produção</h2>
    {galleries.map(({order,photos})=><div key={order.id} className="mt-4"><Link className="font-semibold underline" href={`/producao/${order.id}`}>{order.production_number} · Abrir etapas e adicionar foto</Link>
      {[...new Set(photos.map(p=>p.step_number))].sort((a,b)=>a-b).map(step=><ProductionStepPhotos key={step} productionOrderId={order.id} orderId={orderId} stepNumber={step} stepName={`Etapa ${step}`} photos={photos} canEdit={false} back={`/pedidos/${orderId}`}/>)}
      {!photos.length&&<p className="mt-2 text-sm text-ink/50">Nenhuma foto registrada.</p>}
    </div>)}
    {!galleries.length&&<p className="mt-2 text-sm text-ink/50">Nenhuma ordem de produção vinculada.</p>}
  </section>;
}
