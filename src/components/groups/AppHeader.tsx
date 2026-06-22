export function AppHeader() {
  return (
    <header className="mb-8 text-center">
      <p className="text-sm font-medium uppercase tracking-[0.28em] text-violet-200/70">
        Powered by{" "}
        <a className="text-violet-100 underline decoration-violet-300/40 underline-offset-4 transition hover:text-white" href="https://github.com/blueshift-gg/vector" rel="noreferrer" target="_blank">
          Vector
        </a>
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">Handshake</h1>
      <p className="mt-3 text-base text-slate-300">Peer-to-peer token swaps on Solana</p>
      <p className="mx-auto mt-5 max-w-2xl rounded-full border border-violet-300/30 bg-violet-300/10 px-5 py-3 text-sm font-semibold text-violet-50 shadow-lg shadow-violet-950/30 sm:text-base">
        Swap any token pair with a friend. No market price. Just transfers!
      </p>
      <p className="mt-3 text-sm text-slate-400">Maker authorization is signed with Falcon-512, a post-quantum signature mechanism.</p>
    </header>
  );
}
