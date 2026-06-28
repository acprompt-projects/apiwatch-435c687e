import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, BarChart, Bar } from 'recharts';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

// --- API helpers ---
const api = {
  listEndpoints: () => fetch(`${API_BASE}/endpoints`).then(r => r.json()),
  addEndpoint: (payload) => fetch(`${API_BASE}/endpoints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json()),
  removeEndpoint: (id) => fetch(`${API_BASE}/endpoints/${id}`, { method: 'DELETE' }).then(r => r.ok),
  getMetrics: (id) => fetch(`${API_BASE}/endpoints/${id}/metrics`).then(r => r.json()),
  getIncidents: (id) => fetch(`${API_BASE}/endpoints/${id}/incidents`).then(r => r.json()),
};

// --- Small components ---
function StatusDot({ status }) {
  const color = status === 'up' ? 'bg-emerald-400' : status === 'down' ? 'bg-red-500' : 'bg-gray-400';
  const ring = status === 'up' ? 'ring-emerald-400/30' : status === 'down' ? 'ring-red-500/30' : 'ring-gray-400/30';
  return <span className={`inline-block h-3 w-3 rounded-full ${color} ring-4 ${ring}`} />;
}

function UptimeBadge({ pct }) {
  const cls = pct >= 99.9 ? 'text-emerald-400' : pct >= 99 ? 'text-yellow-400' : 'text-red-400';
  return <span className={`font-mono font-bold text-lg ${cls}`}>{pct.toFixed(2)}%</span>;
}

function ResponseTimeChart({ data }) {
  if (!data || data.length === 0) return <p className="text-gray-500 text-sm">No data yet.</p>;
  const chartData = data.map(d => ({ t: new Date(d.checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), ms: d.response_time_ms }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="t" tick={{ fill: '#94a3b8', fontSize: 11 }} />
        <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} unit="ms" />
        <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} labelStyle={{ color: '#e2e8f0' }} />
        <Line type="monotone" dataKey="ms" stroke="#38bdf8" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function StatusBarChart({ data }) {
  if (!data || data.length === 0) return null;
  const chartData = data.map(d => ({ t: new Date(d.checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), status: d.status_code === 200 ? 1 : 0 }));
  return (
    <ResponsiveContainer width="100%" height={60}>
      <BarChart data={chartData} margin={{ top: 0, right: 20, bottom: 0, left: 0 }}>
        <Bar dataKey="status" fill="#34d399" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function IncidentList({ incidents }) {
  if (!incidents || incidents.length === 0) return <p className="text-gray-500 text-sm">No incidents recorded.</p>;
  return (
    <div className="space-y-2 max-h-60 overflow-y-auto">
      {incidents.map(inc => (
        <div key={inc.id} className="flex items-start gap-3 rounded-lg bg-slate-800/60 p-3 text-sm">
          <span className="mt-0.5 h-2 w-2 rounded-full bg-red-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-red-300 font-medium">{inc.error || `HTTP ${inc.status_code}`}</p>
            <p className="text-gray-400 text-xs mt-0.5">{new Date_inc.started_at).toLocaleString()} — {inc.resolved_at ? new Date(inc.resolved_at).toLocaleString() : 'Ongoing'}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Main App ---
export default function App() {
  const [endpoints, setEndpoints] = useState([]);
  const [selected, setSelected] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [form, setForm] = useState({ name: '', url: '', interval_sec: 60 });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listEndpoints();
      setEndpoints(list);
    } catch { setEndpoints([]); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const iv = setInterval(refresh, 15000); return () => clearInterval(iv); }, [refresh]);

  const selectEndpoint = useCallback(async (ep) => {
    setSelected(ep);
    try {
      const [m, i] = await Promise.all([api.getMetrics(ep.id), api.getIncidents(ep.id)]);
      setMetrics(m);
      setIncidents(i);
    } catch { setMetrics(null); setIncidents([]); }
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.name || !form.url) return;
    const ep = await api.addEndpoint({ name: form.name, url: form.url, interval_sec: Number(form.interval_sec) || 60 });
    setEndpoints(prev => [...prev, ep]);
    setForm({ name: '', url: '', interval_sec: 60 });
  };

  const handleRemove = async (id) => {
    await api.removeEndpoint(id);
    setEndpoints(prev => prev.filter(e => e.id !== id));
    if (selected?.id === id) { setSelected(null); setMetrics(null); setIncidents([]); }
  };

  const uptime = metrics ? (metrics.checks_total > 0 ? ((metrics.checks_total - metrics.failures) / metrics.checks_total) * 100 : 100) : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <span className="text-sky-400">◆</span> APIWatch
        </h1>
        <span className="text-xs text-slate-500">{endpoints.length} endpoint{endpoints.length !== 1 && 's'} monitored</span>
      </header>

      <div className="flex flex-col lg:flex-row gap-0">
        {/* Sidebar */}
        <aside className="w-full lg:w-80 border-r border-slate-800 p-4 space-y-4 shrink-0">
          <form onSubmit={handleAdd} className="space-y-2">
            <input className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="https://api.example.com/health" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
            <div className="flex gap-2">
              <input type="number" min={10} className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="Interval (s)" value={form.interval_sec} onChange={e => setForm(f => ({ ...f, interval_sec: e.target.value }))} />
              <button type="submit" className="bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">Add</button>
            </div>
          </form>
          <div className="space-y-1">
            {loading && <p className="text-gray-500 text-sm px-2">Loading…</p>}
            {endpoints.map(ep => (
              <div key={ep.id} onClick={() => selectEndpoint(ep)} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${selected?.id === ep.id ? 'bg-slate-800' : 'hover:bg-slate-800/50'}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <StatusDot status={ep.last_status} />
                  <span className="truncate text-sm font-medium">{ep.name}</span>
                </div>
                <button onClick={e => { e.stopPropagation(); handleRemove(ep.id); }} className="text-slate-600 hover:text-red-400 text-xs shrink-0 transition-colors" title="Remove">✕</button>
              </div>
            ))}
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 p-6 space-y-6 overflow-auto">
          {!selected ? (
            <div className="flex items-center justify-center h-64 text-slate-500">Select an endpoint to view metrics</div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2"><StatusDot status={selected.last_status} />{selected.name}</h2>
                  <p className="text-slate-400 text-xs mt-1">{selected.url} · every {selected.interval_sec}s</p>
                </div>
                {uptime !== null && <UptimeBadge pct={uptime} />}
              </div>

              <section className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <h3 className="text-sm font-medium text-slate-300 mb-3">Response Time</h3>
                <ResponseTimeChart data={metrics?.response_times} />
              </section>

              <section className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <h3 className="text-sm font-medium text-slate-300 mb-3">Status Timeline</h3>
                <StatusBarChart data={metrics?.response_times} />
              </section>

              <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 divide-y divide-slate-800">
                <h3 className="text-sm font-medium text-slate-300 mb-3">Incidents</h3>
                <IncidentList incidents={incidents} />
              </section>

              {metrics && (
                <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Avg Response', value: `${metrics.avg_response_ms?.toFixed(0) ?? '—'}ms` },
                    { label: 'P95 Response', value: `${metrics.p95_response_ms?.toFixed(0) ?? '—'}ms` },
                    { label: 'Total Checks', value: metrics.checks_total ?? '—' },
                    { label: 'Failures', value: metrics.failures ?? '—' },
                  ].map(s => (
                    <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
                      <p className="text-xs text-slate-500 uppercase tracking-wider">{s.label}</p>
                      <p className="text-xl font-bold mt-1">{s.value}</p>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}