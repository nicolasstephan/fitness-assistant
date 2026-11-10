// The one History fold under Exercise > Training: strength workouts (workouts.js) and sports (activities.js) in a
// single list, newest first. Each view fills its own rows (by kind); the list keeps them sorted by start.

/**
 * Replace this kind's rows in the fold's list. items: <li> elements, each with dataset.start (local "YYYY-MM-DDTHH:MM").
 * total: how many entries of this kind exist (the title counts all kinds; the list may show only the latest).
 */
export function fillHistory(fold, kind, items, total) {
  const ul = fold.querySelector("ul");
  for (const li of items) li.dataset.kind = kind;
  // a kind showing only its latest entries cuts the list there, so no time span lacks the other kind's rows
  fold.dataset[`${kind}Cut`] = total > items.filter((li) => li.dataset.start).length ? items.at(-1)?.dataset.start ?? "" : "";
  const cut = Object.entries(fold.dataset).filter(([k]) => k.endsWith("Cut")).map(([, v]) => v).sort().at(-1) ?? "";
  const keep = [...(fold.kept ?? []).filter((li) => li.dataset.kind !== kind), ...items];
  fold.kept = keep; // every kind's rows, also those below the cut (another kind's next update may move it)
  const all = keep.filter((li) => !li.dataset.start || li.dataset.start >= cut)
    .sort((a, b) => (b.dataset.start ?? "").localeCompare(a.dataset.start ?? ""));
  ul.replaceChildren(...all);
  fold.dataset[`${kind}Count`] = String(total);
  const sum = Object.entries(fold.dataset).filter(([k]) => k.endsWith("Count")).reduce((n, [, v]) => n + Number(v), 0);
  fold.hidden = !sum;
  fold.querySelector("summary h3").textContent = `History (${sum})`;
}
