/* Linha extra da ficha de medidas: tipo de serviço (marcar à mão) e observações. */
export function MeasureExtraRow() {
  return (
    <section className="measure-grid measure-grid-extra">
      <fieldset className="measure-card min-w-0" aria-label="Tipo de serviço">
        <p className="measure-card-label">TIPO DE SERVIÇO</p>
        <div className="measure-card-value mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {["Calhas", "Esquadrias"].map(option => (
            <label key={option} className="inline-flex items-center gap-1">
              <input type="checkbox" value={option}
                className="h-3 w-3 shrink-0 appearance-none rounded-sm border border-black checked:bg-black" />
              {option}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="measure-card min-w-0">
        <p className="measure-card-label">OBSERVAÇÕES</p>
        <div className="measure-card-line measure-obs-line" />
        <div className="measure-card-line measure-obs-line" />
      </div>
    </section>
  );
}
