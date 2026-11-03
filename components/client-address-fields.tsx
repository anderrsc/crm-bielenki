"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

type Address = { postal_code: string; address: string; neighborhood: string; city: string; state: string };
type AddressForm = Address & { number: string; complement: string };

type ViaCep = { cep?: string; logradouro?: string; bairro?: string; localidade?: string; uf?: string; erro?: boolean | string };

const states = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const nearbyCities = ["Jaraguá do Sul", "Guaramirim", "Schroeder", "Corupá", "Massaranduba", "Joinville"];
const digits = (cep: string) => cep.replace(/\D/g, "").slice(0, 8);
const mask = (cep: string) => cep.length > 5 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;

export function ClientAddressFields({ initial }: { initial?: { [K in keyof Address]?: string | null } }) {
  const savedAddress = initial?.address ?? "";
  const parts = /^(.*?),\s*(\d[^,]*|s\/?n)(?:,\s*(.*))?$/i.exec(savedAddress);
  const complementOnly = /^(.*?),\s*Complemento:\s*(.*)$/i.exec(savedAddress);
  const [value, setValue] = useState<AddressForm>({
    number: parts?.[2]?.trim() ?? "",
    complement: parts?.[3]?.trim() ?? complementOnly?.[2]?.trim() ?? "",
    postal_code: mask(digits(initial?.postal_code ?? "")),
    address: parts?.[1]?.trim() ?? complementOnly?.[1]?.trim() ?? savedAddress,
    neighborhood: initial?.neighborhood ?? "",
    city: initial?.city ?? "",
    state: initial?.state?.trim().toUpperCase() ?? "",
  });
  const [message, setMessage] = useState("");
  const [matches, setMatches] = useState<ViaCep[]>([]);
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  function change(key: keyof AddressForm, next: string) {
    request.current?.abort();
    setLoading(false);
    setMatches([]);
    setMessage("");
    setValue(current => ({ ...current, [key]: next }));
  }

  function apply(result: ViaCep) {
    setValue(current => ({
      ...current,
      postal_code: result.cep ?? current.postal_code,
      address: result.logradouro || current.address,
      neighborhood: result.bairro || current.neighborhood,
      city: result.localidade || current.city,
      state: result.uf || current.state,
    }));
    setMatches([]);
    setMessage("Endereço encontrado. Confira e acrescente o número, se houver.");
  }

  async function lookup(path: string) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setMatches([]);
    setMessage("Consultando endereço…");
    try {
      const response = await fetch(`https://viacep.com.br/ws/${path}/json/`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      });
      if (!response.ok) throw new Error("Consulta indisponível");
      const data = await response.json() as ViaCep | ViaCep[];
      if (controller.signal.aborted) return;
      const results = Array.isArray(data) ? data.filter(item => item.cep) : data.cep && !data.erro ? [data] : [];
      if (results.length === 1) apply(results[0]);
      else if (results.length > 1) {
        setMatches(results);
        setMessage("Escolha o endereço para preencher o bairro e o CEP.");
      } else setMessage("Endereço não encontrado. Você pode preencher manualmente.");
    } catch {
      if (!controller.signal.aborted) setMessage("Consulta indisponível. Você pode preencher manualmente.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function searchStreet() {
    const street = value.address.split(",")[0].trim();
    const city = value.city.trim();
    if (!states.includes(value.state) || city.length < 3 || street.length < 3) {
      setMessage("Para buscar pela rua, informe a UF, a cidade e o nome da rua.");
      return;
    }
    void lookup([value.state, city, street].map(encodeURIComponent).join("/"));
  }

  const street = value.address.trim();
  const number = value.number.trim();
  const complement = value.complement.trim();
  const formattedAddress = [street, number, complement && (number ? complement : `Complemento: ${complement}`)]
    .filter(Boolean).join(", ");

  return (
    <fieldset className="rounded-xl border p-4 sm:col-span-2">
      <legend className="px-2 text-sm font-bold">Endereço <span className="font-normal text-ink/60">(opcional)</span></legend>
      <input type="hidden" name="address" value={formattedAddress} />
      <div className="grid gap-4 sm:grid-cols-6">
        <label className="sm:col-span-2">
          <span className="label">CEP</span>
          <input className="field" name="postal_code" autoComplete="postal-code" inputMode="numeric" placeholder="00000-000"
            maxLength={9} value={value.postal_code} onChange={event => {
              const cep = digits(event.target.value);
              change("postal_code", mask(cep));
              if (cep.length === 8) void lookup(cep);
            }} />
        </label>
        <label className="sm:col-span-3">
          <span className="label">Cidade</span>
          <input className="field" name="city" autoComplete="address-level2" list="client-address-cities" value={value.city} onChange={event => change("city", event.target.value)} />
          <datalist id="client-address-cities">{nearbyCities.map(city => <option key={city} value={city} />)}</datalist>
        </label>
        <label>
          <span className="label">UF</span>
          <select className="field" name="state" autoComplete="address-level1" value={value.state} onChange={event => change("state", event.target.value)}>
            <option value="">—</option>
            {states.map(state => <option key={state}>{state}</option>)}
          </select>
        </label>
        <label className="sm:col-span-4">
          <span className="label">Rua / Logradouro</span>
          <input className="field" autoComplete="address-line1" placeholder="Ex. Rua Vicente Bernardes"
            value={value.address} onChange={event => change("address", event.target.value)} />
        </label>
        <label className="sm:col-span-2">
          <span className="label">Número</span>
          <input className="field" placeholder="Ex. 120 ou S/N" value={value.number} onChange={event => change("number", event.target.value)} />
        </label>
        <label className="sm:col-span-4">
          <span className="label">Complemento</span>
          <input className="field" autoComplete="address-line2" placeholder="Ex. Sala 2" value={value.complement} onChange={event => change("complement", event.target.value)} />
        </label>
        <label className="sm:col-span-2">
          <span className="label">Bairro</span>
          <input className="field" name="neighborhood" value={value.neighborhood} onChange={event => change("neighborhood", event.target.value)} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="button-ghost" disabled={loading} onClick={searchStreet}><Search className="h-4 w-4" /> Buscar pela rua</button>
        {message && <p role="status" className="text-sm text-ink/70">{message}</p>}
      </div>
      {matches.length > 0 && (
        <ul aria-label="Endereços encontrados" className="mt-3 max-h-52 divide-y overflow-y-auto rounded-xl border">
          {matches.map(result => (
            <li key={result.cep}>
              <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-cream" onClick={() => apply(result)}>
                {result.logradouro} · {result.bairro} · {result.cep}
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
