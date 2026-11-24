"use client";

import { Camera, Trash2, Upload } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { uploadProductionStepPhoto, deleteProductionStepPhoto } from "@/app/(crm)/production-photo-actions";

export type StepPhoto = {
 id: string;
 step_number: number;
 photo_url: string;
 caption: string | null;
 uploaded_by_name: string | null;
 created_at: string;
};

/** Galeria de fotos por etapa de produção com upload e exclusão. */
export function ProductionStepPhotos({
 productionOrderId,
 orderId,
 stepNumber,
 stepName,
 photos,
 canEdit,
 back,
}: {
 productionOrderId: string;
 orderId: string;
 stepNumber: number;
 stepName: string;
 photos: StepPhoto[];
 canEdit: boolean;
 back: string;
}) {

 const stepPhotos = photos.filter((p) => p.step_number === stepNumber);

 return (
 <div className="mt-4 space-y-3">
 <div className="flex items-center justify-between">
 <h4 className="text-sm font-semibold text-ink/70">
 <Camera size={14} className="mr-1 inline" />
 Fotos da etapa: {stepName}
 </h4>
 <span className="text-xs text-ink/50">{stepPhotos.length} foto(s)</span>
 </div>

 {/* Galeria de fotos existentes */}
 {stepPhotos.length > 0 && (
 <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
 {stepPhotos.map((photo) => (
 <div key={photo.id} className="group relative overflow-hidden rounded-lg border border-ink/10 bg-cream">
 {photo.photo_url ? <a href={photo.photo_url} target="_blank" rel="noopener noreferrer"><img
 src={photo.photo_url}
 alt={photo.caption ?? `Etapa ${stepNumber}`}
 className="aspect-square w-full object-cover"
 loading="lazy"
 /></a> : <p className="p-4 text-xs">Foto indisponível. Atualize a página para tentar novamente.</p>}
 {photo.caption && (
 <p className="truncate px-2 py-1 text-[11px] text-ink/60">{photo.caption}</p>
 )}
 {canEdit && (
 <form action={deleteProductionStepPhoto} className="absolute right-1 top-1">
 <input type="hidden" name="photo_id" value={photo.id} />
 <input type="hidden" name="_back" value={back} />
 <ConfirmButton
 formAction={deleteProductionStepPhoto}
 message="Arquivar esta foto? O arquivo será preservado."
 className="rounded-full bg-red-500/90 p-1 text-white shadow hover:bg-red-600 disabled:opacity-50"
 title="Arquivar foto"
 >
 <Trash2 size={12} />
 </ConfirmButton>
 </form>
 )}
 {photo.uploaded_by_name && (
 <p className="truncate px-2 pb-1 text-[11px] text-ink/40">{photo.uploaded_by_name}</p>
 )}
 </div>
 ))}
 </div>
 )}

 {/* Formulário de upload */}
 {canEdit && (
 <details className="rounded-lg border border-dashed border-ink/20 bg-cream/50 p-3">
 <summary className="cursor-pointer text-sm font-semibold text-ink/60">
 <Upload size={14} className="mr-1 inline" /> Adicionar foto
 </summary>
 <form
 action={uploadProductionStepPhoto}
 className="mt-3 grid gap-3 sm:grid-cols-2"
 >
 <input type="hidden" name="production_order_id" value={productionOrderId} />
 <input type="hidden" name="order_id" value={orderId} />
 <input type="hidden" name="step_number" value={stepNumber} />
 <input type="hidden" name="_back" value={back} />
 <label className="sm:col-span-2">
 <span className="label">Foto</span>
 <input
 type="file"
 name="photo"
 accept="image/jpeg,image/png,image/webp"
 capture="environment"
 required
 className="field"
 />
 <p className="mt-1 text-[11px] text-ink/50">JPG, PNG ou WebP · Máximo 5MB</p>
 </label>
 <label className="sm:col-span-2">
 <span className="label">Descrição (opcional)</span>
 <input name="caption" className="field" maxLength={300} placeholder="Ex.: corte das peças da fachada" />
 </label>
 <SubmitButton className="button sm:col-span-2">
 Adicionar foto
 </SubmitButton>
 </form>
 </details>
 )}
 </div>
 );
}
