import React, { useEffect, useState } from 'react';
import { Search, User, Bookmark, Flame, Compass, Home, Menu, X } from 'lucide-react';

const NAV_ITEMS = [
  { id: 'home', label: 'Início', icon: Home },
  { id: 'explore', label: 'Explorar', icon: Compass },
  { id: 'rankings', label: 'Em Alta', icon: Flame },
  { id: 'mylist', label: 'Minha Lista', icon: Bookmark },
];

export default function Navbar({
  activeView,
  onNavigate,
  onOpenSearch,
  onOpenAccount,
  favoritesCount = 0,
  session,
}) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const displayName =
    session?.user?.nickname || session?.user?.account || session?.user?.nick_name || '';
  const isLogged = Boolean(session?.isAuthenticated);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-40 transition-all duration-300 ${
        scrolled || activeView !== 'home'
          ? 'bg-[#08090d]/92 backdrop-blur-xl border-b border-white/[0.07] shadow-[0_8px_32px_rgba(0,0,0,0.45)]'
          : 'bg-gradient-to-b from-[#08090d]/90 via-[#08090d]/50 to-transparent'
      }`}
    >
      <div className="max-w-[1440px] mx-auto px-4 sm:px-7 lg:px-10 h-16 flex items-center justify-between gap-4">
        {/* Marca + Navegação principal */}
        <div className="flex items-center gap-8">
          <button
            type="button"
            onClick={() => {
              onNavigate('home');
              setMobileMenuOpen(false);
            }}
            className="flex items-center gap-2.5 group cursor-pointer focus:outline-none"
          >
            <img
              src="/serve.png"
              alt="R7 STREAMING"
              className="w-9 h-9 rounded-xl object-cover bg-black ring-1 ring-white/20 shadow-[0_0_22px_rgba(255,255,255,0.16)] group-hover:scale-105 group-hover:ring-white/40 transition-all"
            />
            <span className="font-display text-lg sm:text-xl font-extrabold tracking-tight text-white flex items-center gap-1.5">
              <span className="text-[#ff2d3b]">R7</span>
              <span className="tracking-wide">STREAMING</span>
            </span>
          </button>

          <nav className="hidden md:flex items-center gap-1" aria-label="Navegação principal">
            {NAV_ITEMS.map((item) => {
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`relative px-3.5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                    isActive
                      ? 'text-white bg-white/[0.09]'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.id === 'mylist' && favoritesCount > 0 && (
                    <span className="text-[11px] font-semibold px-1.5 py-0.2 rounded-full bg-[#e50914]/25 text-[#ff5a64]">
                      {favoritesCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Ações da direita: Busca + Conta + Menu mobile */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex items-center gap-2.5 h-9 px-3 sm:px-3.5 rounded-full bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.09] text-zinc-300 hover:text-white text-sm transition-colors cursor-pointer"
            aria-label="Buscar filmes e séries"
          >
            <Search className="w-4 h-4 text-zinc-300" />
            <span className="hidden sm:inline text-zinc-400 text-xs pr-2">Buscar títulos...</span>
            <kbd className="hidden lg:inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-zinc-400 border border-white/10">
              /
            </kbd>
          </button>

          <button
            type="button"
            onClick={onOpenAccount}
            className="flex items-center gap-2 h-9 px-3 rounded-full bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.09] text-sm text-zinc-200 transition-colors cursor-pointer"
            title="Conta e Sessão Web"
          >
            <User className="w-4 h-4 text-zinc-300" />
            <span className="hidden sm:inline max-w-[110px] truncate text-xs font-medium">
              {isLogged && displayName ? displayName : 'Conta'}
            </span>
            <span
              className={`w-2 h-2 rounded-full ${
                session?.token ? 'bg-emerald-400' : 'bg-zinc-500'
              }`}
              title={session?.token ? 'API Web Conectada (Sem P2P)' : 'Conectando...'}
            />
          </button>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="md:hidden w-9 h-9 rounded-full bg-white/[0.07] border border-white/[0.09] flex items-center justify-center text-zinc-200 cursor-pointer"
            aria-label="Menu"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Gaveta mobile */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-[#0c0e15]/98 backdrop-blur-xl border-b border-white/10 px-4 py-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onNavigate(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium cursor-pointer ${
                  isActive
                    ? 'bg-[#e50914]/15 text-white border border-[#e50914]/30'
                    : 'text-zinc-300 hover:bg-white/5'
                }`}
              >
                <Icon className="w-4 h-4 text-[#ff404c]" />
                <span>{item.label}</span>
                {item.id === 'mylist' && favoritesCount > 0 && (
                  <span className="ml-auto text-xs bg-[#e50914] text-white px-2 py-0.5 rounded-full">
                    {favoritesCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
}
