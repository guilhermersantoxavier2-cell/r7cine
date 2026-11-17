import React, { useState } from 'react';
import { X, ShieldCheck, ExternalLink, LogOut, Loader2 } from 'lucide-react';
import { stcineApi, clearUserAuth } from '../api/stcine';

export default function AccountModal({ open, onClose, session, onSessionChange }) {
  const [tab, setTab] = useState('login');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState({ type: '', text: '' });

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!account.trim() || !password.trim()) return;
    setSubmitting(true);
    setFeedback({ type: '', text: '' });
    try {
      const user =
        tab === 'login'
          ? await stcineApi.login(account.trim(), password)
          : await stcineApi.register(account.trim(), password);
      setFeedback({
        type: 'ok',
        text: tab === 'login' ? 'Login realizado com sucesso!' : 'Conta criada e conectada!',
      });
      setAccount('');
      setPassword('');
      onSessionChange({
        ...session,
        user,
        token: user?.token || session?.token,
        isAuthenticated: true,
      });
    } catch (err) {
      setFeedback({ type: 'err', text: err.message || 'Falha na autenticação.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    clearUserAuth();
    setFeedback({ type: '', text: '' });
    try {
      const fresh = await stcineApi.initSession();
      onSessionChange({
        deviceId: fresh.device_id,
        token: fresh.token,
        user: fresh.user,
        activeDomain: fresh.active_domain,
        isAuthenticated: false,
      });
    } catch {
      onSessionChange({ isAuthenticated: false });
    }
  };

  const user = session?.user;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-[#11131d] border border-white/12 shadow-2xl p-6 space-y-5"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src="/serve.png"
              alt="R7 STREAMING"
              className="w-8 h-8 rounded-lg object-cover bg-black ring-1 ring-white/20"
            />
            <h2 className="font-display text-xl font-bold text-white">Conta R7 STREAMING</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status da API Web */}
        <div className="rounded-xl bg-black/35 border border-white/[0.08] p-3.5 space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
              <ShieldCheck className="w-4 h-4" />
              R7 STREAMING Online (Sem P2P)
            </span>
            <a
              href={stcineApi.getDocsUrl()}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-zinc-300 hover:text-white underline underline-offset-2"
            >
              <span>API Docs</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <p className="text-zinc-400">
            Sessão atual:{' '}
            <span className="text-zinc-200 font-mono">
              {user?.nickname || user?.account || user?.nick_name || 'Visitante Web'}
            </span>
          </p>
          {session?.activeDomain && (
            <p className="text-zinc-500 truncate">
              Gateway upstream: <span className="font-mono">{session.activeDomain}</span>
            </p>
          )}
        </div>

        {session?.isAuthenticated ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-300">
              Você está autenticado como{' '}
              <strong className="text-white">{user?.nickname || user?.account}</strong>. Seus
              favoritos e progresso estão sincronizados na nuvem.
            </p>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full h-10 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-semibold text-white inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Sair da Conta (voltar p/ sessão Web anônima)</span>
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div className="grid grid-cols-2 bg-black/40 p-1 rounded-xl border border-white/[0.08]">
              <button
                type="button"
                onClick={() => {
                  setTab('login');
                  setFeedback({ type: '', text: '' });
                }}
                className={`py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  tab === 'login' ? 'bg-[#e50914] text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Entrar
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('register');
                  setFeedback({ type: '', text: '' });
                }}
                className={`py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  tab === 'register' ? 'bg-[#e50914] text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Criar Conta
              </button>
            </div>

            <div className="space-y-2.5">
              <input
                type="text"
                required
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="E-mail ou nome de usuário"
                className="w-full h-10 px-3.5 rounded-xl bg-black/45 border border-white/10 focus:border-[#e50914] focus:outline-none text-sm text-white placeholder:text-zinc-500"
              />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Senha"
                className="w-full h-10 px-3.5 rounded-xl bg-black/45 border border-white/10 focus:border-[#e50914] focus:outline-none text-sm text-white placeholder:text-zinc-500"
              />
            </div>

            {feedback.text && (
              <p
                className={`text-xs font-medium ${
                  feedback.type === 'ok' ? 'text-emerald-400' : 'text-[#ff5c66]'
                }`}
              >
                {feedback.text}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-10 rounded-xl bg-[#e50914] hover:bg-[#f6121d] disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{tab === 'login' ? 'Entrar na Conta' : 'Criar Conta Gratuita'}</span>
            </button>

            <p className="text-[11.5px] text-zinc-500 text-center">
              O login é opcional — você já pode assistir a todo o catálogo livremente.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
