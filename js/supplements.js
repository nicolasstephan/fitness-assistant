// Supplement protocol: versions that apply from a date until the next version.
// Stored in journal.json as supplements: { versions: [{ from: "YYYY-MM-DD", items: [{ name, dose, unit, timing }] }] }.
// Every day is assumed to follow the active version; days can list skipped items (journal day entry `skipped`).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const UNITS = ["g", "mg", "µg", "IU", "ml", "capsule(s)", "tablet(s)"];
// stored value -> shown text. IU = international unit, German "I.E." (Internationale Einheit), e.g. vitamin D3: 1 µg = 40 I.E.
const UNIT_LABEL = { IU: "I.E." };
const UNIT_OPTION = { IU: "I.E. (IU)" };
const unitLabel = (u) => UNIT_LABEL[u] ?? u;
export const TIMINGS = ["Morning", "Midday", "Evening", "Before bed", "With training", "Any time"];

function normalizeItem(i) {
  const name = typeof i?.name === "string" ? i.name.trim().slice(0, 60) : "";
  if (!name) return null;
  const dose = Number.isFinite(+i.dose) && +i.dose > 0 ? +i.dose : null;
  return {
    name,
    dose,
    unit: UNITS.includes(i.unit) ? i.unit : i.unit === "I.E." ? "IU" : "g",
    timing: TIMINGS.includes(i.timing) ? i.timing : "Any time",
  };
}

export function normalizeSupplements(raw) {
  const byDate = new Map();
  for (const v of Array.isArray(raw?.versions) ? raw.versions : []) {
    if (!DATE_RE.test(v?.from ?? "")) continue;
    const items = (Array.isArray(v.items) ? v.items : []).map(normalizeItem).filter(Boolean);
    // unique names per version
    byDate.set(v.from, [...new Map(items.map((i) => [i.name.toLowerCase(), i])).values()]);
  }
  return { versions: [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([from, items]) => ({ from, items })) };
}

/** Versions merged by start date; the local version wins for the same date. */
export function mergeSupplements(remote, local) {
  const byDate = new Map(remote.versions.map((v) => [v.from, v]));
  for (const v of local.versions) byDate.set(v.from, v);
  return normalizeSupplements({ versions: [...byDate.values()] });
}

/** The protocol version in effect on `date`, or null before the first version. */
export function versionOn(supplements, date) {
  return supplements.versions.filter((v) => v.from <= date).at(-1) ?? null;
}

export const describeItem = (i) => `${i.name}${i.dose != null ? ` ${i.dose} ${unitLabel(i.unit)}` : ""}`;

const fmtDate = (date) => new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

// ---------- protocol dialog

export class SupplementDialog {
  /** getSupplements() -> current { versions }; save(supplements) persists; today() -> "YYYY-MM-DD". */
  constructor(dialog, { getSupplements, save, today }) {
    Object.assign(this, { dialog, getSupplements, save, today });
    const rows = dialog.querySelector("#supp-rows");

    dialog.querySelector("#supp-add").addEventListener("click", () => this.addRow({}));
    rows.addEventListener("click", (e) => {
      if (e.target.closest("[data-remove-supp]")) e.target.closest(".supp-row").remove();
    });
    dialog.querySelector("#supp-versions").addEventListener("click", (e) => {
      const from = e.target.closest("[data-delete-version]")?.dataset.deleteVersion;
      if (!from || !confirm(`Delete the protocol version from ${fmtDate(from)}? The previous version then applies.`)) return;
      const s = this.getSupplements();
      this.save(normalizeSupplements({ versions: s.versions.filter((v) => v.from !== from) }));
      this.renderVersions();
    });
    dialog.querySelector("#supp-cancel").addEventListener("click", () => dialog.close());
    dialog.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const from = dialog.querySelector("[name=supp-from]").value || this.today();
      const items = [...rows.querySelectorAll(".supp-row")]
        .map((r) => normalizeItem({
          name: r.querySelector("[name=name]").value,
          dose: r.querySelector("[name=dose]").value,
          unit: r.querySelector("[name=unit]").value,
          timing: r.querySelector("[name=timing]").value,
        }))
        .filter(Boolean);
      const s = this.getSupplements();
      // an empty list is a valid version: "stopped all supplements from this date"
      this.save(normalizeSupplements({ versions: [...s.versions.filter((v) => v.from !== from), { from, items }] }));
      dialog.close();
    });
  }

  open() {
    const d = this.dialog;
    const current = versionOn(this.getSupplements(), this.today());
    d.querySelector("[name=supp-from]").value = this.today();
    d.querySelector("#supp-rows").replaceChildren();
    (current?.items.length ? current.items : [{}]).forEach((i) => this.addRow(i));
    this.renderVersions();
    d.showModal();
  }

  addRow({ name = "", dose = null, unit = "g", timing = "Morning" }) {
    const row = document.createElement("div");
    row.className = "supp-row";
    const opts = (list, sel, labels = {}) =>
      list.map((x) => `<option value="${x}"${x === sel ? " selected" : ""}>${labels[x] ?? x}</option>`).join("");
    row.innerHTML = `<label>Name<input name="name" maxlength="60" placeholder="e.g. Creatine" autocomplete="off"></label>
      <label>Dose<input name="dose" type="number" inputmode="decimal" min="0" step="any" maxlength="8"></label>
      <label>Unit<select name="unit">${opts(UNITS, unit, UNIT_OPTION)}</select></label>
      <label>When<select name="timing">${opts(TIMINGS, timing)}</select></label>
      <button type="button" class="icon-btn" data-remove-supp aria-label="Remove">×</button>`;
    row.querySelector("[name=name]").value = name;
    row.querySelector("[name=dose]").value = dose ?? "";
    this.dialog.querySelector("#supp-rows").appendChild(row);
  }

  renderVersions() {
    const list = this.dialog.querySelector("#supp-versions");
    const versions = [...this.getSupplements().versions].reverse();
    list.closest("section").hidden = !versions.length;
    list.replaceChildren(
      ...versions.map((v, i) => {
        const li = document.createElement("li");
        const text = document.createElement("span");
        // a version ends the day before the next one starts
        const until = i === 0 ? "now" : fmtDate(new Date(Date.parse(`${versions[i - 1].from}T00:00:00Z`) - 86400000).toISOString().slice(0, 10));
        text.textContent = `${fmtDate(v.from)} – ${until}: ${v.items.length ? v.items.map(describeItem).join(", ") : "none"}`;
        const del = document.createElement("button");
        del.type = "button";
        del.className = "icon-btn";
        del.dataset.deleteVersion = v.from;
        del.setAttribute("aria-label", "Delete version");
        del.textContent = "×";
        li.append(text, del);
        return li;
      }),
    );
  }
}
