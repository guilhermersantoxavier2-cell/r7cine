import React, { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, ArrowRight } from 'lucide-react';
import VodCard from './VodCard';
import { stcineApi } from '../api/stcine';

export default function VodRow({
  section,
  onSelectVod,
  onOpenMore,
  isFavorite,
  onToggleFavorite,
  isHistoryRow = false,
  onRemoveHistory,
}) {
  const scrollRef = useRef(null);
  const [items, setItems] = useState(section.items || []);
  const [refreshing, setRefreshing] = useState(false);
  const seenIdsRef = useRef(new Set((section.items || []).map((i) => i.id)));

  // Sincroniza quando a seção muda (ex: troca de categoria ou atualização de histórico)
  React.useEffect(() => {
    setItems(section.items || []);
    seenIdsRef.current = new Set((section.items || []).map((i) => i.id));
  }, [section.module_id, section.items]);

  if (!items || items.length === 0) return null;

  const scrollByAmount = (dir) => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = Math.max(320, Math.floor(el.clientWidth * 0.82));
    el.scrollBy({ left: dir * distance, behavior: 'smooth' });
  };

  const handleRefresh = async () => {
    if (refreshing || !section.module_id) return;
    setRefreshing(true);
    try {
      const exclude = Array.from(seenIdsRef.current).slice(-36);
      const fresh = await stcineApi.refreshModule(section.module_id, exclude, 10);
      if (Array.isArray(fresh) && fresh.length > 0) {
        fresh.forEach((v) => seenIdsRef.current.add(v.id));
        setItems(fresh);
        if (scrollRef.current) scrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
      }
    } catch {
      // mantém itens atuais silenciosamente
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className="relative group/row">
      {/* Cabeçalho do trilho */}
      <div className="flex items-center justify-between gap-4 mb-3.5 px-4 sm:px-7 lg:px-10">
        <h2 className="font-display text-lg sm:text-xl font-bold text-white tracking-tight">
          {section.title}
        </h2>

        <div className="flex items-center gap-2">
          {section.can_refresh && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/[0.07] transition-colors cursor-pointer disabled:opacity-50"
              title="Sugerir outros títulos"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-[#ff404c]' : ''}`} />
              <span className="hidden sm:inline">Trocar</span>
            </button>
          )}
          {section.has_more && onOpenMore && (
            <button
              type="button"
              onClick={() => onOpenMore(section)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-zinc-300 hover:text-white hover:bg-white/[0.07] transition-colors cursor-pointer"
            >
              <span>Ver tudo</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Trilho rolável com setas nas bordas */}
      <div className="relative">
        <button
          type="button"
          onClick={() => scrollByAmount(-1)}
          aria-label="Rolar para a esquerda"
          className="hidden md:flex absolute left-2 top-[42%] -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-[#0b0d14]/90 hover:bg-[#e50914] border border-white/15 text-white items-center justify-center opacity-0 group-hover/row:opacity-100 transition-all shadow-xl cursor-pointer"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div
          ref={scrollRef}
          className="flex gap-3.5 sm:gap-4 overflow-x-auto no-scrollbar px-4 sm:px-7 lg:px-10 pb-2 scroll-smooth"
        >
          {items.map((vod) => (
            <div
              key={`${section.module_id}-${vod.id}`}
              className="shrink-0 w-[136px] sm:w-[162px] lg:w-[180px]"
            >
              <VodCard
                vod={vod}
                onSelect={onSelectVod}
                isFavorite={isFavorite}
                onToggleFavorite={onToggleFavorite}
                progress={isHistoryRow ? vod : undefined}
                onRemove={isHistoryRow ? onRemoveHistory : undefined}
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => scrollByAmount(1)}
          aria-label="Rolar para a direita"
          className="hidden md:flex absolute right-2 top-[42%] -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-[#0b0d14]/90 hover:bg-[#e50914] border border-white/15 text-white items-center justify-center opacity-0 group-hover/row:opacity-100 transition-all shadow-xl cursor-pointer"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </section>
  );
}
