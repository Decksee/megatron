import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { setSetting } from "../db";
import { blocklist } from "../focus";
import type { Data } from "../useData";

/** Liste des sites et apps considérés comme des distractions pendant un focus. */
export function Blocklist({ settings }: Pick<Data, "settings">) {
  const [keyword, setKeyword] = useState("");
  const list = blocklist(settings);
  const save = (next: string[]) => setSetting("focus_blocklist", JSON.stringify(next));

  return (
    <div className="field">
      <span className="field-label">Ce qui me distrait</span>
      <div className="keywords">
        <AnimatePresence initial={false}>
          {list.map((k) => (
            <motion.span
              key={k}
              layout
              className="keyword"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
            >
              {k}
              <button onClick={() => save(list.filter((x) => x !== k))} aria-label={`Retirer ${k}`}>
                <X size={11} strokeWidth={2.5} />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const k = keyword.trim().toLowerCase();
          if (k && !list.includes(k)) save([...list, k]);
          setKeyword("");
        }}
      >
        <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Site ou app (ex : lemonde)" />
      </form>
      <span className="muted small">Cherché dans le nom de l'app et le titre de la fenêtre (onglet du navigateur).</span>
    </div>
  );
}
