'use client';
export function InstallationDurationInput({value,onChange}:{value:number|null;onChange:(minutes:number|null)=>void}){
 return <label className="block"><span className="label">Duração da instalação (horas da equipe)</span><input data-testid="installation-duration-hours" className="field" type="number" min="0.25" max="240" step="0.25" value={value==null?'':value/60} onChange={e=>onChange(e.target.value===''?null:Math.round(Number(e.target.value)*60))}/><span className="mt-1 block text-xs text-ink/60">Tempo total da equipe no local. Ex.: 1,5 = 1 h 30 min. Somente uso interno.</span></label>;
}
