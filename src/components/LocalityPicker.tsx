"use client";

import { useEffect, useState } from "react";
import { MapPin, Search } from "lucide-react";

type Locality = { name: string; code: string; district?: string };

export default function LocalityPicker({ value, onChange, placeholder = "חפש עיר או יישוב בישראל", required = false }: { value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean }) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<Locality[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(Boolean(value));

  useEffect(() => { if (value) { setQuery(value); setSelected(true); } else { setSelected(false); } }, [value]);

  useEffect(() => {
    if (selected || query.trim().length < 2) { setResults([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/localities?q=" + encodeURIComponent(query.trim()), { signal: controller.signal });
        const data = await response.json();
        setResults(data.localities ?? []);
        setOpen(true);
      } catch { if (!controller.signal.aborted) setResults([]); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, selected]);

  return <div className="locality-picker">
    <span className="locality-picker-input"><Search size={16}/><input value={query} required={required} placeholder={placeholder} autoComplete="off" onFocus={() => { if (results.length) setOpen(true); }} onChange={e => { setQuery(e.target.value); setSelected(false); onChange(""); }}/></span>
    {loading && <small className="locality-hint">מחפש במאגר היישובים…</small>}
    {!loading && query.trim().length >= 2 && !selected && results.length === 0 && <small className="locality-hint">לא נמצאו התאמות. יש לבחור יישוב מהרשימה.</small>}
    {open && results.length > 0 && !selected && <div className="locality-results">{results.map(x=><button type="button" key={x.code} onClick={()=>{setQuery(x.name);setSelected(true);setOpen(false);onChange(x.name);}}><MapPin size={14}/><span>{x.name}</span><small>{x.district}</small></button>)}</div>}
    {selected && <small className="locality-hint selected">נבחר: {value}</small>}
  </div>;
}
