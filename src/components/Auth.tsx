import { useState } from "react";
import { supabase } from "@/lib";
import { button, input } from "./ui";

export function Auth() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { data, error } =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { username } } });
    setBusy(false);
    if (error) setMsg(error.message);
    else if (!data.session) setMsg("Conta criada. Confirme o email e depois entre.");
  }

  return (
    <div className="grid h-full place-items-center">
      <form onSubmit={submit} className="w-[380px] space-y-3 rounded-xl border border-line bg-card p-7">
        <img src="/icon.svg" alt="" className="mx-auto size-16" />
        <h1 className="text-center text-xl font-semibold">{mode === "login" ? "Bem-vindo de volta" : "Criar conta"}</h1>
        {mode === "signup" && (
          <input className={input} placeholder="Nome de usuário" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={2} maxLength={27} pattern="[a-zA-Z0-9_.]+" title="Letras, números, _ e ." />
        )}
        <input className={input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className={input} type="password" placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        {msg && <p className="text-sm text-danger">{msg}</p>}
        <button className={`${button} w-full`} disabled={busy}>
          {mode === "login" ? "Entrar" : "Cadastrar"}
        </button>
        <button type="button" className="w-full text-sm text-dim hover:text-fg" onClick={() => (setMode(mode === "login" ? "signup" : "login"), setMsg(null))}>
          {mode === "login" ? "Não tem conta? Cadastre-se" : "Já tem conta? Entrar"}
        </button>
      </form>
    </div>
  );
}
