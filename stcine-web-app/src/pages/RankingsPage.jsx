import React, { useEffect, useState } from 'react';
import { Flame, Loader2 } from 'lucide-react';
import VodCard from '../components/VodCard';
import { stcineApi } from '../api/stcine';

export default function RankingsPage({ onSelectVod, isFavorite, onToggleFavorite }) {
  const [topics, setTopics] = useState([
    { id: 1, name: 'Em alta' },
    { id: 2, name: 'Lista crescente' },
    { id: 3, name: 'Novidades' },
    { id: 4, name: 'Principais buscas' },
  ]);
  const [segments, setSegments] = useState([
    { pid: 0, name: 'Todo' },
    { pid: 1, name: 'Filmes' },
    { pid: 2, name: 'Séries' },
  ]);
  const [topicId, setTopicId] = useState(1);
  const [pid, setPid] = useState(0);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    stcineApi
      .getRankingTypes()
      .then((res) => {
        if (Array.isArray(res?.topic_list) && res.topic_list.length > 0) {
          setTopics(res.topic_list);
        }
        if (Array.isArray(res?.pid_list) && res.pid_list.length > 0) {
          setSegments(res.pid_list);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPage(1);

    stcineApi
      .getRankings(topicId, pid, 1)
      .then((res) => {
        if (cancelled) return;
        setItems(res.items || []);
        setHasMore(Boolean(res.has_more));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [topicId, pid]);

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const res = await stcineApi.getRankings(topicId, pid, nextPage);
      const next = res.items || [];
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...next.filter((i) => !seen.has(i.id))];
      });
      setPage(nextPage);
      setHasMore(Boolean(res.has_more));
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-7 lg:px-10 pt-24 pb-20 space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#ff404c] mb-1">
            <Flame className="w-3.5 h-3.5" />
            <span>Rankings R7 STREAMING</span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Títulos em Alta
          </h1>
        </div>

        {/* Filtro de segmento */}
        <div className="inline-flex bg-[#11131c] border border-white/10 rounded-xl p-1 gap-1">
          {segments.map((seg) => (
            <button
              key={seg.pid}
              type="button"
              onClick={() => setPid(seg.pid)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                Number(pid) === Number(seg.pid)
                  ? 'bg-white text-black'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {seg.name === 'Todo' ? 'Todos' : seg.name}
            </button>
          ))}
        </div>
      </div>

      {/* Abas de tópicos de ranking */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {topics.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTopicId(t.id)}
            className={`shrink-0 px-4 py-2 rounded-xl text-sm font-semibold border transition-all cursor-pointer ${
              Number(topicId) === Number(t.id)
                ? 'bg-[#e50914] border-[#e50914] text-white shadow-[0_6px_20px_rgba(229,9,20,0.35)]'
                : 'bg-[#10121b] border-white/[0.08] text-zinc-300 hover:text-white hover:border-white/20'
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-[2/3] rounded-xl bg-white/[0.05] animate-pulse" />
              <div className="h-3.5 w-2/3 rounded bg-white/[0.05] animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 sm:gap-5">
            {items.map((vod, idx) => (
              <VodCard
                key={vod.id}
                vod={vod}
                rank={idx + 1}
                onSelect={onSelectVod}
                isFavorite={isFavorite}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-4">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 h-11 px-7 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-sm font-semibold text-white cursor-pointer disabled:opacity-50"
              >
                {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{loadingMore ? 'Carregando...' : 'Ver mais posições'}</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
