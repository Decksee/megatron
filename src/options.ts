import { isOpen } from "./projects";
import type { SelectOption } from "./components/Select";
import type { Project } from "./db";
import { NO_PROJECT_COLOR } from "./time";

/** Options « projet » pour les listes déroulantes (projets non terminés, avec leur couleur). */
export function projectOptions(projects: Project[], noneLabel: string | null = "Sans projet") {
  const options: SelectOption<number | null>[] = noneLabel ? [{ value: null, label: noneLabel, color: NO_PROJECT_COLOR }] : [];
  for (const p of projects) {
    if (isOpen(p)) options.push({ value: p.id, label: p.name, color: p.color });
  }
  return options;
}
