import { useState } from "react";
import { errorText, supabase } from "@/lib";
import { button, input } from "./ui";

type Mode = "login" | "signup" | "forgot" | "reset";

const titles: Record<Mode, string> = {
  login: "Bem-vindo de volta",
  signup: "Criar conta",
  forgot: "Recuperar senha",
  reset: "Nova senha",
};
const actions: Record<Mode, string> = { login: "Entrar", signup: "Cadastrar", forgot: "Enviar código", reset: "Trocar senha" };

export function Auth() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  function go(m: Mode) {
    setMode(m);
    setMsg(null);
    setPassword("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username } } });
        if (error) throw error;
        if (!data.session) setMsg({ text: "Conta criada. Confirme o email e depois entre.", ok: true });
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        go("reset");
        setMsg({ text: `Enviamos um código para ${email}.`, ok: true });
      } else {
        // verifyOtp logs in, so App swaps to the main screen right away; updateUser still runs on the shared client
        const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: "recovery" });
        if (error) throw error;
        const { error: e2 } = await supabase.auth.updateUser({ password });
        if (e2) throw e2;
      }
    } catch (err) {
      setMsg({ text: errorText(err) });
    }
    setBusy(false);
  }

  return (
    <div className="grid h-full place-items-center">
      <form onSubmit={submit} className="w-[380px] space-y-3 rounded-xl border border-line bg-card p-7">
        <img src="/icon.svg" alt="" className="mx-auto size-16" />
        <h1 className="text-center text-xl font-semibold">{titles[mode]}</h1>
        {mode === "signup" && (
          <input className={input} placeholder="Nome de usuário" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={2} maxLength={27} pattern="[a-zA-Z0-9_.]+" title="Letras, números, _ e ." />
        )}
        {mode !== "reset" && <input className={input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />}
        {mode === "reset" && (
          <input className={input} placeholder="Código do email" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required pattern="\s*\d{6,10}\s*" title="O código numérico que chegou no email" />
        )}
        {mode !== "forgot" && (
          <input className={input} type="password" placeholder={mode === "reset" ? "Senha nova" : "Senha"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={mode === "login" ? "current-password" : "new-password"} />
        )}
        {msg && <p className={`text-sm ${msg.ok ? "text-dim" : "text-danger"}`}>{msg.text}</p>}
        <button className={`${button} w-full`} disabled={busy}>
          {actions[mode]}
        </button>
        {mode === "login" && (
          <button type="button" className="w-full text-sm text-dim hover:text-fg" onClick={() => go("forgot")}>
            Esqueci minha senha
          </button>
        )}
        <button type="button" className="w-full text-sm text-dim hover:text-fg" onClick={() => go(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "Não tem conta? Cadastre-se" : mode === "signup" ? "Já tem conta? Entrar" : "Voltar para o login"}
        </button>
      </form>
    </div>
  );
}
